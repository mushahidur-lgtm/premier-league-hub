// @ts-check
/**
 * fpl.json: Fantasy Premier League player prices, ownership, points, form and playing time, each club's next
 * fixtures with FPL's difficulty ratings, and the game's squad rules. Pure; fetch-data.mjs does the IO, reusing
 * the bootstrap-static and fixtures responses it already fetched for league.json (no extra requests).
 *
 * Kept apart from the ESPN files: every number here is FPL's, and the page that reads it says so.
 * Rules: a player FPL won't let anyone pick (`can_select: false`, or removed) is left out; a missing number is
 * null, never 0; `chance` null means FPL has no flag on the player; a fixture with no gameweek keeps
 * `gw: null` (no number is inferred).
 */
import { mapTeams } from "./league.mjs";

const isObj = (/** @type {unknown} */ v) => v !== null && typeof v === "object" && !Array.isArray(v);
const int = (/** @type {unknown} */ v) => (Number.isInteger(v) ? /** @type {number} */ (v) : null);
const iso = (/** @type {unknown} */ v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
/** FPL sends many numbers as strings ("47.6"). @param {unknown} v */
const num = (v) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** How many gameweeks of fixtures to keep after the current one. */
export const FIXTURE_WINDOW = 6;
export const POSITIONS = /** @type {const} */ (["GKP", "DEF", "MID", "FWD"]);
export const STATUSES = /** @type {const} */ (["a", "d", "i", "s", "u", "n"]);

/**
 * @typedef {{
 *   id: number, name: string, fullName: string, club: string, pos: string, price: number, owned: number | null,
 *   points: number | null, ppg: number | null, form: number | null, minutes: number | null, starts: number | null,
 *   status: string, chance: number | null, news: string, xg: number | null, xa: number | null,
 *   ep: number | null, espn: string | null, espnName: string | null, espnLast: string | null
 * }} FplPlayer
 * @typedef {{ gw: number | null, kickoff: string | null, opp: string, home: boolean, fdr: number | null }} FplFixture
 */

/**
 * The game's squad rules from bootstrap-static (not hard-coded: FPL could change them).
 * @param {any} bootstrap
 */
export function readRules(bootstrap) {
  const g = isObj(bootstrap?.game_settings) ? bootstrap.game_settings : {};
  /** @type {Record<string, number>} */
  const perPosition = {};
  for (const t of Array.isArray(bootstrap?.element_types) ? bootstrap.element_types : []) {
    const short = t?.singular_name_short;
    if (POSITIONS.includes(short) && int(t.squad_select) != null) perPosition[short] = t.squad_select;
  }
  return {
    squadSize: int(g.squad_squadsize),
    perClub: int(g.squad_team_limit),
    budget: int(g.squad_total_spend), // tenths of £1m: 1000 = £100.0m
    sellOnFee: num(g.transfers_sell_on_fee),
    perPosition,
  };
}

/** @param {any} bootstrap */
function readGameweek(bootstrap, /** @type {"is_current" | "is_next"} */ flag) {
  const e = (Array.isArray(bootstrap?.events) ? bootstrap.events : []).find((/** @type {any} */ x) => x?.[flag]);
  return e && int(e.id) != null ? { id: e.id, deadline: iso(e.deadline_time), finished: e.finished === true } : null;
}

/**
 * Players anyone can pick, trimmed to what the FPL page shows.
 * @param {any} bootstrap
 * @param {Map<number, string>} teams FPL team id → club slug
 * @param {Record<string, { fpl: number }> | null} espnMatches league.json's `minutes` (ESPN id → FPL id)
 * @param {{ id: string, name: string, lastName: string | null }[]} [squads] ESPN squad players: the matched
 *   player's ESPN name, so the page can match injury headlines (rule 3) the way club pages do
 * @returns {FplPlayer[]}
 */
export function readPlayers(bootstrap, teams, espnMatches, squads = []) {
  const espnPeople = new Map(squads.map((s) => [s.id, s]));
  /** @type {Map<number, string>} */
  const pos = new Map();
  for (const t of Array.isArray(bootstrap?.element_types) ? bootstrap.element_types : [])
    if (int(t?.id) != null && POSITIONS.includes(t.singular_name_short)) pos.set(t.id, t.singular_name_short);
  /** @type {Map<number, string>} */
  const espnByFpl = new Map();
  for (const [espn, m] of Object.entries(espnMatches ?? {})) if (int(m?.fpl) != null) espnByFpl.set(m.fpl, espn);

  /** @type {FplPlayer[]} */
  const out = [];
  for (const e of Array.isArray(bootstrap?.elements) ? bootstrap.elements : []) {
    if (!isObj(e) || e.removed === true || e.can_select === false) continue;
    const club = teams.get(e.team);
    const p = pos.get(e.element_type);
    const price = int(e.now_cost);
    if (int(e.id) == null || !club || !p || price == null || typeof e.web_name !== "string") continue;
    const full = [e.first_name, e.second_name].filter((s) => typeof s === "string" && s).join(" ");
    out.push({
      id: e.id,
      name: e.web_name,
      fullName: full || e.web_name,
      club,
      pos: p,
      price,
      owned: num(e.selected_by_percent),
      points: int(e.total_points),
      ppg: num(e.points_per_game),
      form: num(e.form),
      minutes: int(e.minutes),
      starts: int(e.starts),
      status: STATUSES.includes(e.status) ? e.status : "a",
      chance: int(e.chance_of_playing_next_round),
      news: typeof e.news === "string" ? e.news.slice(0, 200) : "",
      xg: num(e.expected_goals),
      xa: num(e.expected_assists),
      ep: num(e.ep_next),
      espn: espnByFpl.get(e.id) ?? null,
      espnName: espnPeople.get(espnByFpl.get(e.id) ?? "")?.name ?? null,
      espnLast: espnPeople.get(espnByFpl.get(e.id) ?? "")?.lastName ?? null,
    });
  }
  return out;
}

/**
 * Each club's league matches played (FPL's finished fixtures) and next fixtures: those in the next
 * `window` gameweeks after `fromGw`, plus any with no gameweek yet (postponed, not rescheduled).
 * A club can have none (blank) or two (double) in one gameweek; that's kept as FPL has it.
 * @param {any} fixtures FPL fixtures/
 * @param {Map<number, string>} teams
 * @param {number} fromGw the current gameweek (0 before the season)
 * @param {number} [window]
 * @returns {Record<string, { played: number, fixtures: FplFixture[] }>}
 */
export function readClubFixtures(fixtures, teams, fromGw, window = FIXTURE_WINDOW) {
  /** @type {Record<string, { played: number, fixtures: FplFixture[] }>} */
  const out = {};
  for (const slug of teams.values()) out[slug] = { played: 0, fixtures: [] };
  for (const f of Array.isArray(fixtures) ? fixtures : []) {
    const home = teams.get(f?.team_h);
    const away = teams.get(f?.team_a);
    if (!isObj(f) || !home || !away) continue;
    if (f.finished === true || f.finished_provisional === true) {
      out[home].played++;
      out[away].played++;
      continue;
    }
    const gw = int(f.event);
    if (gw != null && (gw <= fromGw || gw > fromGw + window)) continue;
    const kickoff = iso(f.kickoff_time);
    out[home].fixtures.push({ gw, kickoff, opp: away, home: true, fdr: int(f.team_h_difficulty) });
    out[away].fixtures.push({ gw, kickoff, opp: home, home: false, fdr: int(f.team_a_difficulty) });
  }
  // By gameweek (unscheduled last), then kickoff.
  const order = (/** @type {FplFixture} */ x) => x.gw ?? Infinity;
  for (const c of Object.values(out))
    c.fixtures.sort((a, b) => order(a) - order(b) || String(a.kickoff).localeCompare(String(b.kickoff)));
  return out;
}

/**
 * The whole fpl.json, or null with the reason when FPL's data can't be used (then the pipeline carries over
 * the live file).
 * @param {{ bootstrap: any, fixtures: any, clubs: { slug: string, abbr: string, espnId: string }[], now: Date,
 *   espnMatches?: Record<string, { fpl: number }> | null,
 *   squads?: { id: string, name: string, lastName: string | null }[] }} input
 * @returns {{ fpl: any, problems: string[] }}
 */
export function buildFpl({ bootstrap, fixtures, clubs, now, espnMatches = null, squads = [] }) {
  if (!bootstrap || !Array.isArray(fixtures)) return { fpl: null, problems: ["FPL data unavailable"] };
  const { map, unmatched } = mapTeams(bootstrap, clubs);
  if (unmatched.length || map.size !== clubs.length)
    return { fpl: null, problems: [`FPL teams not matched to clubs: ${unmatched.join(", ") || "none listed"}`] };
  const players = readPlayers(bootstrap, map, espnMatches, squads);
  if (players.length < 100) return { fpl: null, problems: [`only ${players.length} FPL players`] };
  const current = readGameweek(bootstrap, "is_current");
  const next = readGameweek(bootstrap, "is_next");
  const generatedAt = now.toISOString();
  return {
    fpl: {
      generatedAt,
      asOf: generatedAt,
      carriedOver: false,
      rules: readRules(bootstrap),
      gameweeks: { current, next },
      players,
      clubs: readClubFixtures(fixtures, map, current?.id ?? 0),
    },
    problems: [],
  };
}
