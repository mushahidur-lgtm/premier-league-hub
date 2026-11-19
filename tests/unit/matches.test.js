import { describe, expect, it } from "vitest";
import { num, parseEvent, parseRoster, parseSchedules, parseStandings } from "../../src/lib/parsers.js";
import { fmtDate, fmtKick, ordinal, relDay, sameDay, signed, timeAgo } from "../../src/lib/format.js";
import { espnEvent } from "./helpers.js";

const ARS = "359"; // the home side in helpers.espnEvent
const TOT = "367"; // the away side

describe("parseEvent", () => {
  it("league-wide events (no club given) have no perspective: team, opp, isHome and result are null", () => {
    const m = parseEvent(espnEvent({ homeScore: "2", awayScore: "1" }));
    expect(m).toMatchObject({ team: null, opp: null, isHome: null, result: null });
    expect(m.home.id).toBe(ARS);
    expect(m.away.id).toBe(TOT);
  });
  it("a club that isn't playing gets no perspective either", () => {
    expect(parseEvent(espnEvent(), "999")).toMatchObject({ team: null, opp: null, result: null });
  });
  it("derives the result from the given club's perspective, home or away", () => {
    expect(parseEvent(espnEvent({ homeScore: "2", awayScore: "1" }), ARS).result).toBe("W");
    expect(parseEvent(espnEvent({ homeScore: "0", awayScore: "1" }), ARS).result).toBe("L");
    expect(parseEvent(espnEvent({ homeScore: "1", awayScore: "1" }), ARS).result).toBe("D");
    const away = espnEvent({ homeScore: "0", awayScore: "3" });
    const [h, a] = away.competitions[0].competitors;
    h.homeAway = "away";
    a.homeAway = "home"; // Arsenal is the away side
    const m = parseEvent(away, ARS);
    expect(m.result).toBe("L");
    expect(m.isHome).toBe(false);
  });
  it("decides level matches on a shootout when one exists", () => {
    const e = espnEvent({ homeScore: "1", awayScore: "1" });
    e.competitions[0].competitors[0].shootoutScore = "4";
    e.competitions[0].competitors[1].shootoutScore = "2";
    expect(parseEvent(e, ARS).result).toBe("W");
  });
  it("gives no result for unfinished or score-less matches", () => {
    expect(parseEvent(espnEvent({ state: "pre", homeScore: null, awayScore: null }), ARS).result).toBeNull();
    expect(parseEvent(espnEvent({ state: "in" }), ARS).result).toBeNull();
    expect(parseEvent(espnEvent({ homeScore: null, awayScore: null }), ARS).result).toBeNull();
  });
  it("keeps missing scores null rather than 0 or NaN", () => {
    const m = parseEvent(espnEvent({ state: "pre", homeScore: null, awayScore: "" }));
    expect(m.home.score).toBeNull();
    expect(m.away.score).toBeNull();
  });
  it.each(["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_CANCELLED"])("flags %s as postponed", (name) => {
    expect(parseEvent(espnEvent({ state: "pre", statusName: name })).postponed).toBe(true);
  });
  it("names competitions and recognises friendlies", () => {
    expect(parseEvent(espnEvent()).competition).toBe("Premier League");
    const f = parseEvent(espnEvent({ league: { slug: "club.friendly" } }));
    expect(f.friendly).toBe(true);
    expect(f.competition).toBe("Friendly");
  });
  it("survives an event with no competitions", () => {
    expect(() => parseEvent({ id: "x", date: "2025-01-01T00:00Z" })).not.toThrow();
  });
});

describe("parseSchedules", () => {
  it("splits results (newest first) from fixtures (soonest first) and merges duplicate ids", () => {
    const a = espnEvent({ id: "a", date: "2025-01-01T15:00Z" });
    const b = espnEvent({ id: "b", date: "2025-01-08T15:00Z" });
    const f1 = espnEvent({ id: "f1", date: "2025-02-08T15:00Z", state: "pre", homeScore: null, awayScore: null });
    const f2 = espnEvent({ id: "f2", date: "2025-02-01T15:00Z", state: "pre", homeScore: null, awayScore: null });
    const { results, fixtures } = parseSchedules([{ events: [a, b, f1] }, { events: [f2, a] }]);
    expect(results.map((m) => m.id)).toEqual(["b", "a"]);
    expect(fixtures.map((m) => m.id)).toEqual(["f2", "f1"]);
  });
  it("does not list postponed finished matches as results", () => {
    const p = espnEvent({ id: "p", statusName: "STATUS_POSTPONED" });
    expect(parseSchedules([{ events: [p] }]).results).toEqual([]);
  });
  it("keeps postponed upcoming matches in fixtures, flagged", () => {
    const p = espnEvent({ id: "p", state: "pre", statusName: "STATUS_POSTPONED", homeScore: null, awayScore: null });
    const { fixtures } = parseSchedules([{ events: [p] }]);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].postponed).toBe(true);
  });
  it("accepts a valid but empty schedule, and ignores malformed siblings while one response is usable", () => {
    expect(parseSchedules([{ events: [] }])).toEqual({ results: [], fixtures: [], dropped: 0 });
    expect(parseSchedules([{}, null, undefined, { events: null }, { events: [] }])).toMatchObject({
      results: [],
      fixtures: [],
    });
  });
  it("reports an unexpected structure instead of showing an empty schedule", () => {
    for (const bad of [[{}, null, undefined, { events: null }], [], null, [{ events: "nope" }]]) {
      expect(() => parseSchedules(bad), JSON.stringify(bad)).toThrow(/Unexpected response format/);
    }
  });
  it("drops events whose date is missing or invalid so they cannot poison cached data", () => {
    const bad = espnEvent({ id: "bad", date: undefined, state: "pre" });
    const worse = espnEvent({ id: "worse", date: "not a date", state: "pre" });
    const good = espnEvent({ id: "good", date: "2025-03-01T15:00Z", state: "pre", homeScore: null, awayScore: null });
    const { fixtures } = parseSchedules([{ events: [bad, worse, good] }]);
    expect(fixtures.map((m) => m.id)).toEqual(["good"]);
    // Every date that survives parsing must be a real Date, and must survive a JSON round trip.
    expect(fixtures.every((m) => m.date instanceof Date && !Number.isNaN(m.date.getTime()))).toBe(true);
  });
  it("the same event reads from either club's side", () => {
    const e = espnEvent({ id: "x1" });
    expect(parseSchedules([{ events: [e] }], ARS).results[0]).toMatchObject({ result: "W", isHome: true });
    expect(parseSchedules([{ events: [e] }], TOT).results[0]).toMatchObject({ result: "L", isHome: false });
    expect(parseSchedules([{ events: [e] }], TOT).results[0].team.id).toBe(TOT);
  });
});

describe("parseRoster", () => {
  const athlete = (over) => ({
    id: "1",
    displayName: "A Player",
    position: { abbreviation: "M", displayName: "Midfielder" },
    jersey: "8",
    ...over,
  });
  it("groups by position and sorts by line then shirt number", () => {
    const { players } = parseRoster({
      athletes: [
        athlete({ id: "f", displayName: "F", position: { abbreviation: "F" }, jersey: "9" }),
        athlete({ id: "g", displayName: "G", position: { abbreviation: "G" }, jersey: "1" }),
        athlete({ id: "m2", displayName: "M2", jersey: "10" }),
        athlete({ id: "m1", displayName: "M1", jersey: "8" }),
        athlete({ id: "d", displayName: "D", position: { abbreviation: "D" }, jersey: "4" }),
      ],
    });
    expect(players.map((p) => p.id)).toEqual(["g", "d", "m1", "m2", "f"]);
    expect(players[0].group).toBe("Goalkeepers");
  });
  it("keeps missing player data null/empty and never invents a photo", () => {
    const { players } = parseRoster({ athletes: [athlete({ id: "x" })] });
    expect(players[0].photo).toBeNull();
    expect(players[0].dob).toBeNull();
    expect(players[0].height).toBeNull();
    expect(players[0].stats).toEqual({});
    // ESPN supplied no injury data for this player at all: that is "unknown", never "available".
    expect(players[0].availability.key).toBe("unknown");
    expect(parseRoster({ athletes: [athlete({ id: "y", injuries: [] })] }).players[0].availability.key).toBe("clear");
  });
  it("reads injuries and suspensions into availability", () => {
    const inj = parseRoster({ athletes: [athlete({ injuries: [{ status: "Out", details: { type: "Hamstring" } }] })] })
      .players[0];
    expect(inj.availability).toMatchObject({ key: "injured", detail: "Hamstring" });
    const doubt = parseRoster({ athletes: [athlete({ injuries: [{ status: "Day-To-Day" }] })] }).players[0];
    expect(doubt.availability.key).toBe("doubtful");
    const sus = parseRoster({ athletes: [athlete({ injuries: [{ status: "Suspension" }] })] }).players[0];
    expect(sus.availability.key).toBe("suspended");
  });
  it("reports a missing athletes list instead of showing an empty squad, and tolerates non-numeric stats", () => {
    for (const bad of [{}, null, "x", [], { athletes: "nope" }])
      expect(() => parseRoster(bad)).toThrow(/Unexpected response format/);
    expect(parseRoster({ athletes: [] }).players).toEqual([]);
    const p = parseRoster({
      athletes: [
        athlete({
          statistics: {
            splits: {
              categories: [
                {
                  stats: [
                    { name: "goals", value: "n/a" },
                    { name: "assists", value: 3 },
                  ],
                },
              ],
            },
          },
        }),
      ],
    }).players[0];
    expect(p.stats).toEqual({ goals: null, assists: 3 });
  });
});

describe("parseStandings", () => {
  const entry = (id, rank, pts) => ({
    team: { id, displayName: `T${id}` },
    stats: [
      { name: "rank", value: rank },
      { name: "points", value: pts },
      { name: "gamesPlayed", value: 10 },
    ],
  });
  it("sorts by rank and keeps missing columns undefined, not NaN", () => {
    const { rows } = parseStandings({ children: [{ standings: { entries: [entry("2", 2, 20), entry("1", 1, 25)] } }] });
    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(rows[0].pts).toBe(25);
    expect(rows[0].gf).toBeUndefined();
  });
  it("reports unexpected structures; a valid but empty table has no rows", () => {
    for (const bad of [{}, null, { children: [] }, { children: [{ standings: {} }] }])
      expect(() => parseStandings(bad)).toThrow(/Unexpected response format/);
    expect(parseStandings({ children: [{ standings: { entries: [] } }] }).rows).toEqual([]);
  });
});

describe("num", () => {
  it.each([
    [null, null],
    [undefined, null],
    ["3", 3],
    [{ value: 4 }, 4],
    [{ displayValue: "5" }, 5],
    ["abc", null],
    [NaN, null],
    [Infinity, null],
  ])("num(%j) → %j", (input, out) => {
    expect(num(input)).toBe(out);
  });
});

describe("date formatting", () => {
  const d = new Date("2025-01-10T20:00:00Z");
  it("formats in the viewer's timezone (pinned to UTC for the test run)", () => {
    expect(fmtKick(d)).toBe(
      new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d),
    );
    expect(
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: "UTC",
      }).format(d),
    ).toBe("20:00");
  });
  it("converts across timezones without drifting a day", () => {
    const late = new Date("2025-01-10T23:30:00Z");
    expect(new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "Asia/Tokyo" }).format(late)).toBe("11");
    expect(new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" }).format(late)).toBe("10");
  });
  it.each([null, undefined, "", "garbage", new Date("nope")])("fmtDate(%s) returns an empty string", (bad) => {
    expect(fmtDate(bad, { dateStyle: "short" })).toBe("");
  });
  it("accepts ISO strings (as restored from storage)", () => {
    expect(fmtDate("2025-01-10T20:00:00Z", { dateStyle: "short" })).not.toBe("");
  });
  it("sameDay / relDay", () => {
    const now = new Date(2025, 0, 10, 12);
    expect(sameDay(new Date(2025, 0, 10, 1), now)).toBe(true);
    expect(sameDay(null, now)).toBeFalsy();
    expect(relDay(new Date(2025, 0, 10, 20), now)).toBe("Today");
    expect(relDay(new Date(2025, 0, 11, 20), now)).toBe("Tomorrow");
  });
  it("timeAgo", () => {
    const now = Date.UTC(2025, 0, 10, 12);
    expect(timeAgo(new Date(now - 30e3), now)).toBe("just now");
    expect(timeAgo(new Date(now - 5 * 60e3), now)).toBe("5m ago");
    expect(timeAgo(new Date(now - 3 * 3600e3), now)).toBe("3h ago");
    expect(timeAgo(new Date(now - 2 * 86400e3), now)).toBe("2d ago");
    expect(timeAgo(new Date(now + 3600e3), now)).toBe("just now"); // clock skew, future dates
    expect(timeAgo(null, now)).toBe("");
  });
  it("timeAgo copes with dates restored from storage as ISO strings and with invalid dates", () => {
    const now = Date.UTC(2025, 0, 10, 12);
    expect(timeAgo("2025-01-10T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo(new Date("nope"), now)).not.toMatch(/NaN/);
  });
  it("ordinal and signed handle missing and edge values", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(null)).toBe("–");
    expect(signed(3)).toBe("+3");
    expect(signed(-2)).toBe("-2");
    expect(signed(0)).toBe("0");
    expect(signed(undefined)).toBe("–");
  });
});
