// @ts-check
/**
 * News source credibility model.
 *
 * Two independent labels are attached to every article:
 *   - `tier`     → how much weight the *outlet* carries (this file; outlets live in config/clubs.js)
 *   - `category` → what the story is *about* (see news.js)
 *
 * Tiers are about the outlet, never about whether a particular story is true.
 * A reliable outlet reporting a rumour is still a rumour.
 */
import { OUTLETS } from "../config/clubs.js";

export { OUTLETS };

/**
 * Credibility tiers, strongest first. `weight` feeds relevance ranking. The pipeline's outlets are all
 * "reliable" today; the other tiers are kept so a new outlet can be added in clubs.js without code changes.
 * @type {Record<string, { label: string, short: string, weight: number, rank: number }>}
 */
export const TIERS = {
  official: { label: "Official club", short: "Official", weight: 4, rank: 6 },
  journalist: { label: "Established journalist", short: "Journalist", weight: 3.5, rank: 5 },
  reliable: { label: "Reliable reporting", short: "Reliable", weight: 3, rank: 4 },
  secondary: { label: "Secondary reporting", short: "Secondary", weight: 1.5, rank: 3 },
  speculation: { label: "Rumour / speculation", short: "Rumour", weight: 1, rank: 2 },
  opinion: { label: "Fan opinion", short: "Opinion", weight: 0.8, rank: 1 },
};

/**
 * League-wide football reporters. An article is credited to one only when the feed's author field
 * names them, or the headline is explicitly theirs ("David Ornstein's ..."). An outlet *citing* a
 * journalist gets a "cites X" note, never the journalist's tier.
 * @type {{ name: string, outlet: string | null, re: RegExp }[]}
 */
export const JOURNALISTS = [
  { name: "David Ornstein", outlet: "The Athletic", re: /\bornstein\b/i },
  { name: "Fabrizio Romano", outlet: null, re: /\b(fabrizio )?romano\b/i },
];

/** Outlet names as they appear when one outlet cites another's report. */
export const CITABLE = [
  { name: "The Athletic", re: /\bthe athletic\b/i },
  { name: "Sky Sports", re: /\bsky sports?\b|\bsky germany\b/i },
  { name: "BBC Sport", re: /\bbbc\b/i },
  { name: "ESPN", re: /\bespn\b/i },
  { name: "The Guardian", re: /\bthe guardian\b/i },
  { name: "Reuters", re: /\breuters\b/i },
  { name: "Fabrizio Romano", re: /\b(fabrizio )?romano\b/i },
  { name: "David Ornstein", re: /\bornstein\b/i },
];

/**
 * Which configured outlet a URL belongs to, or null.
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function outletForUrl(url) {
  if (!url) return null;
  let host;
  try {
    const u = new URL(url);
    host = (u.hostname + u.pathname).replace(/^www\./, "");
  } catch {
    return null;
  }
  const hostname = host.split("/")[0];
  const matches = (/** @type {string} */ d) => {
    const [dHost, ...dPath] = d.split("/");
    const hostOk = hostname === dHost || hostname.endsWith("." + dHost);
    return hostOk && (!dPath.length || host.slice(hostname.length + 1).startsWith(dPath.join("/")));
  };
  for (const [id, o] of Object.entries(OUTLETS)) if (o.domains?.some(matches)) return id;
  return null;
}
