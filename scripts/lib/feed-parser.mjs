// @ts-check
/**
 * Dependency-free RSS 2.0 / Atom parser for Node (no DOMParser). Ported from Arsenal Hub's
 * src/lib/feeds.js: same entity decoding, HTML stripping, image upgrade and title/byline split,
 * and the same item shape, so the browser code ported in Phase 2 can consume it unchanged.
 */

/**
 * @typedef {{
 *   id: string, title: string, link: string, date: string | null, image: string | null,
 *   excerpt: string, author: string, outlet: string
 * }} FeedItem
 */

const ENTITIES = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  pound: "£",
  euro: "€",
};

/** @param {string} [s] */
export const decode = (s = "") =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[/** @type {keyof typeof ENTITIES} */ (n.toLowerCase())] ?? m);

/** @param {string} [html] */
export const stripHtml = (html = "") =>
  decode(String(html).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** Ask BBC's image CDN for an 800px rendition instead of the feed's tiny thumbnail. @param {string | null} url */
export function upgradeImage(url) {
  if (!url) return url;
  return url.replace(/(ichef\.bbci\.co\.uk\/(?:ace\/(?:standard|ws)|news))\/\d{2,4}\//, "$1/800/");
}

/** @param {string} [s] */
export function parseDate(s) {
  if (!s) return null;
  const d = new Date(String(s).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Unwrap CDATA sections, leaving their content raw (it is HTML or text, not XML). @param {string} s */
const unCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text content of the first <tag> (namespaced names allowed, e.g. "dc:creator"). @param {string} xml @param {string} tag */
function tagText(xml, tag) {
  const t = escapeRe(tag);
  const m = xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "i"));
  return m ? unCdata(m[1]).trim() : "";
}

/** Attribute of the first <tag ...> matching an optional attribute filter. */
function tagAttr(/** @type {string} */ xml, /** @type {string} */ tag, /** @type {string} */ attr, filter = /./) {
  const re = new RegExp(`<${escapeRe(tag)}\\b([^>]*)\\/?>`, "gi");
  for (const m of xml.matchAll(re)) {
    if (!filter.test(m[1])) continue;
    const a = m[1].match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
    if (a) return decode(a[1]);
  }
  return "";
}

const goodImage = (/** @type {string} */ x) =>
  !!x && /^https?:/.test(x) && !/default|spacer|pixel|feeds\.feedburner/.test(x);

/** Multi-paragraph descriptions become one readable line. @param {string} html */
function htmlToText(html) {
  const lines = decode(html) // descriptions are often entity-escaped HTML
    .replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, "\n")
    .split("\n")
    .map(stripHtml)
    .filter(Boolean);
  return lines.map((l, i) => (i < lines.length - 1 && !/[.!?…:]$/.test(l) ? `${l}.` : l)).join(" ");
}

/**
 * Parse an RSS 2.0 or Atom document into items. Throws on anything that isn't a feed.
 * Items without a title or an http(s) link are dropped.
 * @param {string} xml
 * @param {string} outlet
 * @returns {FeedItem[]}
 */
export function parseFeed(xml, outlet) {
  if (typeof xml !== "string" || !xml.trim()) throw new Error("Feed was empty");
  const body = xml.trimStart().replace(/<!--[\s\S]*?-->/g, "");
  if (!/<(rss|feed|rdf:RDF)\b/i.test(body)) throw new Error("Not an RSS or Atom feed");

  const blocks = [...body.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  /** @type {FeedItem[]} */
  const items = [];
  for (const el of blocks) {
    const link =
      decode(tagText(el, "link")) ||
      tagAttr(el, "link", "href", /rel\s*=\s*["']alternate["']/i) ||
      tagAttr(el, "link", "href");
    let title = stripHtml(decode(tagText(el, "title")));
    if (!title || !/^https?:\/\//.test(link)) continue;

    let author = stripHtml(tagText(el, "dc:creator") || tagText(el, "name") || tagText(el, "author"));
    // "Headline | Jonathan Wilson" → headline + author
    const tail = title.match(/\s+\|\s+([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,3})$/);
    if (tail) {
      title = title.slice(0, tail.index);
      author ||= tail[1];
    }

    const description = tagText(el, "description") || tagText(el, "summary");
    const content = tagText(el, "content:encoded") || tagText(el, "content");
    const inlineImg = (decode(content || description).match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] ?? "";
    const image =
      [
        tagAttr(el, "media:thumbnail", "url"),
        tagAttr(el, "media:content", "url", /medium\s*=\s*["']image["']|type\s*=\s*["']image|width/i),
        tagAttr(el, "media:content", "url"),
        tagAttr(el, "enclosure", "url", /type\s*=\s*["']image/i),
        decode(inlineImg),
      ].find(goodImage) || null;

    items.push({
      id: decode(tagText(el, "guid") || tagText(el, "id")) || link,
      title,
      link,
      date: parseDate(
        tagText(el, "pubDate") || tagText(el, "published") || tagText(el, "dc:date") || tagText(el, "updated"),
      ),
      image: upgradeImage(image),
      excerpt: htmlToText(description || content).slice(0, 400),
      author,
      outlet,
    });
  }
  return items;
}
