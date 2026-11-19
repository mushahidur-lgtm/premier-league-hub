// @ts-check
/**
 * Search across clubs, players and news stories. Matching ignores accents and case, and every word of
 * the query must start a word in the text (so "watkins injury" finds stories naming both, and "rice" doesn't
 * match "Price").
 */
import { fold, storyHaystack } from "./news.js";

/** @param {string} s */
const norm = (s) =>
  fold(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Query → words (empty for a blank or one-letter query). @param {string} q */
export function queryWords(q) {
  const n = norm(q ?? "");
  return n.length < 2 ? [] : n.split(" ");
}

/** Each word must start a word in `hay` ("rice" finds "Rice", not "Price"). @param {string} hay @param {string} w */
const hasWord = (hay, w) => ` ${hay}`.includes(` ${w}`);
/** @param {string} hay @param {string[]} words */
const hasAll = (hay, words) => words.every((w) => hasWord(hay, w));

/**
 * @param {string} q
 * @param {{
 *   clubs?: { slug: string, name: string, shortName: string, abbr: string, aliases: string[] }[],
 *   players?: { player: { id: string, name: string }, clubSlug: string }[],
 *   stories?: any[],
 * }} pools
 * @param {{ limit?: number }} [opts]
 */
export function search(q, { clubs = [], players = [], stories = [] }, { limit = 20 } = {}) {
  const words = queryWords(q);
  if (!words.length) return { words, clubs: [], players: [], stories: [] };
  const clubText = new Map(clubs.map((c) => [c.slug, norm([c.name, c.shortName, c.abbr, ...c.aliases].join(" "))]));
  const clubHits = clubs.filter((c) => hasAll(clubText.get(c.slug) ?? "", words));
  // A player matches on their own name, or on their name plus their club (surname plus club name).
  const playerHits = players
    .filter(({ player, clubSlug }) => {
      const name = norm(player.name);
      if (!words.some((w) => hasWord(name, w))) return false;
      return hasAll(`${name} ${clubText.get(clubSlug) ?? ""}`, words);
    })
    .slice(0, limit);
  const storyHits = stories
    .filter((s) => hasAll(norm(storyHaystack(s)), words))
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .slice(0, limit);
  return { words, clubs: clubHits, players: playerHits, stories: storyHits };
}
