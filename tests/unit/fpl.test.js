import { describe, expect, it } from "vitest";
import { CLUBS } from "../../src/config/clubs.js";
import { buildFpl, readClubFixtures, readPlayers, readRules } from "../../scripts/lib/fpl.mjs";
import { validateFpl } from "../../scripts/lib/validate-data.mjs";
import {
  availability,
  espnSquads,
  findPlayers,
  fixtureRun,
  fmtPrice,
  fromGameweek,
  minutesShare,
  parseFpl,
  parsePrice,
  replacements,
  rows,
  sellingPrice,
  sortKey,
  sortRows,
  transferBudget,
} from "../../src/lib/fpl.js";
import { pageKey, parseHash, toHash } from "../../src/lib/route.js";
import { titleFor } from "../../src/lib/titles.js";

const [A, B, C] = CLUBS;
const clubs = [A, B, C];
const slugs = new Set(clubs.map((c) => c.slug));
const now = new Date("2026-11-20T04:00:00Z");

/** A bootstrap-static shaped like FPL's, for three clubs. */
function bootstrap({ players = 120, extra = [] } = {}) {
  const elements = Array.from({ length: players }, (_, i) => ({
    id: i + 1,
    web_name: `P${i + 1}`,
    first_name: "First",
    second_name: `Last${i + 1}`,
    team: (i % 3) + 1,
    element_type: (i % 4) + 1,
    now_cost: 45 + (i % 60),
    selected_by_percent: "1.5",
    total_points: i,
    points_per_game: "2.0",
    form: String((i % 10) / 2),
    minutes: 90 * (i % 11),
    starts: i % 11,
    status: "a",
    chance_of_playing_next_round: null,
    news: "",
    expected_goals: "0.50",
    expected_assists: "0.25",
    ep_next: "3.0",
    can_select: true,
    removed: false,
  }));
  return {
    teams: clubs.map((c, i) => ({ id: i + 1, short_name: c.abbr, name: c.name })),
    element_types: [
      { id: 1, singular_name_short: "GKP", squad_select: 2 },
      { id: 2, singular_name_short: "DEF", squad_select: 5 },
      { id: 3, singular_name_short: "MID", squad_select: 5 },
      { id: 4, singular_name_short: "FWD", squad_select: 3 },
    ],
    game_settings: { squad_squadsize: 15, squad_team_limit: 3, squad_total_spend: 1000, transfers_sell_on_fee: 0.5 },
    events: [
      { id: 10, deadline_time: "2026-11-06T18:30:00Z", finished: true, is_current: true },
      { id: 11, deadline_time: "2026-11-21T11:00:00Z", finished: false, is_next: true },
    ],
    elements: [...elements, ...extra],
  };
}

const fx = (id, event, h, a, extra = {}) => ({
  id,
  event,
  team_h: h,
  team_a: a,
  kickoff_time: event ? `2026-11-${String(10 + (event % 20)).padStart(2, "0")}T15:00:00Z` : null,
  finished: false,
  team_h_difficulty: 2,
  team_a_difficulty: 4,
  ...extra,
});
const fixtures = [
  fx(1, 10, 1, 2, { finished: true }),
  fx(2, 10, 3, 1, { finished: true }),
  fx(3, 11, 1, 2), // club 3 blank in gameweek 11
  fx(4, 12, 1, 3),
  fx(5, 12, 2, 1), // club 1 double in gameweek 12
  fx(6, 13, 2, 3),
  fx(7, null, 3, 2), // postponed, no gameweek yet
  fx(8, 30, 1, 2), // beyond the window
];

describe("FPL pipeline (scripts/lib/fpl.mjs)", () => {
  it("reads the squad rules from FPL's settings", () => {
    expect(readRules(bootstrap())).toEqual({
      squadSize: 15,
      perClub: 3,
      budget: 1000,
      sellOnFee: 0.5,
      perPosition: { GKP: 2, DEF: 5, MID: 5, FWD: 3 },
    });
    expect(readRules({})).toMatchObject({ squadSize: null, perClub: null, budget: null, sellOnFee: null });
  });

  it("leaves out players nobody can pick, keeps numbers as numbers and null as null", () => {
    const teams = new Map(clubs.map((c, i) => [i + 1, c.slug]));
    const extra = [
      { ...bootstrap().elements[0], id: 900, can_select: false, status: "u" },
      { ...bootstrap().elements[0], id: 901, removed: true },
      { ...bootstrap().elements[0], id: 902, team: 99 },
      { ...bootstrap().elements[0], id: 903, chance_of_playing_next_round: 75, status: "d", news: "Knock" },
    ];
    const players = readPlayers(bootstrap({ players: 4, extra }), teams, { 5501: { fpl: 2 } });
    expect(players.map((p) => p.id)).toEqual([1, 2, 3, 4, 903]);
    const p1 = players[0];
    expect(p1).toMatchObject({ club: A.slug, pos: "GKP", price: 45, owned: 1.5, form: 0, xg: 0.5, chance: null });
    expect(p1.espn).toBeNull();
    expect(players[1].espn).toBe("5501");
    expect(players[4]).toMatchObject({ status: "d", chance: 75, news: "Knock" });
  });

  it("keeps blank and double gameweeks as FPL has them, and unscheduled fixtures without a number", () => {
    const teams = new Map(clubs.map((c, i) => [i + 1, c.slug]));
    const out = readClubFixtures(fixtures, teams, 10, 6);
    expect(out[A.slug].played).toBe(2);
    expect(out[B.slug].played).toBe(1);
    expect(out[A.slug].fixtures.map((f) => f.gw)).toEqual([11, 12, 12]);
    expect(out[C.slug].fixtures.map((f) => f.gw)).toEqual([12, 13, null]);
    expect(out[A.slug].fixtures[0]).toMatchObject({ opp: B.slug, home: true, fdr: 2 });
    expect(out[B.slug].fixtures[0]).toMatchObject({ opp: A.slug, home: false, fdr: 4 });
  });

  it("builds a valid fpl.json, and refuses unusable input", () => {
    const { fpl, problems } = buildFpl({ bootstrap: bootstrap(), fixtures, clubs, now });
    expect(problems).toEqual([]);
    expect(validateFpl(fpl, { clubSlugs: slugs })).toEqual([]);
    expect(fpl.gameweeks.next).toEqual({ id: 11, deadline: "2026-11-21T11:00:00Z", finished: false });
    expect(fpl.carriedOver).toBe(false);
    expect(buildFpl({ bootstrap: null, fixtures, clubs, now }).fpl).toBeNull();
    expect(buildFpl({ bootstrap: bootstrap({ players: 50 }), fixtures, clubs, now }).fpl).toBeNull();
    const unknownTeam = { ...bootstrap(), teams: [...bootstrap().teams, { id: 4, short_name: "XXX" }] };
    expect(buildFpl({ bootstrap: unknownTeam, fixtures, clubs, now }).problems[0]).toMatch(/XXX/);
  });

  it("validation catches malformed players, fixtures and addresses", () => {
    const { fpl } = buildFpl({ bootstrap: bootstrap(), fixtures, clubs, now });
    const bad = structuredClone(fpl);
    bad.players[0].price = 4.5;
    bad.players[1].pos = "GK";
    expect(validateFpl(bad, { clubSlugs: slugs })).toContain("2 players malformed");
    const badFix = structuredClone(fpl);
    badFix.clubs[A.slug].fixtures[0].fdr = 7;
    expect(validateFpl(badFix, { clubSlugs: slugs })).toContain(`clubs.${A.slug} malformed`);
    const leak = structuredClone(fpl);
    leak.players[0].news = "see 10.0.0.12";
    expect(validateFpl(leak, { clubSlugs: slugs })).toContain("fpl.json contains an IP address");
    expect(validateFpl(null, { clubSlugs: slugs })).toEqual(["fpl.json is not an object"]);
  });
});

describe("FPL page logic (src/lib/fpl.js)", () => {
  const file = JSON.parse(JSON.stringify(buildFpl({ bootstrap: bootstrap(), fixtures, clubs, now }).fpl));
  const fpl = parseFpl(file);

  it("parses the file and a saved copy of its own output the same way", () => {
    expect(fpl.players).toHaveLength(120);
    expect(fpl.next).toEqual({ id: 11, deadline: new Date("2026-11-21T11:00:00Z"), finished: false });
    expect(fpl.clubs[A.slug].fixtures[0].kickoff).toBeInstanceOf(Date);
    const again = parseFpl(
      JSON.parse(JSON.stringify(fpl), (k, v) =>
        (k === "deadline" || k === "kickoff" || k === "asOf" || k === "generatedAt") && typeof v === "string"
          ? new Date(v)
          : v,
      ),
    );
    expect(again.next).toEqual(fpl.next);
    expect(again.players).toEqual(fpl.players);
    expect(() => parseFpl("nope")).toThrow();
  });

  it("formats and reads prices in tenths of £1m", () => {
    expect(fmtPrice(75)).toBe("£7.5m");
    expect(fmtPrice(null)).toBe("–");
    expect(parsePrice("1.5")).toBe(15);
    expect(parsePrice("£0.0m")).toBe(0);
    expect(parsePrice(" 12 ")).toBe(120);
    expect(parsePrice("1.55")).toBeNull();
    expect(parsePrice("-1")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
  });

  it("applies FPL's sell-on rule: half the rise, rounded down; the current price after a fall", () => {
    expect(sellingPrice(60, 62)).toBe(61);
    expect(sellingPrice(60, 61)).toBe(60);
    expect(sellingPrice(60, 63)).toBe(61);
    expect(sellingPrice(60, 60)).toBe(60);
    expect(sellingPrice(60, 57)).toBe(57);
    const out = fpl.players[0];
    expect(transferBudget({ out, bank: 15 })).toEqual({
      sell: out.price,
      bank: 15,
      total: out.price + 15,
      assumedPrice: true,
    });
    expect(transferBudget({ out: { ...out, price: 64 }, bank: 0, paid: 60, fee: 0.5 }).total).toBe(62);
  });

  it("runs fixtures by gameweek: blank, double, and the average difficulty over them", () => {
    expect(fromGameweek(fpl)).toBe(11);
    const runA = fixtureRun(fpl.clubs[A.slug], 11, 3);
    expect(runA.weeks.map((w) => w.fixtures.length)).toEqual([1, 2, 0]);
    expect(runA.matches).toBe(3);
    expect(runA.difficulty).toBe(2.7); // 2 (home), 2 (home), 4 (away) → 2.67
    const runC = fixtureRun(fpl.clubs[C.slug], 11, 1);
    expect(runC.weeks[0].fixtures).toEqual([]);
    expect(runC.difficulty).toBeNull();
    expect(fixtureRun(undefined, 11, 2).matches).toBe(0);
  });

  it("minutes share is null when nothing is known, and capped at 100%", () => {
    const p = fpl.players.find((x) => x.club === A.slug && x.minutes === 90);
    expect(minutesShare(p, { played: 2 })).toBe(0.5);
    expect(minutesShare({ ...p, minutes: null }, { played: 2 })).toBeNull();
    expect(minutesShare(p, { played: 0 })).toBeNull();
    expect(minutesShare({ ...p, minutes: 999 }, { played: 2 })).toBe(1);
  });

  it("treats no flag as available, never as 0%", () => {
    const p = fpl.players[0];
    expect(availability({ ...p, status: "a", chance: null })).toBe("available");
    expect(availability({ ...p, status: "a", chance: 100 })).toBe("available");
    expect(availability({ ...p, status: "d", chance: 75 })).toBe("doubtful");
    expect(availability({ ...p, status: "d", chance: null })).toBe("doubtful");
    expect(availability({ ...p, status: "i", chance: 0 })).toBe("out");
    expect(availability({ ...p, status: "i", chance: 25 })).toBe("out");
    expect(availability({ ...p, status: "s", chance: null })).toBe("out");
  });

  it("suggests same-position players within budget, never the player out, available unless asked", () => {
    const out = fpl.players.find((p) => p.pos === "MID");
    const players = fpl.players.map((p, i) =>
      i === 6 ? { ...p, status: "d", chance: 75 } : i === 10 ? { ...p, status: "i", chance: 0 } : p,
    );
    const data = { ...fpl, players };
    const budget = 63; // midfielders cost 47 + 4k tenths in this data, so one costs exactly this
    const { rows: list, total } = replacements(data, out, { budget, limit: 500 });
    expect(list.every((r) => r.player.pos === "MID" && r.player.id !== out.id && r.player.price <= budget)).toBe(true);
    expect(list.some((r) => r.player.price === budget)).toBe(true); // exactly the budget is affordable
    expect(total).toBe(list.length);
    const ids = list.map((r) => r.player.id);
    expect(ids).not.toContain(players[6].id);
    expect(ids).not.toContain(players[10].id);
    const withDoubtful = replacements(data, out, { budget: 200, includeDoubtful: true, limit: 500 }).rows.map(
      (r) => r.player.id,
    );
    if (players[6].pos === "MID") expect(withDoubtful).toContain(players[6].id);
    expect(withDoubtful).not.toContain(players[10].id);
    // Sorted by form, highest first.
    const forms = list.map((r) => r.player.form);
    expect(forms).toEqual([...forms].sort((a, b) => b - a));
  });

  it("sorts with unknown values last and lowest-first sorts ascending", () => {
    const list = rows(fpl, fpl.players.slice(0, 6), 3);
    list[0].player = { ...list[0].player, form: null };
    const byForm = sortRows(list, "form");
    expect(byForm.at(-1).player.form).toBeNull();
    const byPrice = sortRows(list, "price").map((r) => r.player.price);
    expect(byPrice).toEqual([...byPrice].sort((a, b) => a - b));
    expect(sortKey("nonsense")).toBe("form");
    expect(sortKey("fixtures")).toBe("fixtures");
  });

  it("finds players by short or full name, accent-insensitive", () => {
    const players = [
      { ...fpl.players[0], id: 1, name: "Muñoz", fullName: "Daniel Muñoz" },
      { ...fpl.players[0], id: 2, name: "Munro", fullName: "Ian Munro" },
    ];
    expect(findPlayers(players, "mun").map((p) => p.id)).toEqual([1, 2]);
    expect(findPlayers(players, "daniel").map((p) => p.id)).toEqual([1]);
    expect(findPlayers(players, "m")).toEqual([]);
  });
});

describe("FPL route", () => {
  it("parses and rebuilds the address, dropping anything malformed", () => {
    const r = parseHash("#/fpl?view=assistant&out=123&bank=15&paid=60&gws=5&sort=fixtures&doubtful=1");
    expect(r).toMatchObject({
      name: "fpl",
      view: "assistant",
      out: "123",
      bank: 15,
      paid: 60,
      gws: 5,
      sort: "fixtures",
      doubtful: true,
    });
    expect(parseHash(toHash(r))).toEqual(r);
    const bad = parseHash("#/fpl?view=hack&out=1x&bank=99999&gws=4&pos=GK&club=Bad%20Slug&sort=%3Cb%3E");
    expect(bad).toMatchObject({ view: "players", out: null, bank: null, gws: null, pos: null, club: null, sort: null });
    expect(toHash(parseHash("#/fpl"))).toBe("#/fpl");
    expect(titleFor(parseHash("#/fpl?view=compare"))).toMatch(/^Compare FPL players/);
  });
});

describe("pageKey", () => {
  it("ignores filters, so changing one keeps focus; a new view or page is a new key", () => {
    const k = (h) => pageKey(parseHash(h));
    expect(k("#/fpl?view=assistant&out=1")).toBe(k("#/fpl?view=assistant&out=1&bank=15&sort=price"));
    expect(k("#/fpl?view=assistant")).not.toBe(k("#/fpl?view=compare"));
    expect(k("#/stats?club=a-b")).toBe(k("#/stats"));
    expect(k("#/stats?view=players")).not.toBe(k("#/stats"));
    expect(k("#/compare?a=1")).toBe(k("#/compare?a=1&b=2"));
    expect(k("#/club/x")).not.toBe(k("#/club/y"));
    expect(k("#/player/1")).not.toBe(k("#/player/2"));
  });
});

describe("FPL and the news (rule 3)", () => {
  const fpl = parseFpl(JSON.parse(JSON.stringify(buildFpl({ bootstrap: bootstrap(), fixtures, clubs, now }).fpl)));

  it("a player FPL hasn't flagged but the news reports injured is doubtful, not available", () => {
    const p = { ...fpl.players[0], status: "a", chance: null, espn: "77" };
    expect(availability(p, true)).toBe("doubtful");
    expect(availability({ ...p, status: "i", chance: 0 }, true)).toBe("out");
    const out = fpl.players.find((x) => x.pos === p.pos && x.id !== p.id);
    const data = { ...fpl, players: fpl.players.map((x) => (x.id === p.id ? p : x)) };
    const ids = (opts) => replacements(data, out, { budget: 200, limit: 500, ...opts }).rows.map((r) => r.player.id);
    expect(ids({})).toContain(p.id);
    expect(ids({ reported: new Set(["77"]) })).not.toContain(p.id);
    expect(ids({ reported: new Set(["77"]), includeDoubtful: true })).toContain(p.id);
  });

  it("groups matched players into squads with their ESPN names for the headline check", () => {
    const players = [
      { ...fpl.players[0], club: A.slug, espn: "1", espnName: "Ann One", espnLast: "One" },
      { ...fpl.players[1], club: A.slug, espn: null, espnName: null, espnLast: null },
      { ...fpl.players[2], club: B.slug, espn: "3", espnName: "Cy Three", espnLast: null },
    ];
    const squads = espnSquads(players);
    expect(squads.get(A.slug)).toEqual([{ id: "1", name: "Ann One", lastName: "One" }]);
    expect(squads.get(B.slug)).toEqual([{ id: "3", name: "Cy Three", lastName: null }]);
  });

  it("the pipeline adds ESPN names only to matched players", () => {
    const teams = new Map(clubs.map((c, i) => [i + 1, c.slug]));
    const players = readPlayers(bootstrap({ players: 3 }), teams, { 501: { fpl: 1 } }, [
      { id: "501", name: "Full Name", lastName: "Name" },
      { id: "502", name: "Other", lastName: null },
    ]);
    expect(players[0]).toMatchObject({ espn: "501", espnName: "Full Name", espnLast: "Name" });
    expect(players[1]).toMatchObject({ espn: null, espnName: null, espnLast: null });
  });
});

describe("regular starters", () => {
  it("keeps only players with at least the given share of their club's minutes, unknown share excluded", () => {
    const fpl = parseFpl(JSON.parse(JSON.stringify(buildFpl({ bootstrap: bootstrap(), fixtures, clubs, now }).fpl)));
    const out = fpl.players.find((p) => p.pos === "FWD");
    const all = replacements(fpl, out, { budget: 200, limit: 500 }).rows;
    const regular = replacements(fpl, out, { budget: 200, limit: 500, minShare: 0.6 }).rows;
    expect(regular.length).toBeLessThan(all.length);
    expect(regular.every((r) => r.share != null && r.share >= 0.6)).toBe(true);
    expect(parseHash("#/fpl?view=assistant&regular=1").regular).toBe(true);
    expect(toHash(parseHash("#/fpl?view=assistant&regular=1"))).toContain("regular=1");
  });
});
