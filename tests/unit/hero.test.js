import { describe, expect, it } from "vitest";
import { heroMode, keyEvents, talkingPoints } from "../../src/lib/hero.js";

const m = (over) => ({
  id: "1",
  state: "pre",
  date: new Date("2025-03-01T15:00:00Z"),
  friendly: false,
  postponed: false,
  home: { id: "359", short: "Arsenal" },
  away: { id: "9", short: "Spurs" },
  ...over,
});
const T = (iso) => new Date(iso).getTime();

describe("heroMode", () => {
  it("is live when any match is in play", () => {
    const live = m({ state: "in" });
    expect(heroMode({ fixtures: [m(), live], results: [] }, T("2025-03-01T15:30:00Z"))).toEqual({
      mode: "live",
      match: live,
    });
  });
  it("shows full time for a match that finished within the same day, then reverts", () => {
    const done = m({ state: "post" });
    const data = { fixtures: [m({ id: "2", date: new Date("2025-03-08T15:00:00Z") })], results: [done] };
    expect(heroMode(data, T("2025-03-01T17:30:00Z")).mode).toBe("fulltime");
    expect(heroMode(data, T("2025-03-02T09:00:00Z")).mode).toBe("upcoming");
  });
  it("ignores friendlies, postponed and not-yet-played results, and missing data", () => {
    expect(
      heroMode({ fixtures: [], results: [m({ state: "post", friendly: true })] }, T("2025-03-01T17:00:00Z")).mode,
    ).toBe("upcoming");
    expect(
      heroMode({ fixtures: [], results: [m({ state: "post", postponed: true })] }, T("2025-03-01T17:00:00Z")).mode,
    ).toBe("upcoming");
    expect(heroMode({ fixtures: [], results: [m({ state: "post" })] }, T("2025-03-01T10:00:00Z")).mode).toBe(
      "upcoming",
    );
    expect(heroMode(null).mode).toBe("upcoming");
    expect(heroMode({}, 0).mode).toBe("upcoming");
  });
});

describe("keyEvents / talkingPoints", () => {
  const match = m({ state: "post" });
  const summary = {
    events: [
      { kind: "sub", minute: "10'", teamId: "359", primary: "A" },
      { kind: "goal", minute: "23'", teamId: "359", primary: "Saka" },
      { kind: "yellow", minute: "40'", teamId: "9", primary: "X" },
      { kind: "penalty", minute: "80'", teamId: "9", primary: "Son" },
    ],
    stats: [
      { key: "possessionPct", home: 58, away: 42, fmt: (v) => `${v}%` },
      { key: "totalShots", home: 14, away: 8 },
      { key: "shotsOnTarget", home: 6, away: 3 },
    ],
  };
  it("filters substitutions out of key events", () => {
    expect(keyEvents(summary).map((e) => e.kind)).toEqual(["goal", "yellow", "penalty"]);
    expect(keyEvents(summary, 2).map((e) => e.kind)).toEqual(["yellow", "penalty"]);
    expect(keyEvents(null)).toEqual([]);
  });
  it("builds factual lines from the data only", () => {
    const pts = talkingPoints(summary, match);
    expect(pts.map((p) => p.id)).toEqual(["goals", "possession", "shots", "yellows"]);
    expect(pts[0].text).toBe("Saka 23' for Arsenal · Son 80' (pen) for Spurs");
    expect(pts[2].text).toBe("Arsenal 14 (6 on target) – 8 (3 on target) Spurs");
  });
  it("omits lines for missing data and returns nothing without a summary", () => {
    expect(talkingPoints({ events: [], stats: [] }, match)).toEqual([]);
    expect(talkingPoints(null, match)).toEqual([]);
    expect(talkingPoints(summary, null)).toEqual([]);
  });
});

import { UNCONFIRMED_AFTER_MS, matchPhase, pickNextMatch } from "../../src/lib/hero.js";

describe("matchPhase: live, upcoming, completed and stale fixtures", () => {
  const at = (iso) => new Date(iso);
  const KICK = T("2025-03-01T15:00:00Z");
  const fx = (over) => m({ date: at("2025-03-01T15:00:00Z"), ...over });
  it("classifies each state", () => {
    expect(matchPhase(fx({ state: "in" }), KICK + 1)).toBe("live");
    expect(matchPhase(fx({ state: "post" }), KICK + 9e9)).toBe("completed");
    expect(matchPhase(fx(), KICK - 60e3)).toBe("upcoming");
    expect(matchPhase(fx(), KICK + 60e3)).toBe("kickoff-passed");
    expect(matchPhase(fx(), KICK + UNCONFIRMED_AFTER_MS + 1)).toBe("unconfirmed");
  });
  it("postponed wins over every other state; a missing date is unknown", () => {
    for (const state of ["pre", "in", "post"])
      expect(matchPhase(fx({ state, postponed: true }), KICK)).toBe("postponed");
    expect(matchPhase(fx({ date: null }), KICK)).toBe("unknown");
    expect(matchPhase(fx({ date: new Date("x") }), KICK)).toBe("unknown");
    expect(matchPhase(null)).toBe("unknown");
  });
  it("is exactly at the boundary: 3.5h after kick-off is still 'kickoff-passed'", () => {
    expect(matchPhase(fx(), KICK + UNCONFIRMED_AFTER_MS)).toBe("kickoff-passed");
  });
  it("a stale fixture never blocks the real next match", () => {
    const stale = fx({ id: "stale", date: at("2025-02-20T15:00:00Z") });
    const later = fx({ id: "later", date: at("2025-03-08T15:00:00Z") });
    const r = pickNextMatch({ fixtures: [stale, later], results: [] }, KICK);
    expect(r.next.id).toBe("later");
    expect(r.stale.map((x) => x.id)).toEqual(["stale"]);
  });
  it("live beats upcoming; with only stale fixtures there is no 'next', and nothing is invented", () => {
    const live = fx({ id: "live", state: "in" });
    expect(
      pickNextMatch({ fixtures: [fx({ id: "up", date: at("2025-03-08T15:00:00Z") }), live], results: [] }, KICK + 1)
        .next.id,
    ).toBe("live");
    const only = pickNextMatch({ fixtures: [fx({ id: "old", date: at("2025-02-01T15:00:00Z") })], results: [] }, KICK);
    expect(only.next).toBeNull();
    expect(only.stale).toHaveLength(1);
  });
  it("last result skips friendlies when a competitive one exists, and handles empty data", () => {
    const friendly = fx({ id: "f", state: "post", friendly: true });
    const real = fx({ id: "r", state: "post" });
    expect(pickNextMatch({ fixtures: [], results: [friendly, real] }, KICK).last.id).toBe("r");
    expect(pickNextMatch({ fixtures: [], results: [friendly] }, KICK).last.id).toBe("f");
    expect(pickNextMatch(null)).toEqual({ next: null, last: null, stale: [] });
    expect(pickNextMatch({}, KICK)).toEqual({ next: null, last: null, stale: [] });
  });
});
