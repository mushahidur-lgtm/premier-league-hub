// @ts-check
/**
 * Data layer: URL builders, loaders, the last-good-copy cache and the `useSource` hook.
 *
 * Layout of the data code:
 *   net.js          fetching: shared in-flight requests, 30 s memo (LRU, TTL per category), retries
 *   parsers.js      ESPN parsers (validate structure, skip bad records, never invent values)
 *   availability.js player availability states
 *   news.js         news.json parsing, classification and ranking
 *
 * Every source is addressed by a key: "standings", "news", "scoreboard", or "<kind>:<id>" for
 * per-club / per-match data ("schedule:<espnId>", "roster:<espnId>", "summary:<eventId>"). Each loads on its own.
 * The last good copy of each key is kept in localStorage so a page paints instantly on the next visit
 * (clearly marked as stale), then refreshes in the background.
 *
 * Browser requests only go to CORS-enabled ESPN endpoints (schedule, standings, roster, scoreboard,
 * summary; never /teams/:id) and to this site's own data/*.json, written by the data pipeline.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FetchError } from "./errors.js";
import { clearMemo, fetchJSON, getNetDiagnostics } from "./net.js";
import { parseRoster, parseSchedules, parseStandings, parseSummary } from "./parsers.js";
import { parseNewsFile } from "./news.js";
import { persistentStats } from "./diagnostics.js";
import { readJSON } from "./storage.js";
import { isObj } from "./validate.js";
import { bumpRefreshEpoch, useRefreshEpoch } from "./refresh.js";

export { FetchError, clearMemo, fetchJSON };

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";

export const URLS = {
  /** `soccer/all` includes cup and European games; eng.1 is the fallback. */
  schedule: (/** @type {string} */ espnId, scope = "all") =>
    `${ESPN}/${scope === "league" ? "eng.1" : "all"}/teams/${espnId}/schedule`,
  roster: (/** @type {string} */ espnId) => `${ESPN}/eng.1/teams/${espnId}/roster`,
  standings: "https://site.web.api.espn.com/apis/v2/sports/soccer/eng.1/standings",
  /** League-wide fixtures/results. `dates` is "YYYYMMDD" or "YYYYMMDD-YYYYMMDD"; omitted = ESPN's current round. */
  scoreboard: (/** @type {string | undefined} */ dates) => `${ESPN}/eng.1/scoreboard${dates ? `?dates=${dates}` : ""}`,
  summary: (/** @type {string} */ eventId, league = "all") => `${ESPN}/${league || "all"}/summary?event=${eventId}`,
};

/** Same-origin files written by scripts/fetch-data.mjs (public/data/ → <BASE>data/). */
export const dataUrl = (/** @type {string} */ name) => `${import.meta.env?.BASE_URL ?? "/"}data/${name}`;

/** Where each kind of data comes from, for the "source · fetched at" line every section shows. */
export const SOURCES = {
  schedule: { name: "ESPN", detail: "club schedule" },
  roster: { name: "ESPN", detail: "squad and injury list" },
  standings: { name: "ESPN", detail: "Premier League table" },
  scoreboard: { name: "ESPN", detail: "Premier League scoreboard" },
  summary: { name: "ESPN", detail: "match summary" },
  news: {
    name: "BBC Sport, The Guardian and Sky Sports",
    detail: "news feeds, collected by this site's data pipeline",
  },
};

/** "schedule:<espnId>" → "schedule". @param {string} key */
export const kindOf = (key) => key.split(":")[0];

/* ────────────────────────────── Loaders ────────────────────────────── */

/**
 * @typedef {{ data: any, warnings?: string[] }} LoadResult
 * Each loader returns a LoadResult or throws (a FetchError) if nothing usable came back.
 */

export const LOADERS = {
  /** @param {string} espnId @returns {Promise<LoadResult>} */
  schedule: async (espnId) => {
    const pair = (/** @type {string} */ base) => Promise.all([fetchJSON(base), fetchJSON(`${base}?fixture=true`)]);
    try {
      return { data: parseSchedules(await pair(URLS.schedule(espnId)), espnId) };
    } catch {
      return {
        data: parseSchedules(await pair(URLS.schedule(espnId, "league")), espnId),
        warnings: ["Showing Premier League matches only"],
      };
    }
  },
  /** @param {string} espnId @returns {Promise<LoadResult>} */
  roster: async (espnId) => ({ data: parseRoster(await fetchJSON(URLS.roster(espnId))) }),
  /** @returns {Promise<LoadResult>} */
  standings: async () => ({ data: parseStandings(await fetchJSON(URLS.standings)) }),
  /** @param {string} [dates] @returns {Promise<LoadResult>} */
  scoreboard: async (dates) => ({ data: parseSchedules([await fetchJSON(URLS.scoreboard(dates))], null) }),
  /** @param {string} eventId @param {string} [league] @returns {Promise<LoadResult>} */
  summary: async (eventId, league) => ({ data: parseSummary(await fetchJSON(URLS.summary(eventId, league))) }),
  /**
   * News from the data pipeline. meta.json is optional: without it the news still shows, with a warning.
   * @returns {Promise<LoadResult>}
   */
  news: async () => {
    const [news, meta] = await Promise.allSettled([fetchJSON(dataUrl("news.json")), fetchJSON(dataUrl("meta.json"))]);
    if (news.status === "rejected") throw news.reason;
    const { generatedAt, items } = parseNewsFile(news.value);
    const warnings = [];
    let feeds = null;
    if (meta.status === "fulfilled" && isObj(meta.value) && Array.isArray(meta.value.feeds)) {
      feeds = meta.value.feeds.filter(isObj).map((/** @type {any} */ f) => ({
        club: f.club ?? null,
        outlet: f.outlet ?? null,
        ok: f.ok === true,
        items: Number.isFinite(f.items) ? f.items : 0,
      }));
      const failed = feeds.filter((/** @type {any} */ f) => !f.ok).length;
      if (failed) warnings.push(`${failed} of ${feeds.length} news feeds failed at the last update`);
    } else {
      warnings.push("Feed status unavailable");
    }
    return { data: { generatedAt, items, feeds }, warnings };
  },
};

/**
 * The loader for a key, or null for an unknown key.
 * @param {string} key
 * @returns {(() => Promise<LoadResult>) | null}
 */
export function loaderFor(key) {
  const [kind, id, extra] = key.split(":");
  switch (kind) {
    case "standings":
    case "news":
      return id ? null : LOADERS[kind];
    case "scoreboard":
      return () => LOADERS.scoreboard(id || undefined);
    case "schedule":
    case "roster":
      return id ? () => LOADERS[kind](id) : null;
    case "summary":
      return id ? () => LOADERS.summary(id, extra) : null;
    default:
      return null;
  }
}

/* ────────────────────────────── Persistent cache ────────────────────────────── */

const CACHE_KEY = "plh-cache-v1";

/**
 * Settings for the last-good-copy cache in localStorage.
 *   maxBytes   serialised size cap; the oldest-saved sources are evicted to stay under it
 *   maxAgeMs   how long a saved source may still be shown, by full key or by kind, with a "default"
 * @type {{ maxBytes: number, maxAgeMs: Record<string, number> }}
 */
export const cacheConfig = {
  maxBytes: 2_000_000,
  maxAgeMs: { default: 3 * 86400e3 },
};

/** @param {{ maxBytes?: number, maxAgeMs?: Record<string, number> }} [partial] */
export function configureCache(partial = {}) {
  if (partial.maxBytes != null) cacheConfig.maxBytes = partial.maxBytes;
  if (partial.maxAgeMs) Object.assign(cacheConfig.maxAgeMs, partial.maxAgeMs);
}
const maxAgeOf = (/** @type {string} */ key) =>
  cacheConfig.maxAgeMs[key] ?? cacheConfig.maxAgeMs[kindOf(key)] ?? cacheConfig.maxAgeMs.default;

const DATE_KEYS = new Set(["date", "updated", "savedAt", "dob", "generatedAt"]);
const revive = (/** @type {string} */ k, /** @type {unknown} */ v) =>
  DATE_KEYS.has(k) && typeof v === "string" ? new Date(v) : v;
const validDate = (/** @type {unknown} */ d) => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * Cached data crosses a JSON round trip (and possibly an older version of the app), so check it
 * before it reaches the UI: anything that would later throw on `match.date.getTime()` is dropped.
 * @param {any} data
 */
function sanitizeSchedule(data) {
  if (!data || !Array.isArray(data.fixtures) || !Array.isArray(data.results)) return null;
  const ok = (/** @type {any} */ m) => m && typeof m === "object" && validDate(m.date);
  return { ...data, fixtures: data.fixtures.filter(ok), results: data.results.filter(ok) };
}
/** @param {any} data */
function sanitizeNews(data) {
  if (!data || !Array.isArray(data.items)) return null;
  const items = data.items.filter(
    (/** @type {any} */ i) => i && typeof i === "object" && (i.date === null || validDate(i.date)),
  );
  return { ...data, items };
}
/** Checks by kind, so every "schedule:<espnId>" key is sanitised. */
/** @type {Record<string, (data: any) => any>} */
const CACHE_CHECKS = { schedule: sanitizeSchedule, scoreboard: sanitizeSchedule, news: sanitizeNews };

/**
 * Saved sources that are still within their maximum age and well-formed: { [key]: { data, savedAt } }.
 * @returns {Record<string, { data: any, savedAt: Date }>}
 */
export function readCache(now = Date.now()) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw, revive);
    /** @type {Record<string, { data: any, savedAt: Date }>} */
    const out = {};
    for (const [key, v] of Object.entries(isObj(parsed) ? parsed : {})) {
      if (!validDate(v?.savedAt)) continue;
      if (now - v.savedAt.getTime() >= maxAgeOf(key)) {
        persistentStats.expired++;
        continue;
      }
      const check = CACHE_CHECKS[kindOf(key)];
      const data = check ? check(v.data) : v.data;
      if (data != null) out[key] = { ...v, data };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Saves one source. If the whole cache would exceed `maxBytes`, or the browser refuses the write
 * (quota), the oldest-saved *other* sources are evicted first. Returns whether the write happened.
 * @param {string} key
 * @param {unknown} data
 */
export function writeCache(key, data, savedAt = new Date()) {
  try {
    /** @type {Record<string, any>} */
    const all = readJSON(CACHE_KEY, {});
    all[key] = { data, savedAt };
    const oldestOther = () =>
      Object.entries(all)
        .filter(([k]) => k !== key)
        .sort((a, b) => new Date(a[1]?.savedAt ?? 0).getTime() - new Date(b[1]?.savedAt ?? 0).getTime())[0];
    let json = JSON.stringify(all);
    while (json.length > cacheConfig.maxBytes) {
      const victim = oldestOther();
      if (!victim) {
        persistentStats.rejected++; // this source alone is over the limit
        return false;
      }
      delete all[victim[0]];
      persistentStats.evicted++;
      json = JSON.stringify(all);
    }
    for (let tries = 0; ; tries++) {
      try {
        localStorage.setItem(CACHE_KEY, json);
        persistentStats.bytes = json.length;
        return true;
      } catch (err) {
        const victim = tries < 4 ? oldestOther() : null;
        if (!victim) throw err;
        delete all[victim[0]];
        persistentStats.evicted++;
        json = JSON.stringify(all);
      }
    }
  } catch {
    persistentStats.writeFailures++; // storage full or unavailable: caching is optional
    return false;
  }
}

/** Cache and provider counters for debugging; also available in the console as `plhDiagnostics()`. */
export const getDiagnostics = () => getNetDiagnostics();
if (typeof window !== "undefined") /** @type {any} */ (window).plhDiagnostics = getDiagnostics;

/* ────────────────────────────── Shared loading ────────────────────────────── */

/** @type {Map<string, { token: number, promise: Promise<LoadResult & { savedAt: Date }> }>} */
const flights = new Map();
/** @type {Map<string, number>} */
const newest = new Map();
let tokens = 0;

/**
 * Loads one key. Callers asking for a key that is already loading share that request, unless
 * `force` is set (a refresh), in which case a new request starts and only the newest result is
 * written to the cache, so an older, slower response can't overwrite fresher data.
 * @param {string} key
 * @param {{ force?: boolean, loader?: () => Promise<LoadResult> }} [opts]
 */
export function loadSource(key, { force = false, loader } = {}) {
  const running = flights.get(key);
  if (running && !force) return running.promise;
  const load = loader ?? loaderFor(key);
  if (!load) return Promise.reject(new FetchError(`Unknown data source "${key}"`, "data"));
  const token = ++tokens;
  newest.set(key, token);
  const promise = (async () => {
    const { data, warnings = [] } = await load();
    const savedAt = new Date();
    if (newest.get(key) === token) writeCache(key, data, savedAt);
    return { data, warnings, savedAt };
  })().finally(() => {
    if (flights.get(key)?.token === token) flights.delete(key);
  });
  flights.set(key, { token, promise });
  return promise;
}

/** The Refresh button: drop the 30 s memo and tell every mounted source to reload. */
export function refreshAll() {
  clearMemo();
  bumpRefreshEpoch();
}

/** Test helper. */
export function resetSourceState() {
  flights.clear();
  newest.clear();
}

/* ────────────────────────────── Hook ────────────────────────────── */

/**
 * @typedef {"loading" | "ok" | "empty" | "refreshing" | "error" | "idle"} SourceStatus
 * @typedef {{
 *   status: SourceStatus, data: any, error: string | null, warnings: string[], savedAt: Date | null,
 *   stale: boolean, empty: boolean, source: { name: string, detail: string } | null, reload: () => Promise<boolean>
 * }} SourceState
 */

/** Default emptiness test: no rows / items / players / fixtures-and-results. @param {any} data */
export function isEmptyData(data) {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (Array.isArray(data.rows)) return data.rows.length === 0;
  if (Array.isArray(data.items)) return data.items.length === 0;
  if (Array.isArray(data.players)) return data.players.length === 0;
  if (Array.isArray(data.fixtures) && Array.isArray(data.results)) return !data.fixtures.length && !data.results.length;
  return false;
}

/** @param {string | null} key */
function initial(key) {
  const cached = key ? readCache()[key] : undefined;
  if (key) cached ? persistentStats.hits++ : persistentStats.misses++;
  return {
    key,
    status: /** @type {SourceStatus} */ (key ? (cached ? "refreshing" : "loading") : "idle"),
    data: cached?.data ?? null,
    error: /** @type {string | null} */ (null),
    warnings: /** @type {string[]} */ ([]),
    savedAt: cached?.savedAt ?? null,
    fresh: false, // data arrived from the network while this component was mounted
  };
}

/**
 * One data source for a component. Shows the last good copy at once (if any), then loads fresh data;
 * reloads on refreshAll(). Pass `null` as the key to load nothing (e.g. before a club is known).
 *
 *   status    loading (nothing to show yet) · refreshing (showing older data, fetching) · ok · empty ·
 *             error (see `error`; `data` may still hold the last good copy) · idle (no key)
 *   stale     true when `data` is a saved copy or a refresh failed, so the UI can say so
 *   savedAt   when `data` was fetched; `source` names where it came from
 *
 * @param {string | null} key
 * @param {{ isEmpty?: (data: any) => boolean }} [opts]
 * @returns {SourceState}
 */
export function useSource(key, { isEmpty = isEmptyData } = {}) {
  const [state, setState] = useState(() => initial(key));
  // A new key (e.g. another club) starts from that key's own cache, never the previous key's data.
  if (state.key !== key) setState(initial(key));
  const request = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (!key) return false;
      const id = ++request.current;
      setState((s) => (s.key === key ? { ...s, status: s.data != null ? "refreshing" : "loading", error: null } : s));
      try {
        const r = await loadSource(key, { force });
        if (id !== request.current) return true;
        setState({
          key,
          status: "ok",
          data: r.data,
          error: null,
          warnings: r.warnings ?? [],
          savedAt: r.savedAt,
          fresh: true,
        });
        return true;
      } catch (err) {
        if (id === request.current) {
          const message = /** @type {any} */ (err)?.message ?? "Failed to load";
          setState((s) => (s.key === key ? { ...s, status: "error", error: message } : s));
        }
        return false;
      }
    },
    [key],
  );

  useEffect(() => {
    load();
  }, [load]);

  // refreshAll() bumps the epoch; reload (bypassing any request in progress) when it changes.
  const epoch = useRefreshEpoch();
  const seenEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch === seenEpoch.current) return;
    seenEpoch.current = epoch;
    load(true);
  }, [epoch, load]);

  const reload = useCallback(() => load(true), [load]);
  const hasData = state.data != null;
  const empty = hasData && isEmpty(state.data);
  return {
    status: state.status === "ok" && empty ? "empty" : state.status,
    data: state.data,
    error: state.error,
    warnings: state.warnings,
    savedAt: state.savedAt,
    stale: hasData && (!state.fresh || state.status === "error"),
    empty,
    source: key ? (SOURCES[/** @type {keyof typeof SOURCES} */ (kindOf(key))] ?? null) : null,
    reload,
  };
}

const AUTO_REFRESH_MS = 10 * 60e3;

/**
 * Mount once (in the app shell): refreshes every mounted source every 10 minutes while the tab is
 * visible, and on return to the tab after that long.
 */
export function useAutoRefresh(intervalMs = AUTO_REFRESH_MS) {
  const last = useRef(Date.now());
  useEffect(() => {
    const maybe = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current > intervalMs) {
        last.current = Date.now();
        refreshAll();
      }
    };
    const id = setInterval(maybe, 60e3);
    document.addEventListener("visibilitychange", maybe);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", maybe);
    };
  }, [intervalMs]);
}
