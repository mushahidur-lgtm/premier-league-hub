// @ts-check
/**
 * League dashboard logic over data/league.json (written by the pipeline from Fantasy Premier League and ESPN)
 * and ESPN's live scoreboard. Pure functions; nothing here invents a gameweek, score or statistic.
 *
 *   parseLeague      league.json → dates as Date, malformed records dropped
 *   defaultGameweek  the gameweek to open on: the current one until it is finished, then the next
 *   scoreboardDates  the days ESPN's scoreboard must be asked for to cover a gameweek
 *   gameweekMatches  FPL's fixture list for a gameweek, each matched to ESPN's live match when there is one
 *   filterMatches    live / upcoming / completed
 *   keyFixtures      upcoming meetings between top-six clubs, or between bottom-four clubs, by the current table
 */
import { CLUBS, clubBySlug, crestUrl } from "../config/clubs.js";
import { ordinal } from "./format.js";
import { matchPhase } from "./hero.js";
import { expectObject } from "./validate.js";

/**
 * @typedef {{ id: number, name: string, deadline: Date | null, finished: boolean, current: boolean, next: boolean }} Gameweek
 * @typedef {{ id: number, gameweek: number | null, kickoff: Date | null, home: string, away: string,
 *   homeScore: number | null, awayScore: number | null, started: boolean, finished: boolean }} LeagueFixture
 * @typedef {{ fixture: number, result: "W" | "D" | "L", opponent: string, home: boolean, for: number, against: number, kickoff: Date | null }} FormEntry
 * @typedef {{ id: string, name: string, club: string | null, value: number, matches: number | null }} Leader
 * @typedef {{
 *   generatedAt: Date | null, season: string | null, gameweeks: Gameweek[] | null, fixtures: LeagueFixture[] | null,
 *   form: Record<string, FormEntry[]> | null, leaders: { goals: Leader[], assists: Leader[] } | null,
 *   gameweeksAt: Date | null, formAt: Date | null, leadersAt: Date | null, missing: string[], carriedOver: string[]
 * }} League
 */

const isObj = (/** @type {unknown} */ v) => v !== null && typeof v === "object" && !Array.isArray(v);
const int = (/** @type {unknown} */ v) => (Number.isInteger(v) ? /** @type {number} */ (v) : null);
/** @param {unknown} v */
const toDate = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const SLUGS = new Set(CLUBS.map((c) => c.slug));
const RESULTS = new Set(["W", "D", "L"]);

/**
 * @param {unknown} json
 * @returns {League}
 */
export function parseLeague(json) {
  const f = /** @type {any} */ (expectObject(json, "league file"));
  const missing = Array.isArray(f.missing) ? f.missing.filter((/** @type {any} */ m) => typeof m === "string") : [];
  const gameweeks = Array.isArray(f.gameweeks)
    ? f.gameweeks
        .filter((/** @type {any} */ g) => isObj(g) && int(g.id) != null)
        .map((/** @type {any} */ g) => ({
          id: g.id,
          name: typeof g.name === "string" ? g.name : `Gameweek ${g.id}`,
          deadline: toDate(g.deadline),
          finished: g.finished === true,
          current: g.current === true,
          next: g.next === true,
        }))
    : null;
  const fixtures = Array.isArray(f.fixtures)
    ? f.fixtures
        .filter((/** @type {any} */ x) => isObj(x) && int(x.id) != null && SLUGS.has(x.home) && SLUGS.has(x.away))
        .map((/** @type {any} */ x) => ({
          id: x.id,
          gameweek: int(x.gameweek),
          kickoff: toDate(x.kickoff),
          home: x.home,
          away: x.away,
          homeScore: int(x.homeScore),
          awayScore: int(x.awayScore),
          started: x.started === true,
          finished: x.finished === true,
        }))
    : null;
  /** @type {Record<string, FormEntry[]> | null} */
  let form = null;
  if (isObj(f.form)) {
    form = {};
    for (const [slug, list] of Object.entries(f.form)) {
      if (!SLUGS.has(slug) || !Array.isArray(list)) continue;
      form[slug] = list
        .filter((e) => isObj(e) && RESULTS.has(e.result) && SLUGS.has(e.opponent))
        .map((e) => ({ ...e, kickoff: toDate(e.kickoff) }));
    }
  }
  const leaderList = (/** @type {any} */ l) =>
    (Array.isArray(l) ? l : [])
      .filter((x) => isObj(x) && typeof x.id === "string" && typeof x.name === "string" && Number.isFinite(x.value))
      .map((x) => ({
        id: x.id,
        name: x.name,
        club: SLUGS.has(x.club) ? x.club : null,
        value: x.value,
        matches: int(x.matches),
      }));
  const leaders = isObj(f.leaders)
    ? { goals: leaderList(f.leaders.goals), assists: leaderList(f.leaders.assists) }
    : null;
  const asOf = isObj(f.asOf) ? f.asOf : {};
  return {
    generatedAt: toDate(f.generatedAt),
    season: typeof f.season === "string" ? f.season : null,
    gameweeks: missing.includes("gameweeks") ? null : gameweeks,
    fixtures: missing.includes("gameweeks") ? null : fixtures,
    form: missing.includes("form") ? null : form,
    leaders: missing.includes("leaders") ? null : leaders,
    gameweeksAt: toDate(asOf.gameweeks),
    formAt: toDate(asOf.form),
    leadersAt: toDate(asOf.leaders),
    missing,
    carriedOver: Array.isArray(f.carriedOver)
      ? f.carriedOver.filter((/** @type {any} */ m) => typeof m === "string")
      : [],
  };
}

/**
 * The gameweek to open on: the current one until FPL marks it finished, then the next; the last one at the
 * end of a season; null when FPL lists none.
 * @param {Gameweek[] | null} gameweeks
 */
export function defaultGameweek(gameweeks) {
  if (!gameweeks?.length) return null;
  const current = gameweeks.find((g) => g.current);
  if (current && !current.finished) return current.id;
  const next = gameweeks.find((g) => g.next);
  if (next) return next.id;
  return current?.id ?? gameweeks[0].id;
}

/** YYYYMMDD in UTC. @param {Date} d */
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");

/**
 * The days (YYYYMMDD, UTC) ESPN's scoreboard is asked for to cover a gameweek's dated fixtures.
 * @param {LeagueFixture[] | null} fixtures
 * @param {number} gameweek
 */
export function scoreboardDates(fixtures, gameweek) {
  const days = new Set();
  for (const f of fixtures ?? []) if (f.gameweek === gameweek && f.kickoff) days.add(ymd(f.kickoff));
  return [...days].sort();
}

/**
 * A match object shaped like parsers.js `parseEvent` output, from an FPL fixture alone. It has no ESPN event
 * id (`id: null`), so it is never linked to a match centre. `source: "fpl"` marks where its score came from.
 * @param {LeagueFixture} f
 */
export function fixtureAsMatch(f) {
  const side = (/** @type {string} */ slug, /** @type {number | null} */ score) => {
    const c = /** @type {import("../config/clubs.js").Club} */ (clubBySlug(slug));
    return { id: c.espnId, name: c.name, short: c.shortName, abbr: c.abbr, logo: crestUrl(c.espnId), score };
  };
  return {
    id: null,
    fplId: f.id,
    date: f.kickoff,
    competition: "Premier League",
    compShort: "",
    state: f.finished ? "post" : "pre",
    clock: null,
    postponed: false,
    venue: null,
    home: side(f.home, f.started ? f.homeScore : null),
    away: side(f.away, f.started ? f.awayScore : null),
    source: "fpl",
    // FPL has started a match ESPN doesn't list: no live clock to show, so it reads as "awaiting result".
    fplStartedNotFinished: f.started && !f.finished,
  };
}

/**
 * FPL's fixtures for one gameweek, each replaced by ESPN's match for the same home and away clubs when ESPN's
 * scoreboard has it (live score, clock, match-centre link); otherwise shown from FPL. Dated fixtures in
 * kick-off order; undated ones (rescheduling pending) are returned separately.
 * @param {LeagueFixture[] | null} fixtures
 * @param {number} gameweek
 * @param {any[]} espnMatches parsed scoreboard matches (any days)
 */
export function gameweekMatches(fixtures, gameweek, espnMatches = []) {
  const byPair = new Map();
  for (const m of espnMatches) if (m?.home?.id && m?.away?.id) byPair.set(`${m.home.id}-${m.away.id}`, m);
  const dated = [];
  const undated = [];
  for (const f of fixtures ?? []) {
    if (f.gameweek !== gameweek) continue;
    const home = clubBySlug(f.home);
    const away = clubBySlug(f.away);
    if (!home || !away) continue;
    const espn = byPair.get(`${home.espnId}-${away.espnId}`);
    const m = espn ? { ...espn, fplId: f.id, source: "espn" } : fixtureAsMatch(f);
    (m.date ? dated : undated).push(m);
  }
  dated.sort((a, b) => a.date - b.date);
  return { dated, undated };
}

/** @typedef {"all" | "live" | "upcoming" | "completed"} MatchFilter */

/**
 * Which filter a match falls under. A match whose kick-off has passed without a result counts as live only
 * when the provider says so; otherwise it is "upcoming" until a result arrives (never guessed as finished).
 * @param {any} m
 * @param {number} now
 * @returns {Exclude<MatchFilter, "all"> | null}
 */
export function filterKind(m, now) {
  const phase = matchPhase(m, now);
  if (phase === "live") return "live";
  if (phase === "completed") return "completed";
  if (phase === "postponed") return null;
  return "upcoming";
}

/**
 * @param {any[]} matches
 * @param {MatchFilter} filter
 */
export function filterMatches(matches, filter, now = Date.now()) {
  return filter === "all" ? matches : matches.filter((m) => filterKind(m, now) === filter);
}

/** Count per filter, for the filter buttons. @param {any[]} matches */
export function filterCounts(matches, now = Date.now()) {
  const counts = { all: matches.length, live: 0, upcoming: 0, completed: 0 };
  for (const m of matches) {
    const k = filterKind(m, now);
    if (k) counts[k]++;
  }
  return counts;
}

/**
 * Upcoming league fixtures within `days` that the current table makes stand out, each with its reason:
 * both clubs in the top six, or both in the bottom four. A rule anyone can check against the table, not an
 * opinion. Needs the full 20-club table.
 * @param {LeagueFixture[] | null} fixtures
 * @param {{ id: string, rank: number | null }[]} rows ESPN standings rows
 */
export function keyFixtures(fixtures, rows, now = Date.now(), days = 14) {
  const ranked = (rows ?? []).filter((r) => Number.isInteger(r?.rank));
  if (ranked.length < 20) return [];
  const rankOf = new Map(ranked.map((r) => [r.id, /** @type {number} */ (r.rank)]));
  const until = now + days * 86400e3;
  const out = [];
  for (const f of fixtures ?? []) {
    const t = f.kickoff?.getTime();
    if (t == null || t <= now || t > until || f.started) continue;
    const h = rankOf.get(clubBySlug(f.home)?.espnId ?? "");
    const a = rankOf.get(clubBySlug(f.away)?.espnId ?? "");
    if (h == null || a == null) continue;
    const reason =
      h <= 6 && a <= 6
        ? `Top-six meeting: ${ordinal(h)} v ${ordinal(a)}`
        : h >= 17 && a >= 17
          ? `Bottom-four meeting: ${ordinal(h)} v ${ordinal(a)}`
          : null;
    if (reason) out.push({ fixture: f, reason, homeRank: h, awayRank: a });
  }
  return out.sort(
    (x, y) =>
      /** @type {number} */ (x.fixture.kickoff?.getTime()) - /** @type {number} */ (y.fixture.kickoff?.getTime()),
  );
}
