// @ts-check
/**
 * Player profiles and comparison, over ESPN's athlete bio, ESPN's game log, the club's ESPN roster (season
 * totals) and FPL minutes from league.json. Pure functions.
 *
 * A statistic the source doesn't give is `null`, shown as "–" and never as 0. Nothing is estimated.
 */
import { clubByEspnId } from "../config/clubs.js";
import { expectObject } from "./validate.js";

const isObj = (/** @type {unknown} */ v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (/** @type {unknown} */ v) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** @param {unknown} v */
const num = (v) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
/** @param {unknown} v */
const webUrl = (v) => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};
/** @param {unknown} v */
const toDate = (v) => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * @typedef {{
 *   id: string, name: string, firstName: string | null, lastName: string | null, age: number | null,
 *   dob: string | null, nationality: string | null, flag: string | null, position: string | null,
 *   jersey: string | null, teamId: string | null, teamName: string | null, height: string | null,
 *   weight: string | null, photo: string | null, status: string | null
 * }} Athlete
 */

/**
 * ESPN's athlete bio (site.web.api …/common/v3/sports/soccer/eng.1/athletes/<id>).
 * @param {unknown} json
 * @returns {Athlete}
 */
export function parseAthlete(json) {
  const root = /** @type {any} */ (expectObject(json, "player"));
  const a = /** @type {any} */ (expectObject(root.athlete, "player"));
  const id = str(a.id) ?? (Number.isInteger(a.id) ? String(a.id) : null);
  const name = str(a.displayName) ?? str(a.fullName);
  if (!id || !name) expectObject(null, "player");
  return {
    id: /** @type {string} */ (id),
    name: /** @type {string} */ (name),
    firstName: str(a.firstName),
    lastName: str(a.lastName),
    age: num(a.age),
    dob: str(a.displayDOB),
    nationality: str(a.citizenship),
    flag: webUrl(a.flag?.href),
    position: str(a.position?.displayName) ?? str(a.position?.name),
    jersey: str(a.jersey) ?? str(a.displayJersey)?.replace(/^#/, "") ?? null,
    teamId: str(a.team?.id),
    teamName: str(a.team?.displayName) ?? str(a.team?.name),
    height: str(a.displayHeight),
    weight: str(a.displayWeight),
    // ESPN has a headshot for few players; a guessed URL would 404, so none is invented.
    photo: webUrl(a.headshot?.href),
    status: str(a.status?.name),
  };
}

/**
 * @typedef {{
 *   eventId: string, date: Date | null, opponentId: string | null, opponent: string | null, home: boolean | null,
 *   teamScore: number | null, oppScore: number | null, result: "W" | "D" | "L" | null, league: string | null,
 *   stats: Record<string, number | null>
 * }} GameLogEntry
 */

/**
 * ESPN's game log for the current season: the league matches the player appeared in, newest first.
 * @param {unknown} json
 * @returns {{ season: string | null, games: GameLogEntry[] }}
 */
export function parseGamelog(json) {
  const g = /** @type {any} */ (expectObject(json, "game log"));
  const names = Array.isArray(g.names) ? g.names.map((n) => (typeof n === "string" ? n : null)) : [];
  const events = isObj(g.events) ? g.events : {};
  const seasonTypes = Array.isArray(g.seasonTypes) ? g.seasonTypes.filter(isObj) : [];
  /** @type {GameLogEntry[]} */
  const games = [];
  const seen = new Set();
  for (const t of seasonTypes)
    for (const cat of Array.isArray(t.categories) ? t.categories : [])
      for (const row of Array.isArray(cat?.events) ? cat.events : []) {
        const eventId = str(row?.eventId);
        const e = eventId ? events[eventId] : null;
        if (!eventId || !isObj(e) || seen.has(eventId)) continue;
        seen.add(eventId);
        /** @type {Record<string, number | null>} */
        const stats = {};
        names.forEach((n, i) => {
          if (n) stats[n] = num(Array.isArray(row.stats) ? row.stats[i] : null);
        });
        const home = e.atVs === "vs" ? true : e.atVs === "@" ? false : null;
        const hs = num(e.homeTeamScore);
        const as = num(e.awayTeamScore);
        const teamScore = home == null ? null : home ? hs : as;
        const oppScore = home == null ? null : home ? as : hs;
        games.push({
          eventId,
          date: toDate(e.gameDate),
          opponentId: str(e.opponent?.id),
          opponent: str(e.opponent?.displayName) ?? str(e.opponent?.name),
          home,
          teamScore,
          oppScore,
          result: e.gameResult === "W" || e.gameResult === "D" || e.gameResult === "L" ? e.gameResult : null,
          league: str(e.leagueName),
          stats,
        });
      }
  games.sort((x, y) => (y.date?.getTime() ?? 0) - (x.date?.getTime() ?? 0));
  return { season: str(seasonTypes[0]?.displayName), games };
}

/**
 * @typedef {{ key: string, label: string, value: number | null, source: "ESPN" | "FPL" | "derived",
 *   lowerIsBetter?: boolean, detail?: string | null }} StatRow
 */

/** The season statistics a profile and a comparison show, in order. Goalkeepers get saves and conceded. */
const OUTFIELD = /** @type {const} */ ([
  ["totalGoals", "Goals"],
  ["goalAssists", "Assists"],
  ["totalShots", "Shots"],
  ["shotsOnTarget", "Shots on target"],
  ["foulsSuffered", "Fouls won"],
  ["foulsCommitted", "Fouls committed", true],
  ["offsides", "Offsides", true],
  ["yellowCards", "Yellow cards", true],
  ["redCards", "Red cards", true],
]);
const KEEPER = /** @type {const} */ ([
  ["saves", "Saves"],
  ["goalsConceded", "Goals conceded", true],
]);

/**
 * Season rows for one player: appearances (ESPN), minutes (FPL, when matched), ESPN totals, and per-90 goals
 * and assists derived from those two (only when minutes are known).
 * @param {{ stats?: Record<string, number | null>, group?: string } | null} player a parsed roster player
 * @param {{ minutes: number, starts: number | null } | null | undefined} fpl league.json minutes entry
 * @returns {StatRow[]}
 */
export function seasonStats(player, fpl) {
  const s = player?.stats ?? {};
  const v = (/** @type {string} */ k) => (k in s ? s[k] : null);
  const apps = v("appearances");
  const subs = v("subIns");
  const minutes = fpl ? fpl.minutes : null;
  /** @type {StatRow[]} */
  const rows = [
    {
      key: "appearances",
      label: "Appearances",
      value: apps,
      source: "ESPN",
      detail: apps != null && subs != null ? `${apps - subs} starts, ${subs} as a substitute` : null,
    },
    { key: "minutes", label: "Minutes played", value: minutes, source: "FPL" },
  ];
  /** @type {ReadonlyArray<readonly [string, string, boolean?]>} */
  const list = player?.group === "Goalkeepers" ? [...KEEPER, ...OUTFIELD.slice(-2)] : OUTFIELD;
  for (const [key, label, lower] of list)
    rows.push({ key, label, value: v(key), source: "ESPN", lowerIsBetter: !!lower });
  const per90 = (/** @type {number | null} */ n) =>
    n != null && minutes != null && minutes >= 90 ? Math.round((n / minutes) * 90 * 100) / 100 : null;
  if (player?.group !== "Goalkeepers") {
    rows.push({ key: "goalsPer90", label: "Goals per 90 minutes", value: per90(v("totalGoals")), source: "derived" });
    rows.push({
      key: "assistsPer90",
      label: "Assists per 90 minutes",
      value: per90(v("goalAssists")),
      source: "derived",
    });
  }
  return rows;
}

/**
 * Two players' season rows side by side, with which side is better where both values are known and differ.
 * Rows only one of them has (goalkeeper v outfield) are kept, the other side null.
 * @param {StatRow[]} a
 * @param {StatRow[]} b
 */
export function compareRows(a, b) {
  const keys = [...new Set([...a.map((r) => r.key), ...b.map((r) => r.key)])];
  return keys.map((key) => {
    const ra = a.find((r) => r.key === key);
    const rb = b.find((r) => r.key === key);
    const row = /** @type {StatRow} */ (ra ?? rb);
    const va = ra?.value ?? null;
    const vb = rb?.value ?? null;
    let better = /** @type {"a" | "b" | null} */ (null);
    if (va != null && vb != null && va !== vb) better = va > vb !== !!row.lowerIsBetter ? "a" : "b";
    return { key, label: row.label, source: row.source, a: va, b: vb, better };
  });
}

/** A club for an ESPN team id, or null when the player isn't at a Premier League club. @param {string | null} id */
export const playerClub = (id) => (id ? clubByEspnId(id) : null);
