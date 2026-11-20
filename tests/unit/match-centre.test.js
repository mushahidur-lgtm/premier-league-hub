import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEY_KINDS, parseSummary } from "../../src/lib/parsers.js";
import { bySide, headToHeadRecord, isLive, relatedStories, settledOnPenalties } from "../../src/lib/match.js";

const fixture = (name) => JSON.parse(readFileSync(join(process.cwd(), "tests", "e2e", "fixtures", name), "utf8"));
const raw = fixture("summary.json");
const summary = parseSummary(raw);

describe("match summary: timeline", () => {
  it("reads ESPN's commentary in match order, with kinds and sides", () => {
    const t = summary.timeline;
    expect(t.length).toBe(raw.commentary.length);
    expect(t.map((x) => x.seq)).toEqual([...t.map((x) => x.seq)].sort((a, b) => a - b));
    expect(t[0].kind).toBe("info"); // "Lineups are announced…" has no play
    const kinds = new Set(t.map((x) => x.kind));
    for (const k of ["goal", "sub", "yellow", "period", "foul", "corner"]) expect(kinds).toContain(k);
    const ids = new Set([summary.match.home.id, summary.match.away.id, null]);
    expect(t.every((x) => ids.has(x.teamId))).toBe(true);
    expect(t.filter((x) => x.kind === "foul").every((x) => x.teamId != null)).toBe(true);
  });

  it("maps every play type, and keeps unknown ones as other", () => {
    const play = (type) => ({ sequence: 1, text: "x", time: { displayValue: "1'" }, play: { type: { type } } });
    const kind = (type) => parseSummary({ ...raw, commentary: [play(type)] }).timeline[0].kind;
    expect(kind("own-goal")).toBe("own-goal");
    expect(kind("penalty---scored")).toBe("penalty");
    expect(kind("penalty---saved")).toBe("penalty-missed");
    expect(kind("goal---header")).toBe("goal");
    expect(kind("yellow-red-card")).toBe("red");
    expect(kind("red-card")).toBe("red");
    expect(kind("var---referee-decision-cancelled")).toBe("var");
    expect(kind("shot-hit-woodwork")).toBe("woodwork");
    expect(kind("handball")).toBe("foul");
    expect(kind("something-new")).toBe("other");
    expect(KEY_KINDS.has("goal") && !KEY_KINDS.has("foul")).toBe(true);
  });

  it("an old cached shape or a summary without commentary gives empty lists, not a crash", () => {
    const bare = parseSummary({ header: raw.header });
    expect(bare.timeline).toEqual([]);
    expect(bare.h2h).toEqual([]);
  });
});

describe("match summary: goals, cards and substitutions by side", () => {
  it("goals per side equal the score", () => {
    const [home, away] = bySide(summary.events, [summary.match.home.id, summary.match.away.id]);
    expect(home.goals.length).toBe(summary.match.home.score);
    expect(away.goals.length).toBe(summary.match.away.score);
    expect(home.subs.length + away.subs.length).toBe(summary.events.filter((e) => e.kind === "sub").length);
  });

  it("an own goal counts for the side ESPN credits it to (the side it counts for)", () => {
    const events = [
      { kind: "goal", teamId: "1", minute: "5'", primary: "A", secondary: null },
      { kind: "own-goal", teamId: "2", minute: "46'", primary: "B of side 1", secondary: null },
      { kind: "yellow", teamId: "1", minute: "50'", primary: "C", secondary: null },
    ];
    const [one, two] = bySide(events, ["1", "2"]);
    expect(one.goals).toHaveLength(1);
    expect(two.goals.map((g) => g.kind)).toEqual(["own-goal"]);
    expect(one.cards).toHaveLength(1);
  });
});

describe("match summary: head-to-head", () => {
  it("lists earlier finished meetings, newest first, with competitions", () => {
    const h = summary.h2h;
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((m) => m.id !== raw.header.id && m.competition)).toBe(true);
    expect(h.map((m) => m.date.getTime())).toEqual([...h.map((m) => m.date.getTime())].sort((a, b) => b - a));
  });

  it("drops unfinished meetings and this match", () => {
    const series = structuredClone(raw.seasonseries);
    series[0].events[0].statusType.state = "pre";
    series[0].events[1].id = raw.header.id;
    expect(parseSummary({ ...raw, seasonseries: series }).h2h).toHaveLength(raw.seasonseries[0].events.length - 2);
  });

  it("counts wins, draws and losses from one side, a shoot-out as a draw", () => {
    const m = (h, a, hs, as, hw = false, aw = false) => ({
      id: "1",
      date: null,
      competition: "Cup",
      home: { id: h, score: hs, winner: hw },
      away: { id: a, score: as, winner: aw },
    });
    const meetings = [m("A", "B", 2, 0), m("B", "A", 1, 1, true), m("B", "A", 3, 1), m("A", "B", 1, 1)];
    expect(headToHeadRecord(meetings, "A")).toEqual({ wins: 1, draws: 2, losses: 1, shootouts: 1, played: 4 });
    expect(headToHeadRecord(meetings, "B")).toMatchObject({ wins: 1, draws: 2, losses: 1 });
    expect(settledOnPenalties(meetings[1])).toBe(true);
    expect(settledOnPenalties(meetings[3])).toBe(false);
  });
});

describe("related news", () => {
  const at = (h) => new Date(Date.UTC(2026, 10, 7, h));
  const stories = [
    { id: 1, clubs: ["a", "b"], date: at(10) },
    { id: 2, clubs: ["a"], date: at(12) },
    { id: 3, clubs: ["b", "c"], date: new Date(Date.UTC(2026, 9, 1)) },
    { id: 4, clubs: ["c"], date: at(11) },
  ];
  it("prefers stories tagged with both clubs", () => {
    expect(relatedStories(stories, ["a", "b"], at(15))).toEqual({ about: [stories[0]], around: [] });
  });
  it("falls back to either club around kick-off, newest first", () => {
    const noBoth = stories.slice(1);
    expect(relatedStories(noBoth, ["a", "b"], at(15)).around.map((s) => s.id)).toEqual([2]);
    expect(relatedStories(noBoth, ["a", "b"], null).around).toEqual([]);
  });
  it("a side outside the league can only give the fallback", () => {
    expect(relatedStories(stories, ["a", null], at(15))).toEqual({ about: [], around: [stories[1], stories[0]] });
    expect(relatedStories(stories, [null, null], at(15))).toEqual({ about: [], around: [] });
  });
});

describe("isLive", () => {
  it("only a match in play is live", () => {
    expect(isLive({ state: "in" })).toBe(true);
    expect(isLive({ state: "post" })).toBe(false);
    expect(isLive(undefined)).toBe(false);
  });
});
