import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheConfig, configureCache, getDiagnostics, readCache, writeCache } from "../../src/lib/data.js";
import { resetDiagnostics } from "../../src/lib/diagnostics.js";

const DEFAULT_CONFIG = JSON.parse(JSON.stringify(cacheConfig));
const KEY = "plh-cache-v1";
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "{}");

beforeEach(() => {
  resetDiagnostics();
});
afterEach(() => {
  Object.assign(cacheConfig, JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
  cacheConfig.maxAgeMs = { ...DEFAULT_CONFIG.maxAgeMs };
});

describe("persistent cache: expiry", () => {
  it("round-trips data and revives dates", () => {
    writeCache("standings", { rows: [{ id: "1" }], when: "x" }, new Date("2025-03-01T10:00:00Z"));
    const out = readCache(new Date("2025-03-01T11:00:00Z").getTime());
    expect(out.standings.data.rows).toEqual([{ id: "1" }]);
    expect(out.standings.savedAt).toBeInstanceOf(Date);
  });
  it("drops entries older than the default 3 days and counts them as expired", () => {
    const saved = new Date("2025-03-01T10:00:00Z");
    writeCache("roster", { players: [] }, saved);
    expect(Object.keys(readCache(saved.getTime() + 3 * 86400e3 - 1000))).toEqual(["roster"]);
    expect(readCache(saved.getTime() + 3 * 86400e3 + 1000)).toEqual({});
    expect(getDiagnostics().persistentCache.expired).toBe(1);
  });
  it("max age is configurable per source", () => {
    const saved = new Date("2025-03-01T10:00:00Z");
    writeCache("schedule:359", { results: [], fixtures: [] }, saved);
    writeCache("roster:359", { players: [] }, saved);
    writeCache("news", { items: [] }, saved);
    configureCache({ maxAgeMs: { schedule: 60e3, news: 30e3 } });
    const out = readCache(saved.getTime() + 120e3);
    // every club schedule expires after a minute (configured by kind), rosters still within the default
    expect(Object.keys(out)).toEqual(["roster:359"]);
  });
  it("a max age for one exact key overrides the one for its kind", () => {
    const saved = new Date("2025-03-01T10:00:00Z");
    writeCache("roster:1", { players: [] }, saved);
    writeCache("roster:2", { players: [] }, saved);
    configureCache({ maxAgeMs: { roster: 60e3, "roster:2": 600e3 } });
    expect(Object.keys(readCache(saved.getTime() + 120e3))).toEqual(["roster:2"]);
  });
  it("ignores entries with a missing or invalid savedAt", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        a: { data: 1 },
        b: { data: 2, savedAt: "nope" },
        c: null,
        d: { data: 3, savedAt: new Date().toISOString() },
      }),
    );
    expect(Object.keys(readCache())).toEqual(["d"]);
  });
  it.each(["{bad", "null", "[1]", '"str"'])("survives corrupted storage (%s)", (raw) => {
    localStorage.setItem(KEY, raw);
    expect(readCache()).toEqual({});
    expect(() => writeCache("roster", { players: [] })).not.toThrow();
  });
  it("checks cached schedules for every club key, not just one exact key", () => {
    const now = new Date().toISOString();
    const sched = {
      results: [],
      fixtures: [
        { id: "x", date: null },
        { id: "y", date: "2025-03-01T10:00:00Z" },
      ],
    };
    localStorage.setItem(
      KEY,
      JSON.stringify({
        "schedule:359": { savedAt: now, data: sched },
        "schedule:363": { savedAt: now, data: { oops: true } },
        scoreboard: { savedAt: now, data: sched },
        "scoreboard:20250301": { savedAt: now, data: "junk" },
      }),
    );
    const out = readCache();
    expect(out["schedule:359"].data.fixtures.map((m) => m.id)).toEqual(["y"]);
    expect(out["schedule:359"].data.fixtures[0].date).toBeInstanceOf(Date);
    expect(out["schedule:363"]).toBeUndefined();
    expect(out.scoreboard.data.fixtures.map((m) => m.id)).toEqual(["y"]);
    expect(out["scoreboard:20250301"]).toBeUndefined();
  });
  it("revives news dates and drops news items whose date was corrupted", () => {
    const now = new Date().toISOString();
    localStorage.setItem(
      KEY,
      JSON.stringify({
        news: {
          savedAt: now,
          data: {
            generatedAt: now,
            items: [
              { id: "a", date: "2025-03-01T10:00:00Z" },
              { id: "b", date: null },
              { id: "c", date: "nope" },
              null,
            ],
          },
        },
      }),
    );
    const { data } = readCache().news;
    expect(data.generatedAt).toBeInstanceOf(Date);
    expect(data.items.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("persistent cache: size limit and eviction", () => {
  const big = (n) => ({ blob: "x".repeat(n) });
  it("evicts the oldest-saved other sources when over the limit, and keeps the newest", () => {
    configureCache({ maxBytes: 3000 });
    writeCache("a", big(1000), new Date("2025-03-01T10:00:00Z"));
    writeCache("b", big(1000), new Date("2025-03-01T11:00:00Z"));
    writeCache("c", big(1000), new Date("2025-03-01T12:00:00Z")); // total now > 3000 -> evicts a
    expect(Object.keys(stored()).sort()).toEqual(["b", "c"]);
    writeCache("d", big(1500), new Date("2025-03-01T13:00:00Z")); // evicts b, then c if needed
    expect(Object.keys(stored())).toContain("d");
    expect(localStorage.getItem(KEY).length).toBeLessThanOrEqual(3000);
    expect(getDiagnostics().persistentCache.evicted).toBeGreaterThanOrEqual(2);
  });
  it("overwriting a source doesn't evict others unnecessarily", () => {
    configureCache({ maxBytes: 5000 });
    writeCache("a", big(1000));
    writeCache("b", big(1000));
    writeCache("a", big(1200));
    expect(Object.keys(stored()).sort()).toEqual(["a", "b"]);
    expect(getDiagnostics().persistentCache.evicted).toBe(0);
  });
  it("a single source larger than the whole limit is rejected and the existing cache is left intact", () => {
    configureCache({ maxBytes: 2000 });
    writeCache("small", big(100));
    expect(writeCache("huge", big(5000))).toBe(false);
    expect(Object.keys(stored())).toEqual(["small"]);
    expect(getDiagnostics().persistentCache.rejected).toBe(1);
  });
  it("a storage quota error evicts the oldest source and retries", () => {
    writeCache("old", big(100), new Date("2025-03-01T09:00:00Z"));
    writeCache("mid", big(100), new Date("2025-03-01T10:00:00Z"));
    const real = Storage.prototype.setItem;
    let calls = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, v) {
      if (++calls === 1) throw new DOMException("quota", "QuotaExceededError");
      return real.call(this, k, v);
    });
    expect(writeCache("new", big(100), new Date("2025-03-01T11:00:00Z"))).toBe(true);
    expect(Object.keys(stored()).sort()).toEqual(["mid", "new"]); // "old" made room
  });
  it("persistent storage failure is reported, not thrown", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => writeCache("a", big(10))).not.toThrow();
    expect(writeCache("a", big(10))).toBe(false);
    expect(getDiagnostics().persistentCache.writeFailures).toBeGreaterThanOrEqual(1);
  });
  it("works when localStorage is blocked entirely", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readCache()).toEqual({});
    expect(writeCache("a", { x: 1 })).toBe(false);
  });
});
