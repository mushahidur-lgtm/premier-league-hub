// @ts-check

/**
 * @typedef {{ name: "home" } | { name: "club", slug: string } | { name: "match", eventId: string }
 *   | { name: "search", query: string } | { name: "not-found", path: string }} Route
 */

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
    case "search":
      return route.query ? `#/search?q=${encodeURIComponent(route.query)}` : "#/search";
    default:
      return "#/";
  }
}
