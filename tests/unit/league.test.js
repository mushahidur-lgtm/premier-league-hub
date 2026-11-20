import { describe, expect, it } from "vitest";
import { CLUBS } from "../../src/config/clubs.js";
import {
  buildLeague,
  carryOver,
  leagueForm,
  mapTeams,
  readFixtures,
  readGameweeks,
  readLeaders,
} from "../../scripts/lib/league.mjs";
import { validateLeague } from "../../scripts/lib/validate-data.mjs";
import {
  defaultGameweek,
  filterCounts,
  filterKind,
  filterMatches,
  gameweekMatches,
  keyFixtures,
  parseLeague,
  scoreboardDates,
} from "../../src/lib/league.js";

// FPL team ids 1–20 in FPL's own alphabetical order, as bootstrap-static lists them (2026-27).
const FPL_SHORT = "ARS AVL BOU BRE BHA CHE COV CRY EVE FUL HUL IPS LEE LIV MCI MUN NEW NFO TOT SUN".split(" ");
const bootstrap = {
  teams: FPL_SHORT.map((s, i) => ({ id: i + 1, short_name: s, name: s })),
  events: [
    { id: 10, name: "Gameweek 10", deadline_time: "2026-11-06T18:30:00Z", finished: true, is_current: true },
    { id: 11, name: "Gameweek 11", deadline_time: "2026-11-20T18:30:00Z", finished: false, is_next: true },
    { id: 12, name: "Gameweek 12", deadline_time: "2026-11-27T18:30:00Z", finished: false },
  ],
};
const fx = (id, event, kickoff, h, a, hs = null, as = null, done = false) => ({
  id,
  event,
  kickoff_time: kickoff,
  team_h: h,
  team_a: a,
  team_h_score: hs,
  team_a_score: as,
  started: done || hs != null,
  finished: done,
  finished_provisional: done,
});
const ARS = 1;
const CHE = 6;
const LIV = 14;
const MCI = 15;
const fplFixtures = [
  fx(1, 10, "2026-11-08T15:00:00Z", ARS, CHE, 2, 0, true),
  fx(2, 10, "2026-11-08T17:30:00Z", LIV, MCI, 1, 1, true),
  fx(3, 11, "2026-11-21T12:30:00Z", MCI, ARS),
  fx(4, 11, "2026-11-22T16:30:00Z", CHE, LIV),
  fx(5, null, null, ARS, LIV), // postponed, not yet rescheduled
  fx(6, 11, "2026-11-21T15:00:00Z", 99, ARS), // unknown team
];
const clubs = CLUBS.map(({ slug, espnId, abbr }) => ({ slug, espnId, abbr }));
const slugs = { clubSlugs: new Set(CLUBS.map((c) => c.slug)) };
const NOW = new Date("2026-11-19T20:00:00Z");
const squads = [{ id: "1", name: "Declan Rice", lastName: "Rice", club: "arsenal" }];
bootstrap.elements = [
  { id: 7, team: 1, first_name: "Declan", second_name: "Rice", web_name: "Rice", minutes: 822, starts: 10 },
];

describe("pipeline: league.json", () => {
  it("maps all 20 FPL teams to clubs by short name", () => {
    const { map, unmatched } = mapTeams(bootstrap, clubs);
    expect(unmatched).toEqual([]);
    expect(map.size).toBe(20);
    expect(map.get(ARS)).toBe("arsenal");
    expect(map.get(19)).toBe("tottenham");
  });
  it("reads gameweeks and fixtures, keeping FPL's numbers and skipping what it can't place", () => {
    expect(readGameweeks(bootstrap).map((g) => [g.id, g.current, g.next, g.finished])).toEqual([
      [10, true, false, true],
      [11, false, true, false],
      [12, false, false, false],
    ]);
    const { fixtures, skipped } = readFixtures(fplFixtures, mapTeams(bootstrap, clubs).map);
    expect(skipped).toBe(1);
    expect(fixtures.find((f) => f.id === 5)).toMatchObject({ gameweek: null, kickoff: null });
    expect(fixtures.find((f) => f.id === 3)).toMatchObject({ homeScore: null, finished: false });
  });
  it("derives form from finished matches, oldest first, for both clubs", () => {
    const { fixtures } = readFixtures(fplFixtures, mapTeams(bootstrap, clubs).map);
    const form = leagueForm(fixtures, ["arsenal", "chelsea", "liverpool", "everton"]);
    expect(form.arsenal).toEqual([
      expect.objectContaining({ result: "W", opponent: "chelsea", home: true, for: 2, against: 0 }),
    ]);
    expect(form.chelsea[0]).toMatchObject({ result: "L", home: false });
    expect(form.liverpool[0].result).toBe("D");
    expect(form.everton).toEqual([]);
  });
  it("keeps only the last five", () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      fx(100 + i, i + 1, `2026-09-0${i + 1}T15:00:00Z`, ARS, CHE, i % 2, 0, true),
    );
    const { fixtures } = readFixtures(many, mapTeams(bootstrap, clubs).map);
    expect(leagueForm(fixtures, ["arsenal"]).arsenal.map((e) => e.fixture)).toEqual([102, 103, 104, 105, 106]);
  });
  it("reads leaders, keeps a tie at the cut, and reads apps only when ESPN gives them", () => {
    const leader = (id, value, matches) => ({
      value,
      displayValue: matches == null ? `Goals: ${value}` : `Matches: ${matches}, Goals: ${value}`,
      athlete: { id: String(id), displayName: `P${id}`, team: { id: "359" } },
    });
    const stats = {
      stats: [
        { name: "goalsLeaders", leaders: [leader(1, 9, 10), leader(2, 7, null), leader(3, 7, 9), leader(4, 5, 9)] },
      ],
    };
    const { goals, assists } = readLeaders(stats, new Map([["359", "arsenal"]]), 2);
    expect(goals.map((g) => g.id)).toEqual(["1", "2", "3"]);
    expect(goals[1]).toMatchObject({ club: "arsenal", matches: null });
    expect(assists).toEqual([]);
  });
  it("lists a failed source as missing instead of filling it in", () => {
    const { league } = buildLeague(null, null, clubs, NOW);
    expect(league).toMatchObject({ gameweeks: null, form: null, leaders: null });
    expect(league.missing.sort()).toEqual(["form", "gameweeks", "leaders", "minutes"]);
    expect(validateLeague(league, slugs)).toEqual([]);
  });
  it("produces a valid file from good data", () => {
    const { league, problems } = buildLeague({ bootstrap, fixtures: fplFixtures }, { stats: [] }, clubs, NOW, squads);
    expect(problems).toEqual(["1 FPL fixtures skipped as malformed"]);
    expect(league.missing).toEqual([]);
    expect(league.asOf.gameweeks).toBe(NOW.toISOString());
    expect(validateLeague(league, slugs)).toEqual([]);
  });
  it("refuses gameweek data when FPL's teams don't match the 20 clubs", () => {
    const bad = { ...bootstrap, teams: bootstrap.teams.map((t) => (t.id === 20 ? { ...t, short_name: "XYZ" } : t)) };
    const { league, problems } = buildLeague({ bootstrap: bad, fixtures: fplFixtures }, null, clubs, NOW);
    expect(league.gameweeks).toBeNull();
    expect(problems.join()).toMatch(/XYZ/);
  });
  it("carries a missing part over from the live file, with that file's date", () => {
    const good = buildLeague(
      { bootstrap, fixtures: fplFixtures },
      { stats: [] },
      clubs,
      new Date("2026-11-19T16:00:00Z"),
      squads,
    );
    const now = buildLeague(null, { stats: [] }, clubs, NOW).league;
    const merged = carryOver(now, good.league);
    expect(merged.missing).toEqual([]);
    expect(merged.carriedOver.sort()).toEqual(["form", "gameweeks", "minutes"]);
    expect(merged.asOf.gameweeks).toBe("2026-11-19T16:00:00.000Z");
    expect(merged.asOf.leaders).toBe(NOW.toISOString());
    expect(validateLeague(merged, slugs)).toEqual([]);
  });
  it("doesn't carry over a part the live file was missing too", () => {
    const empty = buildLeague(null, null, clubs, NOW).league;
    expect(carryOver(empty, empty).missing.sort()).toEqual(["form", "gameweeks", "leaders", "minutes"]);
  });
  it("validateLeague catches unknown clubs and bad results", () => {
    const { league } = buildLeague({ bootstrap, fixtures: fplFixtures }, { stats: [] }, clubs, NOW, squads);
    expect(validateLeague({ ...league, form: { arsenal: [{ result: "X", opponent: "chelsea" }] } }, slugs)).toEqual([
      "form malformed",
    ]);
    const fixtures = [{ ...league.fixtures[0], home: "real-madrid" }];
    expect(validateLeague({ ...league, fixtures }, slugs)).toEqual(["gameweeks or fixtures malformed"]);
  });
});

describe("browser: league dashboard", () => {
  const file = buildLeague({ bootstrap, fixtures: fplFixtures }, { stats: [] }, clubs, NOW, squads).league;
  const league = parseLeague(JSON.parse(JSON.stringify(file)));

  it("parses dates and drops records it can't trust", () => {
    expect(league.gameweeksAt).toEqual(NOW);
    expect(league.fixtures.find((f) => f.id === 3).kickoff).toEqual(new Date("2026-11-21T12:30:00Z"));
    const bad = parseLeague({ ...file, fixtures: [...file.fixtures, { id: 9, home: "nowhere", away: "arsenal" }] });
    expect(bad.fixtures).toHaveLength(league.fixtures.length);
  });
  it("hides a part the file lists as missing", () => {
    expect(parseLeague({ ...file, missing: ["form"] }).form).toBeNull();
  });
  it("opens on the current gameweek until it is finished, then the next", () => {
    expect(defaultGameweek(league.gameweeks)).toBe(11);
    const live = league.gameweeks.map((g) => (g.id === 10 ? { ...g, finished: false } : g));
    expect(defaultGameweek(live)).toBe(10);
    expect(defaultGameweek([])).toBeNull();
  });
  it("asks ESPN for each day of the gameweek", () => {
    expect(scoreboardDates(league.fixtures, 11)).toEqual(["20261121", "20261122"]);
    expect(scoreboardDates(league.fixtures, 12)).toEqual([]);
  });
  it("uses ESPN's match when it has the same home and away clubs, otherwise FPL's fixture without a link", () => {
    const espn = {
      id: "401",
      date: new Date("2026-11-21T12:30:00Z"),
      state: "in",
      clock: "34'",
      home: { id: "382", score: 1 },
      away: { id: "359", score: 0 },
    };
    const { dated, undated } = gameweekMatches(league.fixtures, 11, [espn]);
    expect(dated.map((m) => [m.source, m.id])).toEqual([
      ["espn", "401"],
      ["fpl", null],
    ]);
    expect(undated).toEqual([]);
    expect(gameweekMatches(league.fixtures, 99).dated).toEqual([]);
  });
  it("puts a fixture FPL hasn't dated under its own heading", () => {
    const withGw = league.fixtures.map((f) => (f.id === 5 ? { ...f, gameweek: 11 } : f));
    expect(gameweekMatches(withGw, 11).undated.map((m) => m.fplId)).toEqual([5]);
  });
  it("filters live, upcoming and completed by the provider's state", () => {
    const now = new Date("2026-11-21T13:00:00Z").getTime();
    const at = (iso) => new Date(iso);
    const ms = [
      { state: "in", date: at("2026-11-21T12:30:00Z") },
      { state: "post", date: at("2026-11-08T15:00:00Z") },
      { state: "pre", date: at("2026-11-22T16:30:00Z") },
      { state: "pre", date: at("2026-11-21T12:00:00Z") }, // kick-off passed, no result yet: not "completed"
      { state: "pre", date: at("2026-11-22T16:30:00Z"), postponed: true },
    ];
    expect(ms.map((m) => filterKind(m, now))).toEqual(["live", "completed", "upcoming", "upcoming", null]);
    expect(filterCounts(ms, now)).toEqual({ all: 5, live: 1, upcoming: 2, completed: 1 });
    expect(filterMatches(ms, "live", now)).toHaveLength(1);
    expect(filterMatches(ms, "all", now)).toHaveLength(5);
  });
  it("key fixtures: top-six and bottom-four meetings in the next two weeks, by the table", () => {
    const rank = (slug, r) => ({ id: CLUBS.find((c) => c.slug === slug).espnId, rank: r });
    const others = CLUBS.filter((c) => !["arsenal", "man-city", "chelsea", "liverpool"].includes(c.slug));
    const rows = [
      rank("arsenal", 1),
      rank("man-city", 3),
      rank("chelsea", 17),
      rank("liverpool", 20),
      ...others.map((c, i) => ({ id: c.espnId, rank: i + 4 })),
    ];
    const list = keyFixtures(league.fixtures, rows, NOW.getTime());
    expect(list.map((k) => [k.fixture.id, k.reason])).toEqual([
      [3, "Top-six meeting: 3rd v 1st"],
      [4, "Bottom-four meeting: 17th v 20th"],
    ]);
    expect(keyFixtures(league.fixtures, rows.slice(0, 10), NOW.getTime())).toEqual([]); // not a full table
  });
});
