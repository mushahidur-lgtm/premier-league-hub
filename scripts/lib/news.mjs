// @ts-check
/**
 * Pure news processing for the pipeline: club tagging, de-duplication and output shaping.
 * Player tagging (with name-collision handling) is in players.mjs and runs after de-duplication, so the
 * unioned club tags give surnames their club context.
 */
import { makePlayerTagger } from "./players.mjs";

/** @typedef {import("./feed-parser.mjs").FeedItem} FeedItem */
/** @typedef {{ slug: string, name: string, shortName: string, aliases: string[] }} TaggableClub */
/** @typedef {import("./players.mjs").SquadPlayer} SquadPlayer */
/**
 * @typedef {FeedItem & { clubs: string[], players: string[], also: { outlet: string, link: string }[] }} NewsItem
 */

const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Build a tagger that finds clubs named in a story's headline or excerpt.
 * Whole words only (any letter or digit counts as part of a word, so "Villarreal" never matches "Villa", while
 * possessives such as "Palace's" still match), case-sensitive.
 * @param {TaggableClub[]} clubs
 */
export function makeClubTagger(clubs) {
  const rules = clubs.map((c) => ({
    slug: c.slug,
    re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${c.aliases.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "u"),
  }));
  /** @param {{ title: string, excerpt?: string }} item @returns {string[]} */
  return (item) => {
    const text = `${item.title} ${item.excerpt ?? ""}`;
    return rules.filter((r) => r.re.test(text)).map((r) => r.slug);
  };
}

/** Canonical form of a link for duplicate detection: no query string, hash or trailing slash. @param {string} link */
export function canonicalLink(link) {
  try {
    const u = new URL(link);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return link.toLowerCase();
  }
}

const STOP = new Set("a an the and or of to in on at for with from by as is are was be after over vs v".split(" "));

/** @param {string} title */
export const titleTokens = (title) =>
  new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );

/** Jaccard similarity of two token sets. @param {Set<string>} a @param {Set<string>} b */
export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Merge items that are the same story: same canonical link, or near-identical headlines (similarity ≥ threshold)
 * published within two days of each other. The first copy wins (feeds are processed club feeds first); club tags
 * are unioned and other outlets' links kept in `also`.
 * @param {(FeedItem & { clubs: string[] })[]} items
 * @param {{ threshold?: number }} [opts]
 * @returns {NewsItem[]}
 */
export function dedupe(items, { threshold = 0.75 } = {}) {
  /** @type {(NewsItem & { _tokens: Set<string>, _links: Set<string> })[]} */
  const kept = [];
  const byLink = new Map();
  for (const item of items) {
    const key = canonicalLink(item.link);
    const tokens = titleTokens(item.title);
    const time = item.date ? Date.parse(item.date) : NaN;
    let match = byLink.get(key);
    if (!match) {
      match = kept.find((k) => {
        const kt = k.date ? Date.parse(k.date) : NaN;
        const close = Number.isNaN(time) || Number.isNaN(kt) || Math.abs(time - kt) <= 2 * DAY;
        return close && similarity(tokens, k._tokens) >= threshold;
      });
    }
    if (match) {
      for (const c of item.clubs) if (!match.clubs.includes(c)) match.clubs.push(c);
      if (!match._links.has(key)) {
        match._links.add(key);
        if (!match.also.some((a) => a.outlet === item.outlet) && item.outlet !== match.outlet) {
          match.also.push({ outlet: item.outlet, link: item.link });
        }
      }
      match.image ??= item.image;
      byLink.set(key, match);
      continue;
    }
    const entry = { ...item, clubs: [...item.clubs], players: [], also: [], _tokens: tokens, _links: new Set([key]) };
    kept.push(entry);
    byLink.set(key, entry);
  }
  return kept.map(({ _tokens, _links, ...rest }) => rest);
}

/**
 * Tag, de-duplicate, drop stale items, sort newest first and cap the list.
 * @param {{ items: FeedItem[], club: string | null }[]} batches  one batch per feed; `club` is the feed's own club
 * @param {TaggableClub[]} clubs
 * @param {{ now?: Date, maxAgeDays?: number, limit?: number, players?: SquadPlayer[] }} [opts]
 *   `players`: every squad's players (from the ESPN rosters); none means no player tags
 * @returns {NewsItem[]}
 */
export function buildNews(batches, clubs, { now = new Date(), maxAgeDays = 14, limit = 800, players = [] } = {}) {
  const tag = makeClubTagger(clubs);
  const cutoff = now.getTime() - maxAgeDays * DAY;
  const tagged = batches.flatMap(({ items, club }) =>
    items
      .filter((i) => !i.date || Date.parse(i.date) >= cutoff)
      .map((i) => {
        const found = tag(i);
        return { ...i, clubs: club && !found.includes(club) ? [club, ...found] : found };
      }),
  );
  const tagPlayers = players.length ? makePlayerTagger(players, clubs) : () => /** @type {string[]} */ ([]);
  return dedupe(tagged)
    .map((i) => ({ ...i, players: tagPlayers(i) }))
    .sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0))
    .slice(0, limit);
}
