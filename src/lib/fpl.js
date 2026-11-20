// @ts-check
/**
 * Fantasy Premier League page logic over data/fpl.json (written by the pipeline from FPL's public data).
 * Pure functions. Kept apart from the ESPN modules: every figure here is FPL's.
 *
 * Prices are integers in tenths of £1m, as FPL stores them (75 = £7.5m), so budgets never meet float error.
 * Nothing is estimated: a figure FPL doesn't give is null ("–"); a blank gameweek is shown as blank; a
 * player FPL hasn't flagged has `chance: null`, which is "no flag", never 0 %.
 */
import { CLUBS } from "../config/clubs.js";
import { expectObject } from "./validate.js";

const isObj = (/** @type {unknown} */ v) => v !== null && typeof v === "object" && !Array.isArray(v);
const SLUGS = new Set(CLUBS.map((c) => c.slug));
const numOrNull = (/** @type {unknown} */ v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const intOrNull = (/** @type {unknown} */ v) => (Number.isInteger(v) ? /** @type {number} */ (v) : null);
/** @param {unknown} v */
const toDate = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const POSITIONS = /** @type {const} */ (["GKP", "DEF", "MID", "FWD"]);
export const POSITION_NAMES = { GKP: "Goalkeeper", DEF: "Defender", MID: "Midfielder", FWD: "Forward" };
/** FPL's player status codes. */
export const STATUS_NAMES = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not eligible",
};

/**
 * @typedef {{ id: number, name: string, fullName: string, club: string, pos: "GKP" | "DEF" | "MID" | "FWD",
 *   price: number, owned: number | null, points: number | null, ppg: number | null, form: number | null,
 *   minutes: number | null, starts: number | null, status: keyof typeof STATUS_NAMES, chance: number | null,
 *   news: string, xg: number | null, xa: number | null, ep: number | null, espn: string | null,
 *   espnName: string | null, espnLast: string | null }} FplPlayer
 * @typedef {{ gw: number | null, kickoff: Date | null, opp: string, home: boolean, fdr: number | null }} FplFixture
 * @typedef {{ id: number, deadline: Date | null, finished: boolean }} FplGameweek
 * @typedef {{ squadSize: number | null, perClub: number | null, budget: number | null, sellOnFee: number | null }} FplRules
 * @typedef {{ generatedAt: Date | null, asOf: Date | null, carriedOver: boolean, rules: FplRules,
 *   current: FplGameweek | null, next: FplGameweek | null, players: FplPlayer[],
 *   clubs: Record<string, { played: number, fixtures: FplFixture[] }> }} Fpl
 */

/** @param {any} g @returns {FplGameweek | null} */
const gameweek = (g) =>
  isObj(g) && Number.isInteger(g.id) ? { id: g.id, deadline: toDate(g.deadline), finished: g.finished === true } : null;

/**
 * Sanitises fpl.json; anything malformed is dropped rather than shown. Also accepts its own output (a saved
 * copy from the cache, with `current` / `next` at the top level and dates already revived).
 * @param {unknown} json
 * @returns {Fpl}
 */
export function parseFpl(json) {
  const f = /** @type {any} */ (expectObject(json, "Fantasy Premier League file"));
  const r = isObj(f.rules) ? f.rules : {};
  const players = (Array.isArray(f.players) ? f.players : [])
    .filter(
      (/** @type {any} */ p) =>
        isObj(p) &&
        Number.isInteger(p.id) &&
        typeof p.name === "string" &&
        SLUGS.has(p.club) &&
        POSITIONS.includes(p.pos) &&
        Number.isInteger(p.price),
    )
    .map((/** @type {any} */ p) => ({
      id: p.id,
      name: p.name,
      fullName: typeof p.fullName === "string" ? p.fullName : p.name,
      club: p.club,
      pos: p.pos,
      price: p.price,
      owned: numOrNull(p.owned),
      points: intOrNull(p.points),
      ppg: numOrNull(p.ppg),
      form: numOrNull(p.form),
      minutes: intOrNull(p.minutes),
      starts: intOrNull(p.starts),
      status: p.status in STATUS_NAMES ? p.status : "a",
      chance: intOrNull(p.chance),
      news: typeof p.news === "string" ? p.news : "",
      xg: numOrNull(p.xg),
      xa: numOrNull(p.xa),
      ep: numOrNull(p.ep),
      espn: typeof p.espn === "string" && /^\d+$/.test(p.espn) ? p.espn : null,
      espnName: typeof p.espnName === "string" ? p.espnName : null,
      espnLast: typeof p.espnLast === "string" ? p.espnLast : null,
    }));
  /** @type {Fpl["clubs"]} */
  const clubs = {};
  for (const [slug, c] of Object.entries(isObj(f.clubs) ? f.clubs : {})) {
    if (!SLUGS.has(slug) || !isObj(c)) continue;
    clubs[slug] = {
      played: intOrNull(c.played) ?? 0,
      fixtures: (Array.isArray(c.fixtures) ? c.fixtures : [])
        .filter((/** @type {any} */ x) => isObj(x) && SLUGS.has(x.opp))
        .map((/** @type {any} */ x) => ({
          gw: intOrNull(x.gw),
          kickoff: toDate(x.kickoff),
          opp: x.opp,
          home: x.home === true,
          fdr: intOrNull(x.fdr) != null && x.fdr >= 1 && x.fdr <= 5 ? x.fdr : null,
        })),
    };
  }
  return {
    generatedAt: toDate(f.generatedAt),
    asOf: toDate(f.asOf) ?? toDate(f.generatedAt),
    carriedOver: f.carriedOver === true,
    rules: {
      squadSize: intOrNull(r.squadSize),
      perClub: intOrNull(r.perClub),
      budget: intOrNull(r.budget),
      sellOnFee: numOrNull(r.sellOnFee),
    },
    current: gameweek(isObj(f.gameweeks) ? f.gameweeks.current : f.current),
    next: gameweek(isObj(f.gameweeks) ? f.gameweeks.next : f.next),
    players,
    clubs,
  };
}

/** 75 → "£7.5m". @param {number | null} tenths */
export const fmtPrice = (tenths) => (tenths == null ? "–" : `£${(tenths / 10).toFixed(1)}m`);

/**
 * "1.5" / "£1.5m" / "0" → 15 / 15 / 0 (tenths); null when it isn't a price.
 * @param {string} text
 */
export function parsePrice(text) {
  const m = /^\s*£?\s*(\d{1,3})(?:\.(\d))?\s*m?\s*$/i.exec(text);
  return m ? Number(m[1]) * 10 + Number(m[2] ?? 0) : null;
}

/**
 * FPL's selling price: when a player's price has risen since you bought him, you get the purchase price plus
 * `fee` (FPL: half) of the rise, rounded down to £0.1m; when it has fallen, you get the current price.
 * @param {number} paid tenths
 * @param {number} now tenths
 * @param {number} [fee]
 */
export function sellingPrice(paid, now, fee = 0.5) {
  return now <= paid ? now : paid + Math.floor((now - paid) * fee);
}

/** The first gameweek a transfer made now counts for: the next one (or 1 before the season). @param {Fpl} fpl */
export const fromGameweek = (fpl) => fpl.next?.id ?? (fpl.current ? fpl.current.id + 1 : 1);

/**
 * A club's fixtures in gameweeks `from`..`from + n - 1`, one entry per gameweek (blank = none, double = two),
 * and the average FPL difficulty over those fixtures (null when there are none or FPL rates none).
 * @param {{ fixtures: FplFixture[] } | undefined} club
 * @param {number} from
 * @param {number} n
 */
export function fixtureRun(club, from, n) {
  const fixtures = club?.fixtures ?? [];
  const weeks = Array.from({ length: n }, (_, i) => {
    const gw = from + i;
    return { gw, fixtures: fixtures.filter((f) => f.gw === gw) };
  });
  const rated = weeks.flatMap((w) => w.fixtures).filter((f) => f.fdr != null);
  const difficulty = rated.length
    ? Math.round((rated.reduce((s, f) => s + /** @type {number} */ (f.fdr), 0) / rated.length) * 10) / 10
    : null;
  return { weeks, matches: weeks.reduce((s, w) => s + w.fixtures.length, 0), difficulty };
}

/**
 * Share of the club's league minutes the player has played this season (0–1), from FPL minutes and the
 * club's finished FPL fixtures. Null when either is unknown or nothing has been played.
 * @param {FplPlayer} player
 * @param {{ played: number } | undefined} club
 */
export function minutesShare(player, club) {
  if (player.minutes == null || !club?.played) return null;
  return Math.min(1, player.minutes / (90 * club.played));
}

/**
 * Can he be expected to play next gameweek? "available" (no FPL flag), "doubtful" (flagged 50–75 %) or "out"
 * (injured, suspended, unavailable, or flagged under 50 %). `reported`: a recent reliable headline says he is
 * injured or a doubt (rule 3). FPL's flags can lag the news, so a player FPL hasn't flagged but the news has
 * is never "available": he counts as doubtful.
 * @param {FplPlayer} p
 * @param {boolean} [reported]
 * @returns {"available" | "doubtful" | "out"}
 */
export function availability(p, reported = false) {
  const fpl =
    p.status === "a" && p.chance == null
      ? "available"
      : p.chance != null
        ? p.chance >= 100
          ? "available"
          : p.chance >= 50
            ? "doubtful"
            : "out"
        : p.status === "d"
          ? "doubtful"
          : "out";
  return fpl === "available" && reported ? "doubtful" : fpl;
}

/**
 * FPL players matched to ESPN, as squads by club with their ESPN names: the candidates the injury
 * cross-check (src/lib/injuries.js) reads headlines against, the same way club pages do.
 * @param {FplPlayer[]} players
 * @returns {Map<string, { id: string, name: string, lastName: string | null }[]>}
 */
export function espnSquads(players) {
  /** @type {Map<string, { id: string, name: string, lastName: string | null }[]>} */
  const out = new Map();
  for (const p of players) {
    if (!p.espn || !p.espnName) continue;
    const list = out.get(p.club) ?? [];
    list.push({ id: p.espn, name: p.espnName, lastName: p.espnLast });
    out.set(p.club, list);
  }
  return out;
}

/** Sorts the assistant and the player list offer. Each one names the figure it uses; none is invented. */
export const SORTS = {
  form: { label: "Form (FPL)", value: (/** @type {Row} */ r) => r.player.form, high: true },
  points: { label: "Total points", value: (/** @type {Row} */ r) => r.player.points, high: true },
  ppg: { label: "Points per match", value: (/** @type {Row} */ r) => r.player.ppg, high: true },
  fixtures: { label: "Easiest fixtures", value: (/** @type {Row} */ r) => r.run.difficulty, high: false },
  minutes: { label: "Share of minutes", value: (/** @type {Row} */ r) => r.share, high: true },
  price: { label: "Lowest price", value: (/** @type {Row} */ r) => r.player.price, high: false },
  owned: { label: "Ownership", value: (/** @type {Row} */ r) => r.player.owned, high: true },
};
/** @typedef {keyof typeof SORTS} SortKey */
/** @typedef {{ player: FplPlayer, run: ReturnType<typeof fixtureRun>, share: number | null, availability: ReturnType<typeof availability> }} Row */

/** @param {string | null | undefined} key @returns {SortKey} */
export const sortKey = (key) => (key && key in SORTS ? /** @type {SortKey} */ (key) : "form");

/**
 * Each player with his next-`n`-gameweek fixture run, minutes share and availability.
 * @param {Fpl} fpl
 * @param {FplPlayer[]} players
 * @param {number} n
 * @param {Set<string>} [reported] ESPN ids of players a recent headline reports injured or a doubt
 * @returns {Row[]}
 */
export function rows(fpl, players, n, reported = new Set()) {
  const from = fromGameweek(fpl);
  return players.map((player) => ({
    player,
    run: fixtureRun(fpl.clubs[player.club], from, n),
    share: minutesShare(player, fpl.clubs[player.club]),
    availability: availability(player, player.espn != null && reported.has(player.espn)),
  }));
}

/**
 * Sorts rows by one figure; unknown values go last; ties fall back to total points, then name.
 * @param {Row[]} list
 * @param {SortKey} key
 */
export function sortRows(list, key) {
  const s = SORTS[key];
  return [...list].sort((a, b) => {
    const va = s.value(a);
    const vb = s.value(b);
    if (va == null || vb == null) {
      if (va != null) return -1;
      if (vb != null) return 1;
    } else if (va !== vb) return s.high ? vb - va : va - vb;
    return (b.player.points ?? -1) - (a.player.points ?? -1) || a.player.name.localeCompare(b.player.name);
  });
}

/**
 * Transfer assistant: who could replace `out` within `budget` (tenths)? Same position, not the same player,
 * price at most the budget, expected to be available (unless `includeDoubtful`, which adds doubtful players,
 * including those only the news reports injured; players ruled out never appear). `minShare` (0–1) keeps only
 * players who have played at least that share of their club's league minutes. Sorted by `sort`.
 * @param {Fpl} fpl
 * @param {FplPlayer} out
 * @param {{ budget: number, sort?: SortKey, n?: number, includeDoubtful?: boolean, limit?: number,
 *   reported?: Set<string>, minShare?: number | null }} opts
 */
export function replacements(
  fpl,
  out,
  { budget, sort = "form", n = 5, includeDoubtful = false, limit = 20, reported = new Set(), minShare = null },
) {
  const pool = fpl.players.filter((p) => p.pos === out.pos && p.id !== out.id && p.price <= budget);
  const list = rows(fpl, pool, n, reported).filter(
    (r) =>
      (r.availability === "available" || (includeDoubtful && r.availability === "doubtful")) &&
      (minShare == null || (r.share != null && r.share >= minShare)),
  );
  const sorted = sortRows(list, sort);
  return { total: sorted.length, rows: sorted.slice(0, limit) };
}

/**
 * The money available for the replacement: selling price of the player out (from what was paid, when given)
 * plus the bank. All in tenths.
 * @param {{ out: FplPlayer, bank: number, paid?: number | null, fee?: number | null }} input
 */
export function transferBudget({ out, bank, paid = null, fee = null }) {
  const sell = paid == null ? out.price : sellingPrice(paid, out.price, fee ?? 0.5);
  return { sell, bank, total: sell + bank, assumedPrice: paid == null };
}

/**
 * Players matching a name, for the player pickers (accent- and case-insensitive, on short and full name).
 * @param {FplPlayer[]} players
 * @param {string} query
 * @param {number} [limit]
 */
export function findPlayers(players, query, limit = 8) {
  const fold = (/** @type {string} */ s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = fold(query.trim());
  if (q.length < 2) return [];
  return players
    .filter((p) => fold(p.name).includes(q) || fold(p.fullName).includes(q))
    .sort((a, b) => Number(!fold(a.name).startsWith(q)) - Number(!fold(b.name).startsWith(q)) || b.price - a.price)
    .slice(0, limit);
}
