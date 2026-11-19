import { beforeEach, describe, expect, it } from "vitest";
import { parseEvent, parseRoster, parseSchedules, parseStandings, parseSummary } from "../../src/lib/parsers.js";
import { FetchError } from "../../src/lib/errors.js";
import { getDiagnostics, resetDiagnostics } from "../../src/lib/diagnostics.js";
import { arr, date, expectArray, expectObject, num, str } from "../../src/lib/validate.js";
import { espnEvent } from "./helpers.js";

beforeEach(() => resetDiagnostics());

describe("validation helpers", () => {
  it("num: finite numbers only; blank, boolean and non-numeric are null, never 0", () => {
    for (const bad of [null, undefined, "", "   ", "abc", NaN, Infinity, true, false, {}, []])
      expect(num(bad), String(bad)).toBeNull();
    expect(num("3")).toBe(3);
    expect(num({ value: 4 })).toBe(4);
    expect(num({ displayValue: "5" })).toBe(5);
    expect(num(0)).toBe(0); // a real zero stays a zero
  });
  it("date: valid Date or null", () => {
    expect(date("2025-01-01T00:00:00Z")).toBeInstanceOf(Date);
    for (const bad of [null, undefined, "", "nope", new Date("x"), {}]) expect(date(bad), String(bad)).toBeNull();
  });
  it("str / arr", () => {
    expect(str("x")).toBe("x");
    expect(str(12)).toBe("12");
    for (const bad of [null, undefined, "", "  ", {}, [], NaN]) expect(str(bad)).toBeNull();
    expect(arr("x")).toEqual([]);
    expect(arr([1])).toEqual([1]);
  });
  it("expectObject / expectArray raise a classified data error", () => {
    for (const fn of [() => expectObject([], "x"), () => expectObject(null, "x"), () => expectArray({}, "x")]) {
      try {
        fn();
        throw new Error("did not throw");
      } catch (e) {
        expect(e).toBeInstanceOf(FetchError);
        expect(e.kind).toBe("data");
      }
    }
  });
});

describe("fixtures: unexpected ESPN shapes", () => {
  it("parseEvent returns null for records it can't use and never throws", () => {
    for (const bad of [null, undefined, "x", 5, [], {}, { date: "2025-01-01" }])
      expect(parseEvent(bad), JSON.stringify(bad)).toBeNull();
  });
  it("tolerates missing nested ESPN properties", () => {
    const e = {
      id: 7,
      date: "2025-03-01T15:00:00Z",
      competitions: [{ competitors: [{ team: {} }, { team: { id: 359 } }] }],
    };
    const m = parseEvent(e);
    expect(m).toMatchObject({ id: "7", state: "pre", venue: null, statusDetail: null, result: null });
    expect(m.home.name).toBe("TBD");
    expect(m.home.score).toBeNull();
  });
  it("competitions / competitors of the wrong type are treated as empty", () => {
    expect(() => parseEvent({ id: 1, date: "2025-03-01T15:00:00Z", competitions: "x" })).not.toThrow();
    expect(() =>
      parseEvent({ id: 1, date: "2025-03-01T15:00:00Z", competitions: [{ competitors: { a: 1 } }] }),
    ).not.toThrow();
    expect(parseEvent({ id: 1, date: "2025-03-01T15:00:00Z", competitions: [{ competitors: null }] }).sideCount).toBe(
      0,
    );
  });
  it("an unknown status state defaults to 'pre' rather than propagating junk", () => {
    expect(parseEvent(espnEvent({ state: "weird" })).state).toBe("pre");
  });
  it("invalid match dates: events are skipped and counted, valid ones survive", () => {
    const events = [
      espnEvent({ id: "a", date: "not-a-date" }),
      espnEvent({ id: "b", date: null }),
      espnEvent({ id: "c", date: 1e20 }), // beyond the range of Date,
      espnEvent({ id: "ok", date: "2025-03-01T15:00:00Z" }),
    ];
    const out = parseSchedules([{ events }]);
    expect(out.results.map((m) => m.id).concat(out.fixtures.map((m) => m.id))).toEqual(["ok"]);
    expect(out.dropped).toBe(3);
    expect(getDiagnostics().dropped.schedule).toBe(3);
  });
  it("skips events with no id or fewer than two teams, keeps the rest", () => {
    const noTeams = { id: "x", date: "2025-03-01T15:00:00Z", competitions: [{ competitors: [] }] };
    const out = parseSchedules([
      { events: [noTeams, { date: "2025-03-01T15:00:00Z" }, null, espnEvent({ id: "ok" })] },
    ]);
    expect(out.results.map((m) => m.id)).toEqual(["ok"]);
    expect(out.dropped).toBe(3);
  });
  it("dates are always real Dates on everything that survives", () => {
    const out = parseSchedules([
      { events: [espnEvent({ id: "1" }), espnEvent({ id: "2", state: "pre", date: "2025-04-01T12:00Z" })] },
    ]);
    for (const m of [...out.results, ...out.fixtures]) expect(Number.isNaN(m.date.getTime())).toBe(false);
  });
});

describe("squad and player information", () => {
  const ath = (over) => ({ id: "1", displayName: "A Player", position: { abbreviation: "M" }, ...over });
  it("skips athletes with no id or name, keeps the others", () => {
    const { players } = parseRoster({
      athletes: [ath(), { displayName: "No id" }, { id: "9" }, null, "x", ath({ id: "2", displayName: "B" })],
    });
    expect(players.map((p) => p.id)).toEqual(["1", "2"]);
    expect(getDiagnostics().dropped.roster).toBe(4);
  });
  it("numeric strings become numbers; junk becomes null, never 0 or NaN", () => {
    const [p] = parseRoster({
      athletes: [ath({ age: "27", dateOfBirth: "not a date", jersey: 8, displayHeight: "", displayWeight: undefined })],
    }).players;
    expect(p.age).toBe(27);
    expect(parseRoster({ athletes: [ath({ age: "abc" })] }).players[0].age).toBeNull();
    expect(parseRoster({ athletes: [ath({ age: "" })] }).players[0].age).toBeNull();
    expect(p.dob).toBeNull();
    expect(p.jersey).toBe("8");
    expect(p.height).toBeNull();
    expect(p.weight).toBeNull();
  });
  it("a missing position is 'Other', not a guessed position", () => {
    expect(parseRoster({ athletes: [ath({ position: undefined })] }).players[0]).toMatchObject({
      group: "Other",
      position: "",
    });
    expect(parseRoster({ athletes: [ath({ position: {} })] }).players[0].group).toBe("Other");
  });
  it("wrongly-typed nested data doesn't throw", () => {
    const weird = ath({ statistics: "x", links: "x", birthPlace: "x", headshot: 5, flag: [], injuries: "x" });
    expect(() => parseRoster({ athletes: [weird] })).not.toThrow();
    const p = parseRoster({ athletes: [weird] }).players[0];
    expect(p.stats).toEqual({});
    expect(p.photo).toBeNull();
    expect(p.availability.key).toBe("unknown");
  });
});

describe("league standings", () => {
  const entry = (id, stats) => ({ team: { id, displayName: `T${id}` }, stats });
  it("skips entries without a team id and keeps missing columns undefined, never 0", () => {
    const { rows } = parseStandings({
      children: [
        {
          standings: {
            entries: [
              entry(1, [
                { name: "rank", value: 1 },
                { name: "points", value: "n/a" },
              ]),
              { stats: [] },
              null,
              entry(2, "x"),
            ],
          },
        },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(rows[0].pts).toBeUndefined();
    expect(rows[0].gp).toBeUndefined();
    expect(getDiagnostics().dropped.standings).toBe(2);
  });
  it("accepts numeric strings in displayValue", () => {
    const { rows } = parseStandings({ standings: { entries: [entry(1, [{ name: "points", displayValue: "27" }])] } });
    expect(rows[0].pts).toBe(27);
  });
});

describe("match details", () => {
  it("rejects a non-object; tolerates every optional part being wrong", () => {
    for (const bad of [null, "x", []]) expect(() => parseSummary(bad)).toThrow(/Unexpected response format/);
    const out = parseSummary({ boxscore: { teams: "x" }, rosters: {}, keyEvents: "x", leaders: 5, header: [] });
    expect(out).toMatchObject({ stats: [], lineups: [], events: [], leaders: [] });
  });
  it("team stats that aren't numeric are left out rather than shown as zero", () => {
    const team = (id, v) => ({
      team: { id },
      statistics: [
        { name: "possessionPct", displayValue: v },
        { name: "totalShots", displayValue: "4" },
      ],
    });
    const out = parseSummary({ boxscore: { teams: [team("1", "n/a"), team("2", "40")] } });
    expect(out.stats.map((s) => s.key)).toEqual(["totalShots"]);
  });
  it("skips malformed events and roster entries", () => {
    const out = parseSummary({
      keyEvents: [
        null,
        "x",
        {
          scoringPlay: true,
          clock: { displayValue: "5'" },
          team: { id: 1 },
          participants: [{ athlete: { displayName: "Scorer" } }],
        },
        { type: { type: "unknown" } },
      ],
      rosters: [
        { team: { id: 1 }, roster: [null, { starter: true }, { starter: true, athlete: { id: 9, displayName: "P" } }] },
      ],
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ kind: "goal", primary: "Scorer", minute: "5'" });
    expect(out.lineups[0].starters).toHaveLength(1);
  });
});
