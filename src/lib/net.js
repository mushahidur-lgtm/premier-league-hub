// @ts-check
/**
 * The network layer: every request to a data provider goes through `fetchJSON`.
 *
 * What it does for callers
 *   - De-duplicates: identical simultaneous requests share one network call.
 *   - Caches: successful responses are kept in a bounded LRU cache with a TTL per data category
 *     (30 s for live data).
 *   - Fails clearly: every failure is a FetchError with a `kind` (see errors.js).
 *   - Retries once, only for transient gateway errors (502/503/504).
 *   - Backs off: after HTTP 429 a provider is left alone for its Retry-After (default 30 s).
 *   - Explains itself: per-provider counters are available via getNetDiagnostics().
 *
 * There is deliberately no CORS-proxy fallback (the predecessor project had one). Every browser request goes to a
 * CORS-enabled ESPN endpoint or to this site's own origin (news from the data pipeline).
 */
import { FetchError } from "./errors.js";
import { LruCache } from "./cache.js";
import { getDiagnostics, recordAttempt, resetDiagnostics } from "./diagnostics.js";

/** Longest a single logical request may take, retry included. */
export const OVERALL_TIMEOUT_MS = 8000;

/** Tunable at runtime with configureNet(); defaults are conservative. */
export const config = {
  memoMax: 100,
  // How long a successful response is reused, by data category (ms). The Refresh button clears everything.
  /** @type {Record<string, number>} */
  ttl: { live: 30e3, news: 60e3, roster: 120e3, standings: 120e3, default: 30e3 },
  retry: { statuses: [502, 503, 504], backoffMs: 250 }, // one retry, transient gateway errors only
  rateLimit: { defaultMs: 30e3, maxMs: 120e3 },
};

/**
 * @param {{ ttl?: Record<string, number>, retry?: Partial<typeof config.retry>,
 *   rateLimit?: Partial<typeof config.rateLimit>, memoMax?: number }} [partial]
 */
export function configureNet(partial = {}) {
  if (partial.ttl) Object.assign(config.ttl, partial.ttl);
  if (partial.retry) Object.assign(config.retry, partial.retry);
  if (partial.rateLimit) Object.assign(config.rateLimit, partial.rateLimit);
  if (partial.memoMax != null) {
    config.memoMax = partial.memoMax;
    memo.max = partial.memoMax;
    while (memo.size > memo.max) memo.delete(memo.keys()[0]);
  }
}

/** Data category from the URL, which selects the TTL. @param {string} [url] */
export function categoryOf(url = "") {
  if (/\/schedule|\/summary|\/scoreboard/.test(url)) return "live";
  if (/\/roster|\/athletes\//.test(url)) return "roster";
  if (/\/standings/.test(url)) return "standings";
  if (/\/news|data\/(news|meta)\.json/i.test(url)) return "news";
  return "default";
}

const hostOf = (/** @type {string} */ url) => {
  try {
    return new URL(url, "http://local.invalid").hostname;
  } catch {
    return "unknown";
  }
};
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/* ───────────────────────── State ───────────────────────── */

const memo = new LruCache({ max: config.memoMax });
/** @type {Map<string, Promise<any>>} `${generation}|${key}` -> request in progress */
const inflight = new Map();
let generation = 0; // bumped by clearMemo() so a request started before a refresh can't repopulate the cache
/** @type {Map<string, number>} host -> epoch ms */
const cooldownUntil = new Map();

export function clearMemo() {
  generation++;
  memo.clear();
}

/** Test helper: back to a pristine state. */
export function resetNetState() {
  clearMemo();
  memo.resetStats();
  inflight.clear();
  cooldownUntil.clear();
  resetDiagnostics();
}

export function getNetDiagnostics() {
  const now = Date.now();
  return getDiagnostics({
    memo: memo.stats(),
    cooldowns: Object.fromEntries(
      [...cooldownUntil].filter(([, t]) => t > now).map(([h, t]) => [h, Math.ceil((t - now) / 1000)]),
    ),
  });
}

/* ───────────────────────── One attempt ───────────────────────── */

/** @param {Response} res */
function retryAfterMs(res) {
  const raw = res.headers?.get?.("retry-after");
  const s = Number(raw);
  return Number.isFinite(s) && s > 0 ? Math.min(s * 1000, config.rateLimit.maxMs) : config.rateLimit.defaultMs;
}

/**
 * A single request. Classifies every failure and records it.
 * @param {string} url
 * @param {{ host: string, timeoutMs: number, as: "json" | "text" }} opts
 */
async function attempt(url, { host, timeoutMs, as }) {
  const id = `direct:${host}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (res.status === 429) {
      const wait = retryAfterMs(res);
      cooldownUntil.set(host, Date.now() + wait);
      throw new FetchError("Rate limited by the data provider", "ratelimit", {
        status: 429,
        host,
        retryAfterMs: wait,
      });
    }
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, "http", { status: res.status, host });
    const body = as === "text" ? await res.text() : await res.json();
    recordAttempt(id, { ok: true, ms: Date.now() - t0 });
    return body;
  } catch (raw) {
    /** @type {FetchError} */
    let err;
    if (raw instanceof FetchError) err = raw;
    else if (/** @type {any} */ (raw)?.name === "AbortError")
      err = new FetchError("Request timed out", "timeout", { host });
    else if (raw instanceof SyntaxError) err = new FetchError("Unexpected response format", "data", { host });
    // TypeError: Failed to fetch -> offline, DNS, or blocked by CORS
    else err = new FetchError("Network error or blocked by CORS", "network", { host });
    recordAttempt(id, { ok: false, kind: err.kind, status: err.status, ms: Date.now() - t0, message: err.message });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ───────────────────────── One logical request ───────────────────────── */

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, as?: "json" | "text", overallMs?: number }} [opts]
 */
async function fetchRaw(url, { timeoutMs = 12000, as = "json", overallMs = OVERALL_TIMEOUT_MS } = {}) {
  const host = hostOf(url);
  const started = Date.now();
  const left = () => overallMs - (Date.now() - started);

  const cooling = cooldownUntil.get(host) ?? 0;
  if (cooling > Date.now()) {
    const ms = cooling - Date.now();
    throw new FetchError(`${host} asked us to slow down; trying again in ${Math.ceil(ms / 1000)}s`, "ratelimit", {
      host,
      retryAfterMs: ms,
    });
  }
  if (offline()) throw new FetchError("You appear to be offline", "offline", { host });

  const go = () => attempt(url, { host, timeoutMs: Math.min(timeoutMs, left()), as });
  try {
    return await go();
  } catch (err) {
    const e = /** @type {FetchError} */ (err);
    const wait = config.retry.backoffMs;
    if (e.kind === "http" && config.retry.statuses.includes(e.status ?? 0) && left() > wait + 1000) {
      await sleep(wait);
      return go();
    }
    throw e;
  }
}

/**
 * Every request goes through here. Identical in-flight requests share one network call; successful
 * responses are reused for their category's TTL. `clearMemo()` (the Refresh button) starts a new
 * generation, so a manual refresh always reaches the network and an older request can't write stale
 * data back into the cache. Pass { fresh: true } to skip the cache for one call.
 * @param {string} url
 * @param {{ fresh?: boolean, as?: "json" | "text", category?: string, timeoutMs?: number, overallMs?: number }} [opts]
 * @returns {Promise<any>}
 */
export function fetchJSON(url, opts = {}) {
  const key = `${opts.as ?? "json"}|${url}`;
  const category = opts.category ?? categoryOf(url);
  if (!opts.fresh) {
    const hit = memo.get(key, category);
    if (hit !== undefined) return Promise.resolve(hit);
  }
  const flightKey = `${generation}|${key}`;
  const pending = inflight.get(flightKey);
  if (pending) return pending;
  const startedIn = generation;
  const p = fetchRaw(url, opts)
    .then((v) => {
      if (startedIn === generation) memo.set(key, v, config.ttl[category] ?? config.ttl.default);
      return v;
    })
    .finally(() => inflight.delete(flightKey));
  inflight.set(flightKey, p);
  return p;
}
