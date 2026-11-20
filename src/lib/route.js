// @ts-check

/**
 * @typedef {{ name: "home" } | { name: "club", slug: string } | { name: "match", eventId: string }
 *   | { name: "player", playerId: string } | { name: "compare", a: string | null, b: string | null }
 *   | { name: "stats", view: StatsView, season: number | null, clubs: string[], player: string | null,
 *       metric: string | null, per: boolean }
 *   | { name: "fpl" } & FplRoute
 *   | { name: "search", query: string } | { name: "not-found", path: string }} Route
 * @typedef {"teams" | "players" | "progression"} StatsView
 * @typedef {{ view: "players" | "assistant" | "compare", pos: string | null, club: string | null,
 *   max: number | null, sort: string | null, out: string | null, bank: number | null, paid: number | null,
 *   gws: number | null, doubtful: boolean, regular: boolean, a: string | null, b: string | null }} FplRoute
 * Prices (`max`, `bank`, `paid`) are in tenths of £1m, as FPL stores them.
 */

export const FPL_POSITIONS = ["GKP", "DEF", "MID", "FWD"];
export const FPL_GAMEWEEKS = [1, 3, 5];

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
  if (parts[0] === "fpl" && parts.length === 1) {
    const q = new URLSearchParams(queryPart);
    const view = q.get("view");
    const id = (/** @type {string} */ k) => {
      const v = q.get(k) ?? "";
      return DIGITS.test(v) && v.length <= 6 ? v : null;
    };
    /** A price in tenths, within 0–£200.0m. @param {string} k */
    const price = (k) => {
      const v = id(k);
      return v != null && Number(v) <= 2000 ? Number(v) : null;
    };
    const pos = q.get("pos") ?? "";
    const club = q.get("club") ?? "";
    const sort = q.get("sort") ?? "";
    const gws = Number(q.get("gws"));
    return {
      name: "fpl",
      view: view === "assistant" || view === "compare" ? view : "players",
      pos: FPL_POSITIONS.includes(pos) ? pos : null,
      club: SLUG.test(club) ? club : null,
      max: price("max"),
      sort: WORD.test(sort) ? sort : null,
      out: id("out"),
      bank: price("bank"),
      paid: price("paid"),
      gws: FPL_GAMEWEEKS.includes(gws) ? gws : null,
      doubtful: q.get("doubtful") === "1",
      regular: q.get("regular") === "1",
      a: id("a"),
      b: id("b"),
    };
  }
  if (parts[0] === "search" && parts.length === 1) {
    return { name: "search", query: new URLSearchParams(queryPart).get("q") ?? "" };
  }
  return { name: "not-found", path: pathPart };
}

/**
 * Which page a route shows, ignoring its filters: changing a filter (or typing an amount) changes the address
 * but not the page, so focus and scroll stay where the user is. A new view, club, match or player is a new page.
 * @param {Route} route
 * @returns {string}
 */
export function pageKey(route) {
  switch (route.name) {
    case "club":
      return `club/${route.slug}`;
    case "match":
      return `match/${route.eventId}`;
    case "player":
      return `player/${route.playerId}`;
    case "stats":
    case "fpl":
      return `${route.name}/${route.view}`;
    case "search":
      return `search/${route.query}`;
    case "not-found":
      return `not-found/${route.path}`;
    default:
      return route.name;
  }
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
    case "fpl": {
      const q = new URLSearchParams();
      if (route.view && route.view !== "players") q.set("view", route.view);
      for (const k of /** @type {const} */ (["pos", "club", "max", "sort", "out", "bank", "paid", "gws", "a", "b"])) {
        const v = route[k];
        if (v != null && v !== "") q.set(k, String(v));
      }
      if (route.doubtful) q.set("doubtful", "1");
      if (route.regular) q.set("regular", "1");
      return q.size ? `#/fpl?${q}` : "#/fpl";
    }
    case "search":
      return route.query ? `#/search?q=${encodeURIComponent(route.query)}` : "#/search";
    default:
      return "#/";
  }
}
