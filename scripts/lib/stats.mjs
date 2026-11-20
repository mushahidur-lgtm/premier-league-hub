// @ts-check
/**
 * stats.json: season team statistics (ESPN core API, current and previous season) and this season's player
 * figures (ESPN squad statistics, with FPL minutes, expected goals and expected assists). Pure; fetch-data.mjs
 * does the IO. Loaded only by the Statistics page.
 *
 * Rules: a club absent from the league that season is "absent", never zeros; a value ESPN leaves out, or
 * reports as 0 where 0 is impossible over a season (possession, passes, shots…), is null ("not recorded").
 */

const isObj = (/** @type {unknown} */ v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** @param {unknown} v */
const num = (v) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * Team fields kept, from ESPN's stat names. `zero: false` = a season value of 0 can't be real (with matches
 * played), so it is stored as null. `scale` turns ESPN's 0–1 ratios into percentages.
 * @type {{ key: string, espn: string, zero?: boolean, scale?: number, round?: number }[]}
 */
export const TEAM_FIELDS = [
  { key: "played", espn: "appearances" },
  { key: "wins", espn: "wins" },
  { key: "draws", espn: "draws" },
  { key: "losses", espn: "losses" },
  { key: "goalsFor", espn: "totalGoals" },
  { key: "goalsAgainst", espn: "goalsConceded" },
  { key: "cleanSheets", espn: "cleanSheet" },
  { key: "possession", espn: "possessionPct", zero: false, round: 1 },
  { key: "shots", espn: "totalShots", zero: false },
  { key: "shotsOnTarget", espn: "shotsOnTarget", zero: false },
  { key: "passes", espn: "totalPasses", zero: false },
  { key: "passAccuracy", espn: "passPct", zero: false, scale: 100, round: 1 },
  { key: "corners", espn: "wonCorners", zero: false },
  { key: "fouls", espn: "foulsCommitted", zero: false },
  { key: "yellowCards", espn: "yellowCards" },
  { key: "redCards", espn: "redCards" },
  { key: "offsides", espn: "offsides", zero: false },
  { key: "saves", espn: "saves", zero: false },
  { key: "tackles", espn: "totalTackles", zero: false },
  { key: "interceptions", espn: "interceptions", zero: false },
  // ESPN's own expected-goals averages per match (not totals).
  { key: "xgPerMatch", espn: "avgExpectedGoals", zero: false, round: 2 },
  { key: "xgaPerMatch", espn: "avgExpectedGoalsConceded", zero: false, round: 2 },
];

/**
 * One club's season statistics from ESPN's core API (…/seasons/<year>/types/1/teams/<id>/statistics).
 * @param {any} json
 * @returns {Record<string, number | null> | null} null when the response has no statistics at all
 */
export function readTeamStats(json) {
  const cats = Array.isArray(json?.splits?.categories) ? json.splits.categories : null;
  if (!cats) return null;
  /** @type {Record<string, number | null>} */
  const raw = {};
  for (const c of cats) for (const s of Array.isArray(c?.stats) ? c.stats : []) if (s?.name) raw[s.name] = num(s.value);
  const played = raw.appearances ?? null;
  /** @type {Record<string, number | null>} */
  const out = {};
  for (const f of TEAM_FIELDS) {
    let v = raw[f.espn] ?? null;
    if (v != null && f.zero === false && v === 0 && (played ?? 0) > 0) v = null;
    if (v != null && f.scale) v *= f.scale;
    if (v != null && f.round != null) v = Math.round(v * 10 ** f.round) / 10 ** f.round;
    out[f.key] = v;
  }
  return out;
}

/**
 * This season's figures for a squad, from ESPN's roster (the same source as the player profiles).
 * @param {any} json
 * @param {string} club
 */
export function rosterStats(json, club) {
  const athletes = Array.isArray(json?.athletes) ? json.athletes : [];
  return athletes
    .filter((a) => a && a.id != null && typeof a.displayName === "string")
    .map((a) => {
      /** @type {Record<string, number | null>} */
      const s = {};
      for (const c of Array.isArray(a.statistics?.splits?.categories) ? a.statistics.splits.categories : [])
        for (const x of Array.isArray(c?.stats) ? c.stats : []) if (x?.name) s[x.name] = num(x.value);
      return {
        id: String(a.id),
        name: a.displayName,
        club,
        position: typeof a.position?.displayName === "string" ? a.position.displayName : null,
        goalkeeper: /goal ?keeper/i.test(String(a.position?.displayName ?? a.position?.name ?? "")),
        apps: s.appearances ?? null,
        subIns: s.subIns ?? null,
        goals: s.totalGoals ?? null,
        assists: s.goalAssists ?? null,
        shots: s.totalShots ?? null,
        shotsOnTarget: s.shotsOnTarget ?? null,
        yellowCards: s.yellowCards ?? null,
        redCards: s.redCards ?? null,
        saves: s.saves ?? null,
      };
    });
}

/**
 * Adds FPL minutes, expected goals and expected assists to each player FPL was matched with (league.json's
 * `minutes` map: ESPN id → FPL id). Unmatched players keep null.
 * @param {ReturnType<typeof rosterStats>} players
 * @param {Record<string, { fpl: number, minutes: number }> | null} minutes
 * @param {any} bootstrap FPL bootstrap-static, or null
 */
export function withFpl(players, minutes, bootstrap) {
  const byFpl = new Map(
    (Array.isArray(bootstrap?.elements) ? bootstrap.elements : []).map((/** @type {any} */ e) => [e.id, e]),
  );
  return players.map((p) => {
    const m = minutes?.[p.id];
    const e = m ? byFpl.get(m.fpl) : undefined;
    return {
      ...p,
      minutes: m ? m.minutes : null,
      xg: e ? num(e.expected_goals) : null,
      xa: e ? num(e.expected_assists) : null,
    };
  });
}

/** "2026" → "2026-27". @param {number} year */
export const seasonLabel = (year) => `${year}-${String((year + 1) % 100).padStart(2, "0")}`;

/**
 * @typedef {{ status: "ok", stats: Record<string, number | null> } | { status: "absent" } | { status: "unavailable" }} TeamEntry
 */

/**
 * The whole stats.json. `teams[year][slug]` is the fetch result for that club and season: the parsed JSON,
 * `"absent"` (HTTP 404: not in the league that season) or `"error"`. A season where every club errored is
 * listed in `missing` (and can be carried over); a players part with no squads likewise.
 * @param {{ now: Date, years: number[], teams: Record<number, Record<string, any>>, players: any[] | null }} input
 */
export function buildStats({ now, years, teams, players }) {
  const problems = [];
  const missing = [];
  const seasons = years.map((year, i) => {
    /** @type {Record<string, TeamEntry>} */
    const entries = {};
    let errors = 0;
    for (const [slug, res] of Object.entries(teams[year] ?? {})) {
      if (res === "absent") entries[slug] = { status: "absent" };
      else {
        const stats = res === "error" ? null : readTeamStats(res);
        if (stats) entries[slug] = { status: "ok", stats };
        else {
          entries[slug] = { status: "unavailable" };
          errors++;
        }
      }
    }
    const part = i === 0 ? "current" : "previous";
    const total = Object.keys(entries).length;
    if (!total || errors === total) missing.push(part);
    else if (errors) problems.push(`${seasonLabel(year)}: ${errors} of ${total} clubs' statistics unavailable`);
    return { part, year, label: seasonLabel(year), teams: entries };
  });
  if (!players?.length) missing.push("players");
  const generatedAt = now.toISOString();
  const asOf = Object.fromEntries(
    ["current", "previous", "players"].map((p) => [p, missing.includes(p) ? null : generatedAt]),
  );
  return {
    stats: {
      generatedAt,
      competition: "Premier League",
      seasons,
      players: players?.length ? players : null,
      asOf,
      missing,
      carriedOver: [],
    },
    problems,
  };
}

/**
 * Fills parts this run couldn't fetch from the live stats.json, keeping that copy's date.
 * @param {any} stats
 * @param {any} previous
 */
export function carryOverStats(stats, previous) {
  if (!isObj(previous)) return stats;
  const next = { ...stats, seasons: [...stats.seasons], asOf: { ...stats.asOf }, missing: [], carriedOver: [] };
  for (const part of stats.missing) {
    const when = typeof previous.asOf?.[part] === "string" ? previous.asOf[part] : null;
    const usable = when && !(previous.missing ?? []).includes(part);
    if (usable && part === "players" && Array.isArray(previous.players)) {
      next.players = previous.players;
    } else if (usable && part !== "players") {
      const i = next.seasons.findIndex((s) => s.part === part);
      const old = (previous.seasons ?? []).find((/** @type {any} */ s) => s.part === part);
      if (i < 0 || !old || old.year !== next.seasons[i].year) {
        next.missing.push(part);
        continue;
      }
      next.seasons[i] = old;
    } else {
      next.missing.push(part);
      continue;
    }
    next.asOf[part] = when;
    next.carriedOver.push(part);
  }
  return next;
}
