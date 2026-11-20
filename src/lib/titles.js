// @ts-check
/** Per-route document titles. */
import { SITE_NAME } from "../config/site.js";

/**
 * @param {import("./route.js").Route} route
 * @param {{ clubName?: string | null, matchName?: string | null, playerName?: string | null,
 *   compareNames?: string[] }} [ctx]
 */
export function titleFor(route, ctx = {}) {
  switch (route.name) {
    case "home":
      return `${SITE_NAME}: table, fixtures and news`;
    case "club":
      return ctx.clubName ? `${ctx.clubName} · ${SITE_NAME}` : `Club not found · ${SITE_NAME}`;
    case "match":
      return `${ctx.matchName || "Match centre"} · ${SITE_NAME}`;
    case "player":
      return `${ctx.playerName || "Player"} · ${SITE_NAME}`;
    case "compare":
      return ctx.compareNames?.length === 2
        ? `${ctx.compareNames[0]} v ${ctx.compareNames[1]} · Compare players · ${SITE_NAME}`
        : `Compare players · ${SITE_NAME}`;
    case "stats":
      return `Statistics · ${SITE_NAME}`;
    case "search":
      return route.query ? `Search: ${route.query} · ${SITE_NAME}` : `Search · ${SITE_NAME}`;
    default:
      return `Page not found · ${SITE_NAME}`;
  }
}
