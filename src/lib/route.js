// @ts-check

/**
 * @typedef {{ name: "home" } | { name: "club", slug: string } | { name: "match", eventId: string }
 *   | { name: "player", playerId: string } | { name: "compare", a: string | null, b: string | null }
 *   | { name: "stats", view: StatsView, season: number | null, clubs: string[], player: string | null,
 *       metric: string | null, per: boolean }
 *   | { name: "search", query: string } | { name: "not-found", path: string }} Route
 * @typedef {"teams" | "players" | "progression"} StatsView
 */

const SLUG = /^[a-z0-9-]+$/;
const YEAR = /^[0-9]{4}$/;
const DIGITS = /^[0-9]+$/;
const WORD = /^[A-Za-z0-9]{1,30}$/;

/**
 * Parse a location hash such as "#/club/<slug>" into a route.
 * Hash routing keeps every route refreshable on GitLab Pages.
 * @param {string} hash
 * @returns {Route}
 */
export function parseHash(hash) {
  const raw = hash.replace(/^#/, "");
  const [pathPart, queryPart = ""] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) return { name: "home" };
  if (parts[0] === "club" && parts.length === 2 && /^[a-z0-9-]+$/.test(parts[1])) {
    return { name: "club", slug: parts[1] };
  }
  if (parts[0] === "match" && parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { name: "match", eventId: parts[1] };
  }
  if (parts[0] === "player" && parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { name: "player", playerId: parts[1] };
  }
  if (parts[0] === "compare" && parts.length === 1) {
    const q = new URLSearchParams(queryPart);
    const id = (/** @type {string | null} */ v) => (v && /^\d+$/.test(v) ? v : null);
    return { name: "compare", a: id(q.get("a")), b: id(q.get("b")) };
  }
  if (parts[0] === "stats" && parts.length === 1) {
    const q = new URLSearchParams(queryPart);
    const view = q.get("view");
    const season = q.get("season") ?? "";
    const clubs = (q.get("club") ?? "")
      .split(",")
      .filter((c) => SLUG.test(c))
      .slice(0, 4);
    const player = q.get("player") ?? "";
    const metric = q.get("metric") ?? "";
    return {
      name: "stats",
      view: view === "players" || view === "progression" ? view : "teams",
      season: YEAR.test(season) ? Number(season) : null,
      clubs: [...new Set(clubs)],
      player: DIGITS.test(player) ? player : null,
      metric: WORD.test(metric) ? metric : null,
      per: q.get("per") === "1",
    };
  }
  if (parts[0] === "search" && parts.length === 1) {
    return { name: "search", query: new URLSearchParams(queryPart).get("q") ?? "" };
  }
  return { name: "not-found", path: pathPart };
}

/**
 * Build a hash for a route.
 * @param {Route} route
 * @returns {string}
 */
export function toHash(route) {
  switch (route.name) {
    case "home":
      return "#/";
    case "club":
      return `#/club/${encodeURIComponent(route.slug)}`;
    case "match":
      return `#/match/${encodeURIComponent(route.eventId)}`;
    case "player":
      return `#/player/${encodeURIComponent(route.playerId)}`;
    case "compare": {
      const q = new URLSearchParams();
      if (route.a) q.set("a", route.a);
      if (route.b) q.set("b", route.b);
      return q.size ? `#/compare?${q}` : "#/compare";
    }
    case "stats": {
      const q = new URLSearchParams();
      if (route.view && route.view !== "teams") q.set("view", route.view);
      if (route.season) q.set("season", String(route.season));
      if (route.clubs?.length) q.set("club", route.clubs.join(","));
      if (route.player) q.set("player", route.player);
      if (route.metric) q.set("metric", route.metric);
      if (route.per) q.set("per", "1");
      // Commas between club slugs stay readable in a shared link; they need no escaping in a hash.
      return q.size ? `#/stats?${String(q).replace(/%2C/g, ",")}` : "#/stats";
    }
    case "search":
      return route.query ? `#/search?q=${encodeURIComponent(route.query)}` : "#/search";
    default:
      return "#/";
  }
}
