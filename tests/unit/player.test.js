import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareRows, parseAthlete, parseGamelog, seasonStats } from "../../src/lib/player.js";
import { parseHash, toHash } from "../../src/lib/route.js";
import { titleFor } from "../../src/lib/titles.js";
import { fplMinutes } from "../../scripts/lib/league.mjs";
import { validateLeague } from "../../scripts/lib/validate-data.mjs";
import { parseLeague } from "../../src/lib/league.js";
import { CLUBS } from "../../src/config/clubs.js";

const fixture = (name) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "e2e", "fixtures", name), "utf8"));

describe("routes and titles", () => {
  it("parses and builds player and compare routes, digits only", () => {
    expect(parseHash("#/player/253989")).toEqual({ name: "player", playerId: "253989" });
    expect(parseHash("#/player/abc").name).toBe("not-found");
    expect(parseHash("#/compare?a=1&b=2")).toEqual({ name: "compare", a: "1", b: "2" });
    expect(parseHash("#/compare?a=x")).toEqual({ name: "compare", a: null, b: null });
    expect(toHash({ name: "compare", a: "1", b: null })).toBe("#/compare?a=1");
    expect(toHash({ name: "compare", a: null, b: null })).toBe("#/compare");
    expect(toHash({ name: "player", playerId: "7" })).toBe("#/player/7");
  });
  it("titles name the player, or the two players compared", () => {
    expect(titleFor({ name: "player", playerId: "1" }, { playerName: "Declan Rice" })).toBe(
      "Declan Rice · Premier League Hub",
    );
    expect(titleFor({ name: "player", playerId: "1" })).toBe("Player · Premier League Hub");
    expect(titleFor({ name: "compare", a: "1", b: "2" }, { compareNames: ["A", "B"] })).toBe(
      "A v B · Compare players · Premier League Hub",
    );
  });
});

describe("parseAthlete", () => {
  it("reads the recorded bio", () => {
    const a = parseAthlete(fixture("athlete.json"));
    expect(a).toMatchObject({ id: expect.stringMatching(/^\d+$/), teamId: "359" });
    expect(typeof a.name).toBe("string");
    expect(a.flag).toMatch(/^https:\/\//);
  });
  it("never invents a photo, and keeps missing fields null", () => {
    const a = parseAthlete({ athlete: { id: "9", displayName: "X", headshot: { href: "javascript:x" } } });
    expect(a).toMatchObject({ photo: null, age: null, nationality: null, jersey: null, teamId: null });
  });
  it("rejects a response without an athlete", () => {
    expect(() => parseAthlete({})).toThrow(/Unexpected response format/);
    expect(() => parseAthlete({ athlete: { id: "9" } })).toThrow();
  });
});

describe("parseGamelog", () => {
  it("reads the recorded log, newest first, with stats by name", () => {
    const { season, games } = parseGamelog(fixture("gamelog.json"));
    expect(season).toMatch(/Premier League/);
    expect(games.length).toBeGreaterThan(0);
    for (let i = 1; i < games.length; i++) expect(games[i - 1].date >= games[i].date).toBe(true);
    expect(Object.keys(games[0].stats)).toContain("totalGoals");
  });
  it("works out the player's side of the score, and leaves unknowns null", () => {
    const log = {
      names: ["totalGoals", "yellowCards"],
      events: {
        1: { atVs: "@", gameDate: "2026-11-07T17:30:00Z", homeTeamScore: "3", awayTeamScore: "1", gameResult: "L" },
        2: { atVs: "?", gameDate: "2026-11-01T15:00:00Z", homeTeamScore: "1", awayTeamScore: "1" },
      },
      seasonTypes: [
        {
          displayName: "S",
          categories: [
            {
              events: [
                { eventId: "1", stats: ["1", ""] },
                { eventId: "2", stats: [] },
              ],
            },
          ],
        },
      ],
    };
    const [away, unknown] = parseGamelog(log).games;
    expect(away).toMatchObject({ home: false, teamScore: 1, oppScore: 3, result: "L" });
    expect(away.stats).toEqual({ totalGoals: 1, yellowCards: null });
    expect(unknown).toMatchObject({ home: null, teamScore: null, result: null });
  });
});

describe("seasonStats and compareRows", () => {
  const outfield = {
    group: "Midfielders",
    stats: { appearances: 10, subIns: 2, totalGoals: 3, goalAssists: 0, yellowCards: 2 },
  };
  it("keeps a missing figure null (not 0), and a real 0 as 0", () => {
    const rows = seasonStats(outfield, null);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.goalAssists.value).toBe(0);
    expect(by.totalShots.value).toBeNull();
    expect(by.minutes).toMatchObject({ value: null, source: "FPL" });
    expect(by.goalsPer90.value).toBeNull(); // no minutes, no per-90
    expect(by.appearances.detail).toBe("8 starts, 2 as a substitute");
  });
  it("derives per-90 only from 90 minutes played", () => {
    const by = (m) => Object.fromEntries(seasonStats(outfield, m).map((r) => [r.key, r.value]));
    expect(by({ minutes: 900, starts: 10 }).goalsPer90).toBe(0.3);
    expect(by({ minutes: 45, starts: 0 }).goalsPer90).toBeNull();
  });
  it("gives goalkeepers saves and conceded instead of attacking figures", () => {
    const keys = seasonStats({ group: "Goalkeepers", stats: { saves: 30 } }, null).map((r) => r.key);
    expect(keys).toContain("saves");
    expect(keys).not.toContain("totalShots");
    expect(keys).not.toContain("goalsPer90");
  });
  it("marks the better side, lower for cards, and nobody when a side is unknown or level", () => {
    const a = seasonStats(outfield, { minutes: 900, starts: 8 });
    const b = seasonStats(
      { group: "Forwards", stats: { appearances: 10, totalGoals: 5, goalAssists: 0, yellowCards: 0 } },
      null,
    );
    const rows = Object.fromEntries(compareRows(a, b).map((r) => [r.key, r]));
    expect(rows.totalGoals.better).toBe("b");
    expect(rows.yellowCards.better).toBe("b");
    expect(rows.goalAssists.better).toBeNull();
    expect(rows.minutes).toMatchObject({ a: 900, b: null, better: null });
  });
});

describe("FPL minutes (pipeline)", () => {
  const teams = new Map([[1, "arsenal"]]);
  const el = (id, first, second, web, minutes = 90) => ({
    id,
    team: 1,
    first_name: first,
    second_name: second,
    web_name: web,
    minutes,
    starts: 1,
  });
  const squad = (id, name, lastName) => ({ id, name, lastName, club: "arsenal" });
  it("matches by full name, surname, the last word of FPL's surname, or web name, and nothing looser", () => {
    const bootstrap = {
      elements: [
        el(1, "Declan", "Rice", "Rice", 822),
        el(2, "Gabriel", "dos Santos Magalhães", "Gabriel", 900),
        el(3, "Martin", "Ødegaard", "Ødegaard", 0),
        el(4, "Ben", "White", "White"),
        el(5, "Ben", "Whitley", "Whitley"),
        el(6, "Jorge", "Luiz Frello Filho", "Jorginho"),
      ],
    };
    const players = [
      squad("10", "Declan Rice", "Rice"),
      squad("20", "Gabriel Magalhães", "Magalhães"),
      squad("30", "Martin Odegaard", "Odegaard"),
      squad("40", "Ben White", "White"),
      squad("60", "Jorginho", "Jorginho"),
      squad("70", "Someone Else", "Else"),
    ];
    const { minutes, unmatched } = fplMinutes(bootstrap, teams, players);
    expect(minutes["10"]).toEqual({ fpl: 1, minutes: 822, starts: 1 });
    expect(minutes["20"].fpl).toBe(2);
    expect(minutes["30"]).toMatchObject({ fpl: 3, minutes: 0 }); // a real 0 stays 0
    expect(minutes["40"].fpl).toBe(4);
    expect(minutes["60"].fpl).toBe(6);
    expect(minutes["70"]).toBeUndefined();
    expect(unmatched).toBe(1);
  });
  it("won't pair on a surname two squad players share", () => {
    const bootstrap = { elements: [el(1, "Ethan", "Nwaneri", "Nwaneri")] };
    const players = [squad("1", "E. Nwaneri", "Nwaneri"), squad("2", "M. Nwaneri", "Nwaneri")];
    expect(fplMinutes(bootstrap, teams, players).minutes).toEqual({});
  });
  it("league.json's minutes are validated and parsed", () => {
    const file = fixture("league.json");
    const slugs = { clubSlugs: new Set(CLUBS.map((c) => c.slug)) };
    expect(validateLeague(file, slugs)).toEqual([]);
    expect(validateLeague({ ...file, minutes: { abc: { fpl: 1, minutes: 5 } } }, slugs)).toEqual(["minutes malformed"]);
    const parsed = parseLeague({
      ...file,
      minutes: { 1: { fpl: 1, minutes: -5, starts: 0 }, 2: { fpl: 2, minutes: 90, starts: 1 } },
    });
    expect(parsed.minutes).toEqual({ 2: { fpl: 2, minutes: 90, starts: 1 } });
    expect(parseLeague({ ...file, missing: ["minutes"] }).minutes).toBeNull();
  });
});
