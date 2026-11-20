import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLUBS } from "../../src/config/clubs.js";
import { describeError, redact, runHealth, validateMeta, validateNews } from "../../scripts/lib/validate-data.mjs";

const fixture = (name) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "e2e", "fixtures", name), "utf8"));
const ctx = { clubSlugs: new Set(CLUBS.map((c) => c.slug)) };
const item = (over = {}) => ({
  id: "a",
  title: "Rice signs new deal",
  link: "https://www.bbc.co.uk/sport/football/1",
  date: "2026-11-19T10:00:00Z",
  image: null,
  excerpt: "",
  author: "",
  outlet: "bbc",
  clubs: ["arsenal"],
  players: ["123"],
  also: [],
  ...over,
});
const news = (items) => ({ generatedAt: "2026-11-19T10:00:00Z", outlets: { bbc: { name: "BBC Sport" } }, items });

describe("validateNews", () => {
  it("accepts a real pipeline file (the e2e fixture)", () => {
    expect(validateNews(fixture("news.json"), ctx)).toEqual([]);
  });
  it("accepts an empty but well-formed file", () => {
    expect(validateNews(news([]), ctx)).toEqual([]);
  });
  it.each([
    [{ title: " " }, /title missing/],
    [{ link: "javascript:alert(1)" }, /not a web address/],
    [{ date: "yesterday" }, /date is not a date/],
    [{ outlet: "rumourmill" }, /outlet unknown/],
    [{ clubs: ["real-madrid"] }, /unknown club/],
    [{ players: ["Rice"] }, /ESPN ids/],
    [{ link: "https://x.test/a?api_key=abc" }, /credential/],
  ])("rejects a bad item %j", (over, problem) => {
    expect(validateNews(news([item(over)]), ctx).join()).toMatch(problem);
  });
  it("rejects duplicate ids and a missing items list", () => {
    expect(validateNews(news([item(), item()]), ctx).join()).toMatch(/duplicated/);
    expect(validateNews({ generatedAt: "2026-11-19T10:00:00Z", outlets: { bbc: {} } }, ctx).join()).toMatch(
      /items is not an array/,
    );
  });
});

describe("validateMeta", () => {
  const meta = (over = {}) => ({
    generatedAt: "2026-11-19T21:11:30.118Z",
    durationMs: 5368,
    status: "ok",
    problems: [],
    counts: { feeds: 1, feedsOk: 1 },
    rosters: [],
    feeds: [{ club: "arsenal", outlet: "bbc", url: "https://feeds.bbci.co.uk/x.xml", ok: true, error: null }],
    ...over,
  });
  it("accepts the e2e fixture (an older file without rosters) and a current one", () => {
    expect(validateMeta(fixture("meta.json"))).toEqual([]);
    expect(validateMeta(meta())).toEqual([]);
  });
  it("finds IP addresses and credentials anywhere in it", () => {
    const leak = (error) => meta({ feeds: [{ url: "https://x.test/f", ok: false, error }] });
    expect(validateMeta(leak("connect ECONNREFUSED 151.101.0.81:443")).join()).toMatch(/IP address/);
    expect(validateMeta(leak("connect to 2a04:4e42:0:0:0:0:0:81 failed")).join()).toMatch(/IP address/);
    expect(validateMeta(leak("Authorization: Bearer x")).join()).toMatch(/credential/);
  });
  it("doesn't mistake times for addresses", () => {
    expect(validateMeta(meta({ problems: ["kick-off 10:00:00 moved"] }))).toEqual([]);
  });
  it("rejects malformed counts and feeds", () => {
    expect(validateMeta(meta({ counts: { feeds: -1 } })).join()).toMatch(/not a count/);
    expect(validateMeta(meta({ feeds: [{}] })).join()).toMatch(/malformed/);
  });
});

describe("describeError and redact", () => {
  it("adds the cause code that Node's fetch hides behind 'fetch failed', without the address", () => {
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED 151.101.0.81:443"), { code: "ECONNREFUSED" }),
    });
    expect(describeError(err, 15000)).toBe("fetch failed (ECONNREFUSED)");
  });
  it("words timeouts plainly and strips addresses from messages", () => {
    expect(describeError(Object.assign(new Error("x"), { name: "TimeoutError" }), 15000)).toBe("Timed out after 15s");
    expect(describeError(new Error("getaddrinfo EAI_AGAIN 10.0.0.1"), 15000)).toBe("getaddrinfo EAI_AGAIN [address]");
  });
  it("redacts credential-like query parameters", () => {
    expect(redact("GET https://x.test/f?token=abc&page=2")).toBe("GET https://x.test/f?token=[redacted]&page=2");
  });
});

describe("runHealth", () => {
  const base = { feeds: 57, feedsOk: 57, items: 410, rosters: 20, rostersOk: 20 };
  it("ok when everything worked", () => expect(runHealth(base)).toEqual({ status: "ok", problems: [] }));
  it("degraded (still deploys) when some feeds or squads failed", () => {
    expect(runHealth({ ...base, feedsOk: 36, rostersOk: 19 })).toEqual({
      status: "degraded",
      problems: ["21 of 57 feeds failed", "1 of 20 squads failed"],
    });
  });
  it("failed (keeps the live site) below half the feeds or too few stories", () => {
    expect(runHealth({ ...base, feedsOk: 28 }).status).toBe("failed");
    expect(runHealth({ ...base, feedsOk: 29 }).status).toBe("degraded");
    expect(runHealth({ ...base, items: 99 })).toMatchObject({
      status: "failed",
      problems: ["only 99 stories (need at least 100)"],
    });
  });
});
