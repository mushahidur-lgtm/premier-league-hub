// @ts-check
/**
 * In-memory counters for debugging data problems. Nothing here is persisted or sent anywhere.
 * In the browser console:  plhDiagnostics()   (also returned by getDiagnostics()).
 */
const state = {
  /** @type {Record<string, number>} */
  dropped: {},
  /** @type {Record<string, any>} */
  providers: {},
  persistent: { hits: 0, misses: 0, expired: 0, evicted: 0, rejected: 0, writeFailures: 0, bytes: 0 },
};

/** A record that failed validation was skipped. @param {string} label @param {number} [n] */
export function noteDropped(label, n = 1) {
  state.dropped[label] = (state.dropped[label] ?? 0) + n;
}

const provider = (/** @type {string} */ id) =>
  (state.providers[id] ??= { requests: 0, ok: 0, failures: {}, lastError: null, lastOkAt: null, totalMs: 0 });

/**
 * One finished request against a provider ("direct:<host>").
 * @param {string} id
 * @param {{ ok: boolean, kind?: string | null, status?: number | null, ms?: number, message?: string | null }} r
 */
export function recordAttempt(id, { ok, kind = null, status = null, ms = 0, message = null }) {
  const p = provider(id);
  p.requests++;
  p.totalMs += ms;
  if (ok) {
    p.ok++;
    p.lastOkAt = Date.now();
  } else {
    p.failures[kind ?? "unknown"] = (p.failures[kind ?? "unknown"] ?? 0) + 1;
    p.lastError = { kind, status, message, at: Date.now() };
  }
}

export const persistentStats = state.persistent;

/** @param {Record<string, unknown>} [extra] */
export function getDiagnostics(extra = {}) {
  const providers = Object.fromEntries(
    Object.entries(state.providers).map(([id, p]) => [
      id,
      { ...p, avgMs: p.requests ? Math.round(p.totalMs / p.requests) : null },
    ]),
  );
  return { ...extra, persistentCache: { ...state.persistent }, providers, dropped: { ...state.dropped } };
}

export function resetDiagnostics() {
  state.dropped = {};
  state.providers = {};
  Object.assign(state.persistent, {
    hits: 0,
    misses: 0,
    expired: 0,
    evicted: 0,
    rejected: 0,
    writeFailures: 0,
    bytes: 0,
  });
}
