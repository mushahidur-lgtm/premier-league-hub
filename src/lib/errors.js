// @ts-check
/**
 * One error type for everything that can go wrong while getting data.
 *
 * kind:
 *   "network"   the request never completed: offline, DNS, or blocked by CORS
 *   "offline"   the browser reports no connection; nothing was sent
 *   "timeout"   no answer within the time budget
 *   "http"      the provider answered with an error status (see `status`)
 *   "ratelimit" HTTP 429, or a request refused locally while a provider is cooling down
 *   "data"      the answer arrived but wasn't the shape we need (invalid JSON, wrong structure)
 */
export class FetchError extends Error {
  constructor(message, kind, extra = {}) {
    super(message);
    this.name = "FetchError";
    this.kind = kind;
    this.status = extra.status ?? null;
    this.host = extra.host ?? null;
    this.via = extra.via ?? null;
    this.retryAfterMs = extra.retryAfterMs ?? null;
  }
}
