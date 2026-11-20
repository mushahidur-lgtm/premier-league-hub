// @ts-check
/**
 * Statistics page logic over data/stats.json (ESPN season team statistics, this season's player figures with
 * FPL minutes/xG/xA) and league.json's FPL fixtures (home/away records and progression). Pure functions.
 *
 * Nothing is estimated: a figure the source doesn't give is null ("–"), a club absent from the league that
 * season is listed as such, and tied clubs share a position rather than being split by an invented rule.
 */
import { CLUBS } from "../config/clubs.js";
import { expectObject } from "./validate.js";

const isObj = (/** @type {unknown} */ v) => v !== null && typeof v === "object" && !Array.isArray(v);
const SLUGS = new Set(CLUBS.map((c) => c.slug));
/** @param {unknown} v */
const toDate = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const numOrNull = (/** @type {unknown} */ v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * @typedef {{ status: "ok", stats: Record<string, number | null> } | { status: "absent" } | { status: "unavailable" }} TeamEntry
 * @typedef {{ part: "current" | "previous", year: number, label: string, teams: Record<string, TeamEntry>, asOf: Date | null }} Season
 * @typedef {{ id: string, name: string, club: string, position: string | null, goalkeeper: boolean,
 *   [k: string]: any }} PlayerRow
 * @typedef {{ generatedAt: Date | null, competition: string, seasons: Season[], players: PlayerRow[] | null,
 *   playersAt: Date | null, missing: string[], carriedOver: string[] }} Stats
 */

/** @param {unknown} json @returns {Stats} */
export function parseStats(json) {
  const f = /** @type {any} */ (expectObject(json, "statistics file"));
  const missing = Array.isArray(f.missing) ? f.missing.filter((/** @type {any} */ m) => typeof m === "string") : [];
  const asOf = isObj(f.asOf) ? f.asOf : {};
  const seasons = (Array.isArray(f.seasons) ? f.seasons : [])
    .filter((/** @type {any} */ s) => isObj(s) && Number.isInteger(s.year) && !missing.includes(s.part))
    .map((/** @type {any} */ s) => {
      /** @type {Record<string, TeamEntry>} */
      const teams = {};
      for (const [slug, t] of Object.entries(isObj(s.teams) ? s.teams : {})) {
        if (!SLUGS.has(slug) || !isObj(t)) continue;
        if (t.status === "ok" && isObj(t.stats)) {
          teams[slug] = {
            status: "ok",
            stats: Object.fromEntries(Object.entries(t.stats).map(([k, v]) => [k, numOrNull(v)])),
          };
        } else if (t.status === "absent" || t.status === "unavailable") teams[slug] = { status: t.status };
      }
      return { part: s.part, year: s.year, label: String(s.label ?? s.year), teams, asOf: toDate(asOf[s.part]) };
    });
  const players =
    !missing.includes("players") && Array.isArray(f.players)
      ? f.players
          .filter(
            (/** @type {any} */ p) =>
              isObj(p) && typeof p.id === "string" && typeof p.name === "string" && SLUGS.has(p.club),
          )
          .map((/** @type {any} */ p) => ({ ...p, goalkeeper: p.goalkeeper === true }))
      : null;
  return {
    generatedAt: toDate(f.generatedAt),
    competition: typeof f.competition === "string" ? f.competition : "Premier League",
    seasons,
    players,
    playersAt: toDate(asOf.players),
    missing,
    carriedOver: Array.isArray(f.carriedOver) ? f.carriedOver : [],
  };
}

/**
 * @typedef {{ key: string, label: string, short: string, source: "ESPN" | "FPL" | "derived", unit?: "%",
 *   kind: "count" | "rate", lowerIsBetter?: boolean, decimals?: number }} Metric
 * "count" can be shown per match; "rate" (a percentage or an average ESPN already gives per match) can't.
 */

/** @type {Metric[]} */
export const TEAM_METRICS = [
  { key: "goalsFor", label: "Goals scored", short: "GF", source: "ESPN", kind: "count" },
  { key: "goalsAgainst", label: "Goals conceded", short: "GA", source: "ESPN", kind: "count", lowerIsBetter: true },
  { key: "cleanSheets", label: "Clean sheets", short: "CS", source: "ESPN", kind: "count" },
  { key: "possession", label: "Possession", short: "Poss", source: "ESPN", kind: "rate", unit: "%", decimals: 1 },
  { key: "shots", label: "Shots", short: "Sh", source: "ESPN", kind: "count" },
  { key: "shotsOnTarget", label: "Shots on target", short: "SoT", source: "ESPN", kind: "count" },
  { key: "xgPerMatch", label: "Expected goals per match", short: "xG", source: "ESPN", kind: "rate", decimals: 2 },
  {
    key: "xgaPerMatch",
    label: "Expected goals against per match",
    short: "xGA",
    source: "ESPN",
    kind: "rate",
    decimals: 2,
    lowerIsBetter: true,
  },
  { key: "passAccuracy", label: "Pass accuracy", short: "Pass%", source: "ESPN", kind: "rate", unit: "%", decimals: 1 },
  { key: "passes", label: "Passes", short: "Pass", source: "ESPN", kind: "count" },
  { key: "corners", label: "Corners won", short: "Cor", source: "ESPN", kind: "count" },
  { key: "tackles", label: "Tackles", short: "Tkl", source: "ESPN", kind: "count" },
  { key: "interceptions", label: "Interceptions", short: "Int", source: "ESPN", kind: "count" },
  { key: "saves", label: "Saves", short: "Sv", source: "ESPN", kind: "count" },
  { key: "fouls", label: "Fouls committed", short: "Fls", source: "ESPN", kind: "count", lowerIsBetter: true },
  { key: "yellowCards", label: "Yellow cards", short: "YC", source: "ESPN", kind: "count", lowerIsBetter: true },
  { key: "redCards", label: "Red cards", short: "RC", source: "ESPN", kind: "count", lowerIsBetter: true },
];

/** @type {Metric[]} */
export const PLAYER_METRICS = [
  { key: "goals", label: "Goals", short: "G", source: "ESPN", kind: "count" },
  { key: "assists", label: "Assists", short: "A", source: "ESPN", kind: "count" },
  { key: "xg", label: "Expected goals (FPL)", short: "xG", source: "FPL", kind: "count", decimals: 2 },
  { key: "xa", label: "Expected assists (FPL)", short: "xA", source: "FPL", kind: "count", decimals: 2 },
  { key: "shots", label: "Shots", short: "Sh", source: "ESPN", kind: "count" },
  { key: "shotsOnTarget", label: "Shots on target", short: "SoT", source: "ESPN", kind: "count" },
  { key: "minutes", label: "Minutes played (FPL)", short: "Min", source: "FPL", kind: "rate" },
  { key: "saves", label: "Saves", short: "Sv", source: "ESPN", kind: "count" },
  { key: "yellowCards", label: "Yellow cards", short: "YC", source: "ESPN", kind: "count", lowerIsBetter: true },
];

export const metricBy = (/** @type {Metric[]} */ list, /** @type {string | null | undefined} */ key) =>
  list.find((m) => m.key === key) ?? list[0];

/**
 * A team's value for a metric: the season figure, or per match (counts only; ESPN's rates are already
 * averages). null when ESPN doesn't give it or the club played no matches.
 * @param {TeamEntry | undefined} entry
 * @param {Metric} metric
 * @param {boolean} perMatch
 */
export function teamValue(entry, metric, perMatch) {
  if (entry?.status !== "ok") return null;
  const v = entry.stats[metric.key] ?? null;
  if (v == null || !perMatch || metric.kind !== "count") return v;
  const played = entry.stats.played;
  return played ? Math.round((v / played) * 100) / 100 : null;
}

/**
 * A player's value: the season figure, or per 90 minutes (counts only, from 90 FPL minutes).
 * @param {PlayerRow} p
 * @param {Metric} metric
 * @param {boolean} per90
 */
export function playerValue(p, metric, per90) {
  const v = numOrNull(p[metric.key]);
  if (v == null || !per90 || metric.kind !== "count") return v;
  const m = numOrNull(p.minutes);
  return m != null && m >= 90 ? Math.round((v / m) * 90 * 100) / 100 : null;
}

/**
 * Ranked rows for a metric: best first (highest, or lowest when lower is better), unknown values last.
 * Equal values share a rank.
 * @template T
 * @param {T[]} items
 * @param {(t: T) => number | null} value
 * @param {boolean} [lowerIsBetter]
 * @returns {{ item: T, value: number | null, rank: number | null }[]}
 */
export function rankBy(items, value, lowerIsBetter = false) {
  const rows = items.map((item) => ({ item, value: value(item) }));
  const known = /** @type {{ item: T, value: number }[]} */ (rows.filter((r) => r.value != null));
  const sign = lowerIsBetter ? 1 : -1;
  known.sort((a, b) => sign * (a.value - b.value));
  return [
    ...known.map((r) => ({ ...r, rank: 1 + known.filter((o) => sign * (o.value - r.value) < 0).length })),
    ...rows.filter((r) => r.value == null).map((r) => ({ ...r, rank: null })),
  ];
}

/**
 * @typedef {{ played: number, won: number, drawn: number, lost: number, goalsFor: number, goalsAgainst: number,
 *   points: number, cleanSheets: number }} Record3
 */
const blank = () => ({ played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, cleanSheets: 0 });

/**
 * Home and away records for a club from FPL's finished fixtures (this season only).
 * @param {{ home: string, away: string, homeScore: number | null, awayScore: number | null, finished: boolean }[] | null} fixtures
 * @param {string} slug
 * @returns {{ home: Record3, away: Record3 } | null}
 */
export function homeAway(fixtures, slug) {
  if (!fixtures) return null;
  const out = { home: blank(), away: blank() };
  for (const f of fixtures) {
    if (!f.finished || f.homeScore == null || f.awayScore == null) continue;
    const side = f.home === slug ? "home" : f.away === slug ? "away" : null;
    if (!side) continue;
    const gf = side === "home" ? f.homeScore : f.awayScore;
    const ga = side === "home" ? f.awayScore : f.homeScore;
    const r = out[side];
    r.played++;
    r.goalsFor += gf;
    r.goalsAgainst += ga;
    if (ga === 0) r.cleanSheets++;
    if (gf > ga) {
      r.won++;
      r.points += 3;
    } else if (gf === ga) {
      r.drawn++;
      r.points += 1;
    } else r.lost++;
  }
  return out;
}

/**
 * Points and position after each gameweek, from FPL's finished fixtures, for every club. A gameweek is
 * "complete" when all its fixtures are finished; the latest gameweek with some but not all finished is
 * included and marked in progress. Order: points, goal difference, goals scored; clubs level on all three
 * share a position (no further tie-break is guessed).
 * @param {{ gameweek: number | null, home: string, away: string, homeScore: number | null, awayScore: number | null, finished: boolean }[] | null} fixtures
 * @param {string[]} [slugs]
 * @returns {{ rounds: { gameweek: number, complete: boolean, table: Record<string, { points: number, gd: number, gf: number, played: number, position: number, tied: boolean }> }[] } | null}
 */
export function progression(fixtures, slugs = CLUBS.map((c) => c.slug)) {
  if (!fixtures) return null;
  const byGw = new Map();
  for (const f of fixtures) {
    if (f.gameweek == null) continue;
    if (!byGw.has(f.gameweek)) byGw.set(f.gameweek, []);
    byGw.get(f.gameweek).push(f);
  }
  const gws = [...byGw.keys()].sort((a, b) => a - b);
  const totals = Object.fromEntries(slugs.map((s) => [s, { points: 0, gd: 0, gf: 0, played: 0 }]));
  const rounds = [];
  for (const gw of gws) {
    const list = byGw.get(gw);
    const done = list.filter((/** @type {any} */ f) => f.finished && f.homeScore != null && f.awayScore != null);
    if (!done.length) break;
    for (const f of done) {
      for (const [club, gf, ga] of [
        [f.home, f.homeScore, f.awayScore],
        [f.away, f.awayScore, f.homeScore],
      ]) {
        const t = totals[club];
        if (!t) continue;
        t.played++;
        t.gf += gf;
        t.gd += gf - ga;
        t.points += gf > ga ? 3 : gf === ga ? 1 : 0;
      }
    }
    const order = [...slugs].sort(
      (a, b) => totals[b].points - totals[a].points || totals[b].gd - totals[a].gd || totals[b].gf - totals[a].gf,
    );
    const same = (/** @type {string} */ a, /** @type {string} */ b) =>
      totals[a].points === totals[b].points && totals[a].gd === totals[b].gd && totals[a].gf === totals[b].gf;
    /** @type {Record<string, any>} */
    const table = {};
    order.forEach((slug, i) => {
      const first = order.findIndex((o) => same(o, slug));
      table[slug] = {
        ...totals[slug],
        position: first + 1,
        tied: order.some((o, j) => j !== i && same(o, slug)),
      };
    });
    rounds.push({ gameweek: gw, complete: done.length === list.length, table });
    if (done.length < list.length) break;
  }
  return { rounds };
}

/**
 * One player's season from ESPN's core API (…/seasons/<year>/types/1/athletes/<id>/statistics), for seasons
 * the pipeline doesn't cover. Includes ESPN's minutes. A missing figure is null.
 * @param {unknown} json
 * @returns {Record<string, number | null> | null} null when ESPN has no statistics for that season
 */
export function parseAthleteSeason(json) {
  const cats = /** @type {any} */ (json)?.splits?.categories;
  if (!Array.isArray(cats)) return null;
  /** @type {Record<string, number | null>} */
  const raw = {};
  for (const c of cats)
    for (const s of Array.isArray(c?.stats) ? c.stats : []) if (s?.name) raw[s.name] = numOrNull(s.value);
  return {
    apps: raw.appearances ?? null,
    minutes: raw.minutes ?? null,
    goals: raw.totalGoals ?? null,
    assists: raw.goalAssists ?? null,
    shots: raw.totalShots ?? null,
    shotsOnTarget: raw.shotsOnTarget ?? null,
    saves: raw.saves ?? null,
    yellowCards: raw.yellowCards ?? null,
    redCards: raw.redCards ?? null,
  };
}
