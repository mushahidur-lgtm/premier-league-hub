import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLUBS, clubByEspnId } from "../../src/config/clubs.js";
import {
  buildStats,
  carryOverStats,
  readTeamStats,
  rosterStats,
  seasonLabel,
  withFpl,
} from "../../scripts/lib/stats.mjs";
import { validateStats } from "../../scripts/lib/validate-data.mjs";
import { parseLeague } from "../../src/lib/league.js";
import { parseStandings } from "../../src/lib/parsers.js";
import { parseHash, toHash } from "../../src/lib/route.js";
import {
  homeAway,
  metricBy,
  parseAthleteSeason,
  parseStats,
  PLAYER_METRICS,
  playerValue,
  progression,
  rankBy,
  TEAM_METRICS,
  teamValue,
} from "../../src/lib/stats.js";

const fixture = (name) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "e2e", "fixtures", name), "utf8"));
const slugs = { clubSlugs: new Set(CLUBS.map((c) => c.slug)) };
const espn = (stats) => ({
  splits: { categories: [{ name: "all", stats: Object.entries(stats).map(([name, value]) => ({ name, value })) }] },
});
const NOW = new Date("2026-11-19T19:00:00Z");

describe("pipeline: team statistics", () => {
  it("keeps the shown fields, turns ratios into percentages and impossible zeros into null", () => {
    const s = readTeamStats(
      espn({ appearances: 38, totalGoals: 69, possessionPct: 0, passPct: 0.8574, cleanSheet: 0, redCards: 0 }),
    );
    expect(s).toMatchObject({
      played: 38,
      goalsFor: 69,
      possession: null,
      passAccuracy: 85.7,
      cleanSheets: 0,
      redCards: 0,
    });
    expect(s.xgPerMatch).toBeNull(); // not given at all
    expect(readTeamStats({})).toBeNull();
  });
  it("labels seasons the way the league does", () => {
    expect(seasonLabel(2026)).toBe("2026-27");
    expect(seasonLabel(2099)).toBe("2099-00");
  });
  it("marks a club absent from the league that season, and a season with no data as missing", () => {
    const { stats, problems } = buildStats({
      now: NOW,
      years: [2026, 2025],
      teams: {
        2026: { arsenal: espn({ appearances: 10 }), chelsea: "error" },
        2025: { arsenal: "error", hull: "absent" },
      },
      players: null,
    });
    expect(stats.seasons[0].teams).toEqual({
      arsenal: { status: "ok", stats: expect.objectContaining({ played: 10 }) },
      chelsea: { status: "unavailable" },
    });
    expect(stats.seasons[1].teams.hull).toEqual({ status: "absent" });
    expect(stats.missing.sort()).toEqual(["players"]);
    expect(problems).toEqual([
      "2026-27: 1 of 2 clubs' statistics unavailable",
      "2025-26: 1 of 2 clubs' statistics unavailable",
    ]);
    expect(validateStats(stats, slugs)).toEqual([]);
    const allFailed = buildStats({ now: NOW, years: [2026], teams: { 2026: { arsenal: "error" } }, players: [] });
    expect(allFailed.stats.missing.sort()).toEqual(["current", "players"]);
  });
  it("reads squad figures and adds FPL minutes, xG and xA only for matched players", () => {
    const players = rosterStats(
      {
        athletes: [
          {
            id: 1,
            displayName: "A",
            position: { displayName: "Forward" },
            statistics: { splits: { categories: [{ stats: [{ name: "totalGoals", value: 3 }] }] } },
          },
          { id: 2, displayName: "B", position: { displayName: "Goalkeeper" } },
        ],
      },
      "arsenal",
    );
    expect(players[0]).toMatchObject({ id: "1", goals: 3, goalkeeper: false, assists: null });
    expect(players[1].goalkeeper).toBe(true);
    const joined = withFpl(
      players,
      { 1: { fpl: 9, minutes: 450 } },
      { elements: [{ id: 9, expected_goals: "2.31", expected_assists: "0.40" }] },
    );
    expect(joined[0]).toMatchObject({ minutes: 450, xg: 2.31, xa: 0.4 });
    expect(joined[1]).toMatchObject({ minutes: null, xg: null, xa: null });
  });
  it("carries a missing season over from the live file only if it is the same season", () => {
    const live = buildStats({
      now: new Date("2026-11-19T15:00:00Z"),
      years: [2026, 2025],
      teams: { 2026: { arsenal: espn({ appearances: 9 }) }, 2025: { arsenal: espn({ appearances: 38 }) } },
      players: withFpl(rosterStats({ athletes: [{ id: 1, displayName: "A" }] }, "arsenal"), null, null),
    }).stats;
    const now = buildStats({
      now: NOW,
      years: [2026, 2025],
      teams: { 2026: { arsenal: "error" }, 2025: { arsenal: espn({ appearances: 38 }) } },
      players: null,
    }).stats;
    const merged = carryOverStats(now, live);
    expect(merged.carriedOver.sort()).toEqual(["current", "players"]);
    expect(merged.asOf.current).toBe("2026-11-19T15:00:00.000Z");
    expect(validateStats(merged, slugs)).toEqual([]);
    const nextSeason = buildStats({
      now: NOW,
      years: [2027, 2026],
      teams: { 2027: { arsenal: "error" }, 2026: {} },
      players: null,
    }).stats;
    expect(carryOverStats(nextSeason, live).missing).toContain("current");
  });
  it("the recorded stats.json is valid", () => {
    expect(validateStats(fixture("stats.json"), slugs)).toEqual([]);
    expect(validateStats({ ...fixture("stats.json"), players: [{ id: "x" }] }, slugs)).toEqual(["players malformed"]);
  });
});

describe("browser: statistics", () => {
  const stats = parseStats(fixture("stats.json"));
  const league = parseLeague(fixture("league.json"));

  it("parses seasons with dates, and keeps absent clubs as absent", () => {
    expect(stats.seasons.map((s) => s.part)).toEqual(["current", "previous"]);
    expect(stats.seasons[0].asOf).toBeInstanceOf(Date);
    const absent = Object.values(stats.seasons[1].teams).filter((t) => t.status === "absent");
    expect(absent.length).toBeGreaterThan(0);
  });
  it("per match divides counts by matches played, never rates", () => {
    const goals = metricBy(TEAM_METRICS, "goalsFor");
    const poss = metricBy(TEAM_METRICS, "possession");
    const entry = { status: "ok", stats: { played: 10, goalsFor: 15, possession: 59.8 } };
    expect(teamValue(entry, goals, true)).toBe(1.5);
    expect(teamValue(entry, poss, true)).toBe(59.8);
    expect(teamValue({ status: "absent" }, goals, false)).toBeNull();
    expect(metricBy(TEAM_METRICS, "nonsense").key).toBe("goalsFor");
  });
  it("per 90 needs at least 90 FPL minutes", () => {
    const g = metricBy(PLAYER_METRICS, "goals");
    expect(playerValue({ goals: 9, minutes: 889 }, g, true)).toBe(0.91);
    expect(playerValue({ goals: 1, minutes: 45 }, g, true)).toBeNull();
    expect(playerValue({ goals: 1, minutes: null }, g, false)).toBe(1);
  });
  it("ranks best first, shares tied ranks, puts unknowns last, and flips when lower is better", () => {
    const r = rankBy([3, 5, 5, null, 1], (v) => v);
    expect(r.map((x) => [x.value, x.rank])).toEqual([
      [5, 1],
      [5, 1],
      [3, 3],
      [1, 4],
      [null, null],
    ]);
    expect(rankBy([3, 1], (v) => v, true).map((x) => x.value)).toEqual([1, 3]);
  });
  it("cross-check: FPL-derived clean sheets equal ESPN's for every club", () => {
    for (const c of CLUBS) {
      const ha = homeAway(league.fixtures, c.slug);
      expect(ha.home.cleanSheets + ha.away.cleanSheets, c.slug).toBe(stats.seasons[0].teams[c.slug].stats.cleanSheets);
    }
  });
  it("cross-check: the derived table after the last gameweek equals ESPN's table", () => {
    const table = parseStandings(fixture("standings.json"));
    const last = progression(league.fixtures).rounds.at(-1);
    for (const row of table.rows) {
      const t = last.table[clubByEspnId(row.id).slug];
      expect([t.position, t.points, t.gd], row.short).toEqual([row.rank, row.pts, row.gd]);
    }
  });
  it("progression shares a position between clubs level on points, goal difference and goals, and stops at an unfinished gameweek", () => {
    const f = (gameweek, home, away, homeScore, awayScore, finished = true) => ({
      gameweek,
      home,
      away,
      homeScore,
      awayScore,
      finished,
    });
    const p = progression(
      [
        f(1, "arsenal", "chelsea", 1, 1),
        f(1, "liverpool", "everton", 0, 0),
        f(2, "arsenal", "everton", 2, 0),
        f(2, "chelsea", "liverpool", null, null, false),
        f(3, "arsenal", "liverpool", 1, 0),
      ],
      ["arsenal", "chelsea", "liverpool", "everton"],
    );
    expect(p.rounds.map((r) => [r.gameweek, r.complete])).toEqual([
      [1, true],
      [2, false],
    ]);
    const gw1 = p.rounds[0].table;
    expect(gw1.arsenal).toMatchObject({ position: 1, tied: true, points: 1 });
    expect(gw1.chelsea).toMatchObject({ position: 1, tied: true });
    expect(gw1.liverpool).toMatchObject({ position: 3, tied: true });
    expect(p.rounds[1].table.arsenal).toMatchObject({ position: 1, tied: false, points: 4 });
    expect(progression(null)).toBeNull();
  });
  it("reads a player's season from ESPN's core API", () => {
    expect(parseAthleteSeason(fixture("athlete-season.json"))).toMatchObject({
      apps: expect.any(Number),
      minutes: expect.any(Number),
    });
    expect(parseAthleteSeason({})).toBeNull();
  });
});

describe("stats route", () => {
  it("parses and validates every filter, and round-trips", () => {
    const r = parseHash("#/stats?view=players&season=2025&club=arsenal,chelsea&player=7&metric=xg&per=1");
    expect(r).toEqual({
      name: "stats",
      view: "players",
      season: 2025,
      clubs: ["arsenal", "chelsea"],
      player: "7",
      metric: "xg",
      per: true,
    });
    expect(parseHash(toHash(r))).toEqual(r);
    expect(parseHash("#/stats?view=evil&season=20x5&club=A!,b&player=x&metric=<x>")).toEqual({
      name: "stats",
      view: "teams",
      season: null,
      clubs: ["b"],
      player: null,
      metric: null,
      per: false,
    });
    expect(parseHash("#/stats?club=a,b,c,d,e").clubs).toHaveLength(4);
    expect(
      toHash({ name: "stats", view: "teams", season: null, clubs: [], player: null, metric: null, per: false }),
    ).toBe("#/stats");
  });
});
