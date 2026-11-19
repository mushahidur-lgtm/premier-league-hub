// @ts-check
/** Per-route document titles. */
import { SITE_NAME } from "../config/site.js";

/**
 * @param {import("./route.js").Route} route
 * @param {{ clubName?: string | null, matchName?: string | null }} [ctx]
 */
export function titleFor(route, ctx = {}) {
  switch (route.name) {
    case "home":
      return `${SITE_NAME}: table, fixtures and news`;
    case "club":
      return ctx.clubName ? `${ctx.clubName} · ${SITE_NAME}` : `Club not found · ${SITE_NAME}`;
    case "match":
      return `${ctx.matchName || "Match centre"} · ${SITE_NAME}`;
    case "search":
      return route.query ? `Search: ${route.query} · ${SITE_NAME}` : `Search · ${SITE_NAME}`;
    default:
      return `Page not found · ${SITE_NAME}`;
  }
}
