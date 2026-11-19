// @ts-check
/**
 * News intelligence: classification, credibility, story grouping and ranking. Pure functions only
 * (no DOM, no React) so they can be unit-tested.
 *
 *   data/news.json ──parseNewsFile──▶ items ──enrich──▶ articles ──cluster──▶ stories ──rank──▶ UI
 *
 * The data pipeline (scripts/fetch-data.mjs) has already parsed the feeds, removed near-identical
 * copies (listing them under `also`) and tagged each item with the clubs it names (`clubs`, slugs).
 * Everything here is club-agnostic: "for a club" always means a slug from config/clubs.js.
 */
import { CLUBS } from "../config/clubs.js";
import { CITABLE, JOURNALISTS, OUTLETS, TIERS } from "./sources.js";
import { arr, date, expectArray, expectObject, isObj, str } from "./validate.js";
import { noteDropped } from "./diagnostics.js";

/* ───────────────────────── Text helpers ───────────────────────── */

// NFD doesn't decompose ø/æ/ß/ł/đ, so map them first ("Ødegaard" ≡ "Odegaard").
const SPECIAL = { ø: "o", Ø: "O", æ: "ae", Æ: "Ae", ß: "ss", ł: "l", Ł: "L", đ: "d", Đ: "D", œ: "oe", Œ: "Oe", ı: "i" };
export const fold = (s = "") =>
  String(s)
    .replace(/[øØæÆßłŁđĐœŒı]/g, (c) => SPECIAL[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const STOP = new Set(
  `a an the and or but of to in on for with as at by from into onto over under after before about
  is are was were be been being has have had do does did will would could should can may might must shall
  it its his her their they them he she we you i me my our your this that these those there here what which who whom
  whose why how when where than then so not no yes up down out off just also only very more most much many some any
  all each every both few such own same other new says say said tells told reveals revealed admits explains insists
  claims claim set get gets got make makes made take takes took give gives gave go goes going went come comes came
  vs v amid despite while still yet latest news live update updates report reports reported exclusive watch video
  one two three four five first last next big major key huge after ahead now today tonight week weekend s`.split(/\s+/),
);

/** Every word of every club's names and aliases (folded), from config/clubs.js. */
const CLUB_NAME_WORDS = new Set(
  CLUBS.flatMap((c) => [c.name, c.shortName, ...c.aliases])
    .flatMap((n) => fold(n).split(/[^a-z0-9]+/))
    .filter((w) => w.length > 1),
);

/** Words that appear in almost every football story, so they never prove two stories match. */
const GENERIC = new Set([
  ...`fc club clubs premier league champions football soccer team side squad players player boss manager head
  coach fans fan supporters season january summer window transfer transfers deal deals contract contracts game games
  match matches goal goals uefa english stadium`.split(/\s+/),
  ...CLUB_NAME_WORDS,
]);

const MONTHS = new Set(
  "january february march april may june july august september october november december".split(" "),
);

/**
 * Club / place words: a shared club name must never on its own merge two stories. The Premier League
 * clubs come from config/clubs.js; the rest are common European clubs and nations.
 */
const CLUB_WORDS = new Set([
  ...CLUB_NAME_WORDS,
  ...`real madrid barcelona barca bayern munich juventus juve inter milan ac psg paris saint germain dortmund borussia
  leverkusen bayer atletico atleti benfica porto sporting napoli roma lazio ajax psv feyenoord celtic rangers city
  united utd wolves wolverhampton west ham burnley england spain france brazil germany portugal italy saudi`.split(
    /\s+/,
  ),
]);

const tokenize = (s) =>
  fold(s)
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9£€\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);

const contentTokens = (s) => tokenize(s).filter((t) => !STOP.has(t) && t.length > 1);

/** Capitalised words in the original headline that look like names. */
function headlineEntities(title) {
  const out = new Set();
  const words = title.replace(/[‘’"“”:;,.!?()|]/g, " ").split(/\s+/);
  for (const w of words) {
    if (!/^[A-ZÀ-Ý]/.test(w)) continue;
    const t = fold(w)
      .replace(/'s$/, "")
      .replace(/[^a-z]/g, "");
    if (t.length < 3 || STOP.has(t) || GENERIC.has(t) || MONTHS.has(t) || CLUB_WORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

/**
 * Concepts = what kind of event a headline describes. Two headlines about the
 * same person only merge if they also share a concept ("Rice contract" vs
 * "Rice workload" stay apart).
 */
const CONCEPTS = {
  death: /\b(dies|died|dead|death|passed away|tribute|tributes|obituary|mourn\w*|rip)\b/,
  contract:
    /\b(contract|renew\w*|extension|extend\w* (his |their )?(contract|deal|stay)|new deal|new [\w-]+( [\w-]+)? deal|\w+-year deal|long-term deal|signs? new|commit\w* (his )?future|wages?|salary|pay rise)\b/,
  transfer:
    /\b(transfers?|window|bid|bids|offer|target\w*|interest\w*|swap|loan\w*|approach\w*|pursu\w*|chase|eyes|eyeing|monitor\w*|wants? to sign|keen on|fee|linked|signing|sign|signs|signed|move|exit|sale|sell|depart\w*|talks)\b|[£€]\s?\d/,
  injury:
    /\b(injur\w*|hamstring|knee|ankle|groin|calf|thigh|muscle|fitness|setback|scan|sidelined|ruled out|surgery|knock|doubt|absence|layoff|recovery|return\w* to training|behind-closed-doors)\b/,
  match:
    /\b(win|wins|won|beat|beats|beaten|draw|draws|drew|defeat\w*|lose|loses|lost|victory|thrash\w*|held|stun\w*|ratings|player ratings|match report|preview|line-?up|team news|predicted|starting xi|kick-?off|result|comeback|clash|winner|equaliser|scores?|\d+-\d+)\b/,
  discipline: /\b(ban|banned|suspend\w*|red card|charged|fa charge|sent off)\b/,
  award: /\b(award|awards|nominat\w*|player of the (month|season|year)|ballon)\b/,
  finance: /\b(revenue|profit|loss|accounts|financial|psr|owners?|takeover|investment|ticket\w*|prices?)\b/,
};

function conceptsOf(text) {
  const t = fold(text);
  return new Set(
    Object.entries(CONCEPTS)
      .filter(([, re]) => re.test(t))
      .map(([k]) => k),
  );
}

/* ───────────────────────── Categories ───────────────────────── */

export const CATEGORIES = [
  { id: "all", label: "All news" },
  { id: "official", label: "Official" },
  { id: "match", label: "Match news" },
  { id: "transfer", label: "Transfers" },
  { id: "injury", label: "Injuries" },
  { id: "pl", label: "Premier League" },
  { id: "ucl", label: "Champions League" },
  { id: "analysis", label: "Analysis & opinion" },
  { id: "club", label: "Club & history" },
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
// Short labels for chips on cards
export const CATEGORY_SHORT = {
  official: "Official",
  match: "Match",
  transfer: "Transfer",
  injury: "Injury",
  pl: "Premier League",
  ucl: "Champions League",
  analysis: "Analysis",
  club: "Club",
  contract: "Contract",
};

const RENEWAL_EXIT = /\b(exit|leave|sell|sale|bid|target|swap)\b/;

const ANALYSIS_RE =
  /\b(analysis|talking points|things to look out for|q&a|mailbag|verdict|column|opinion|podcast|tactical|tactics|explained|ranking|ranked|ratings|what we learned|takeaways|debate|squad ladder|questions after|interview|lessons)\b|^(how|why|what|inside|the story of)\b/;

function categorize(a) {
  const text = fold(`${a.title} ${a.excerpt}`);
  const title = fold(a.title);
  const cats = new Set();
  if (a.tier === "official") cats.add("official");
  // Transfer talk is judged on the headline only: summaries mention "signing" far too loosely.
  // Awards and obituaries that happen to use "wants"/"move" aren't transfer stories.
  const notTransfer = a.titleConcepts.has("award") || a.titleConcepts.has("death");
  const transferHeadline = !notTransfer && (a.titleConcepts.has("transfer") || a.titleConcepts.has("contract"));
  // A transfer/window/£ headline is a transfer story even if its summary mentions a result.
  if (a.concepts.has("match") && !a.titleConcepts.has("death") && !(transferHeadline && !a.titleConcepts.has("match")))
    cats.add("match");
  if (!notTransfer && (a.titleConcepts.has("transfer") || a.titleConcepts.has("contract"))) cats.add("transfer");
  if (a.concepts.has("injury")) cats.add("injury");
  if (/\bchampions league\b|\bucl\b/.test(text)) cats.add("ucl");
  if (/\bpremier league\b/.test(text)) cats.add("pl");
  if (a.tier === "opinion" || ANALYSIS_RE.test(title)) cats.add("analysis");
  if (
    a.concepts.has("death") ||
    a.concepts.has("award") ||
    a.concepts.has("finance") ||
    /\b(women|wsl|academy|legend|history|anniversary|stadium|kit)\b/.test(title)
  )
    cats.add("club");

  // Primary label for the card: the most specific / useful one.
  const order = ["official", "injury", "transfer", "match", "analysis", "ucl", "pl", "club"];
  let primary = a.titleConcepts.has("death") ? "club" : (order.find((c) => cats.has(c)) ?? "club");
  // Analysis pieces that merely mention transfers read as analysis, not transfer news.
  if (cats.has("analysis") && ANALYSIS_RE.test(title) && primary !== "official") primary = "analysis";
  if (primary === "transfer" && a.titleConcepts.has("contract") && !RENEWAL_EXIT.test(title)) primary = "contract";
  if (!cats.size) cats.add("club");
  return { cats, primary };
}

/* ───────────────────────── Credibility ───────────────────────── */

function journalistOf(a) {
  const author = a.author ?? "";
  const byAuthor = JOURNALISTS.find((j) => j.re.test(author));
  if (byAuthor) return { journalist: byAuthor.name, how: "author" };
  // "David Ornstein's The Athletic FC Q&A" — the piece is theirs.
  const ownPiece = JOURNALISTS.find((j) => new RegExp(`^${j.name}['’]s\\b`, "i").test(a.title));
  if (ownPiece && (!ownPiece.outlet || ownPiece.outlet === a.source))
    return { journalist: ownPiece.name, how: "byline" };
  return null;
}

/** Outlets / reporters this article cites (i.e. it is passing on someone else's report). */
function citesOf(a) {
  const text = `${a.title} ${a.excerpt}`;
  return CITABLE.filter((c) => c.name !== a.source && c.re.test(text) && !(a.journalist === c.name)).map((c) => c.name);
}

/** Clean author strings: "x@trinitymirror.com (Tom Canton)" → "Tom Canton"; "Ed Aarons at the stadium" → "Ed Aarons". */
export function cleanAuthor(raw = "") {
  let s = String(raw).trim();
  const paren = s.match(/\(([^)]+)\)/);
  if (paren && /@/.test(s)) s = paren[1];
  s = s
    .replace(/\s+(at|in)\s+(the\s+)?[A-Z].*$/, "")
    .replace(/^by\s+/i, "")
    .trim();
  if (/@|^https?:/i.test(s) || s.length > 60) return "";
  if (/^(guardian sport|bbc sport|sky sports|press association|pa media|reuters|agencies)$/i.test(s)) return "";
  return s;
}

/* ───────────────────────── Summaries ───────────────────────── */

const BOILERPLATE = [
  /the post .* appeared first on .*$/i,
  /continue reading\.*$/i,
  /submitted by .*$/i,
  /\[link\]|\[comments\]/gi,
  /read more\.*$/i,
];

/** Short, clean summary from feed descriptions only — never scraped article bodies. */
export function summarize(text = "", title = "", max = 220) {
  let s = text;
  for (const re of BOILERPLATE) s = s.replace(re, "");
  s = s.replace(/\s+/g, " ").trim();
  if (!s || fold(s).startsWith(fold(title).slice(0, 40))) {
    // Description just repeats the headline.
    if (fold(s).replace(/\W/g, "") === fold(title).replace(/\W/g, "")) return "";
  }
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}

/* ───────────────────────── Enrichment ───────────────────────── */

/**
 * News item (from parseNewsFile) → article with credibility, categories and matching features.
 * Item shape: { id, title, link, date: Date | null, image, excerpt, author, outlet, source?, tier?,
 *   clubs: string[], also: { outlet, link }[] }
 */
export function enrichArticle(raw, ctx = {}) {
  const a = { ...raw };
  a.clubs = arr(a.clubs).filter((c) => typeof c === "string");
  a.also = arr(a.also).filter(isObj);
  a.source = a.source || OUTLETS[a.outlet]?.name || a.outlet || "Unknown";
  a.author = cleanAuthor(a.author);
  a.tier = a.tier || OUTLETS[a.outlet]?.tier || "secondary";
  const j = journalistOf(a);
  if (j) {
    a.journalist = j.journalist;
    if (a.tier === "reliable") a.tier = "journalist";
  }
  a.cites = citesOf(a);
  a.summary = summarize(a.excerpt, a.title);
  a.concepts = conceptsOf(`${a.title} ${a.summary}`);
  a.titleConcepts = conceptsOf(a.title);
  a.tokens = new Set(contentTokens(a.title).filter((t) => !GENERIC.has(t)));
  a.entities = headlineEntities(a.title);
  // Map surnames / full names of known squad players to a stable key
  a.players = new Set();
  const t = fold(a.title);
  for (const p of ctx.players ?? []) {
    if ((p.fullKey && t.includes(p.fullKey)) || (p.lastKey && new RegExp(`\\b${p.lastKey}\\b`).test(t)))
      a.players.add(p.id);
  }
  a.canonical = canonicalUrl(a.link);
  const { cats, primary } = categorize(a);
  a.categories = cats;
  a.primary = primary;
  return a;
}

export function canonicalUrl(url = "") {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return url;
  }
}

/* ───────────────────────── Duplicate detection ───────────────────────── */

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};
const intersects = (a, b) => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};
const sharedCount = (a, b) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
};

const HOUR = 3600e3;

/**
 * Are two articles about the same underlying story?
 * Never merges on a shared name alone — needs a shared event type too, and the
 * two must be published close together.
 */
export function sameStory(a, b) {
  if (a.canonical && a.canonical === b.canonical) return true;
  const gap = Math.abs((a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  if (gap > 72 * HOUR) return false;

  // If both name different squad players, they're different stories, however alike the
  // headlines read ("Saka injury worry" vs "Odegaard injury worry" share most tokens).
  // Stories tagged with entirely different clubs are different stories ("<club A> training update" vs
  // "<club B> training update"), however alike the headlines read.
  if (a.clubs?.length && b.clubs?.length && !a.clubs.some((c) => b.clubs.includes(c))) return false;

  const samePlayer = intersects(a.players, b.players);
  if (a.players.size && b.players.size && !samePlayer) return false;

  const titleSim = jaccard(a.tokens, b.tokens);
  if (titleSim >= 0.5) return true;

  // Same subject: a known squad player, or a shared capitalised name.
  const sharedNames = sharedCount(a.entities, b.entities);
  if (!samePlayer && sharedNames === 0) return false;

  // Same kind of event, judged on the headlines.
  const sharedConcepts = [...a.titleConcepts].filter((c) => b.titleConcepts.has(c));
  if (!sharedConcepts.length) return false;
  // "transfer" is broad; when it's the only overlap, ask for more evidence.
  if (sharedConcepts.length === 1 && sharedConcepts[0] === "transfer") {
    return gap <= 48 * HOUR && (titleSim >= 0.2 || sharedNames >= 2);
  }
  return gap <= 48 * HOUR || titleSim >= 0.3;
}

/** Greedy single-link clustering, newest first. */
export function clusterArticles(articles) {
  const sorted = [...articles].sort((x, y) => (y.date ?? 0) - (x.date ?? 0));
  const clusters = [];
  for (const a of sorted) {
    const home = clusters.find((c) => c.some((m) => sameStory(a, m)));
    if (home) home.push(a);
    else clusters.push([a]);
  }
  return clusters;
}

/* ───────────────────────── Stories ───────────────────────── */

const tierRank = (t) => TIERS[t]?.rank ?? 0;

/** Rough width hint from an image URL, used to prefer sharper images for large slots. */
export function imageWidthHint(url = "") {
  const m =
    url.match(/[?&](?:width|w)=(\d+)/) ||
    url.match(/\/(\d{3,4})x\d{3,4}\//) ||
    url.match(/\/(?:standard|news)\/(\d{3,4})\//);
  return m ? Number(m[1]) : 1000;
}

const outletName = (id) => OUTLETS[id]?.name ?? id;
/** An article's own outlet plus the near-identical copies the pipeline folded into it. */
const outletsOf = (a) => [a.source, ...a.also.map((x) => outletName(x.outlet))];

/** Turn a cluster of articles into a story the UI can render. */
export function toStory(articles, now = Date.now()) {
  // Lead article: most credible outlet, straight news over analysis, has an image, most recent.
  const isNews = (a) => (a.primary === "analysis" ? 0 : 1);
  const imgScore = (a) => (!a.image ? 0 : imageWidthHint(a.image) < 400 ? 1 : 2);
  const ranked = [...articles].sort(
    (x, y) =>
      tierRank(y.tier) - tierRank(x.tier) ||
      isNews(y) - isNews(x) ||
      imgScore(y) - imgScore(x) ||
      (y.date ?? 0) - (x.date ?? 0),
  );
  const lead = ranked[0];
  const outlets = [...new Set(articles.flatMap(outletsOf))];
  // Independent outlets: those not merely citing another outlet in this story.
  const cited = new Set(articles.flatMap((a) => a.cites));
  const independent = [
    ...new Set(
      articles.filter((a) => !a.cites.some((c) => outlets.includes(c) || c === a.journalist)).flatMap(outletsOf),
    ),
  ];
  const dates = articles.map((a) => a.date?.getTime()).filter(Boolean);
  const latest = dates.length ? new Date(Math.max(...dates)) : null;
  const first = dates.length ? new Date(Math.min(...dates)) : null;
  const categories = new Set(articles.flatMap((a) => [...a.categories]));
  const best = ranked.find((a) => a.summary) ?? lead;
  // Use the lead article's own image. Only if it has none, borrow the sharpest
  // one from another outlet in the cluster, and credit that outlet.
  const donor = lead.image
    ? lead
    : [...articles].filter((a) => a.image).sort((x, y) => imageWidthHint(y.image) - imageWidthHint(x.image))[0];
  const image = donor?.image ?? null;
  const imageCredit = donor && donor.source !== lead.source ? donor.source : null;
  const story = {
    id: lead.canonical || lead.id,
    lead,
    articles: ranked,
    outlets,
    independent,
    cited: [...cited],
    date: latest,
    firstDate: first,
    categories,
    primary: lead.primary,
    tier: lead.tier,
    summary: best.summary,
    image,
    imageCredit,
    clubs: [...new Set(articles.flatMap((a) => a.clubs))],
  };
  story.score = relevance(story, now);
  return story;
}

/** Category weights for "most relevant": what a fan most needs first. */
const CATEGORY_WEIGHT = {
  official: 1.6,
  injury: 1.3,
  match: 1.25,
  transfer: 1.2,
  contract: 1.2,
  club: 1.0,
  ucl: 0.9,
  pl: 0.85,
  analysis: 0.8,
};

/** Ranking score. With `clubSlug`, stories that name that club rank above ones that don't. */
export function relevance(story, now = Date.now(), clubSlug = null) {
  const ageH = story.date ? Math.max(0, (now - story.date.getTime()) / HOUR) : 999;
  const tier = TIERS[story.tier]?.weight ?? 1;
  const coverage = 1 + 0.6 * Math.min(story.independent.length - 1, 4);
  const cat = CATEGORY_WEIGHT[story.primary] ?? 1;
  const clubScope = !clubSlug || story.clubs.includes(clubSlug) ? 1 : 0.6;
  const recency = 1 / (1 + ageH / 10); // halves at ~10h
  return tier * coverage * cat * clubScope * recency * (story.image ? 1.1 : 1);
}

/**
 * News items → stories. `story.score` is league-wide; use relevance(story, now, slug) for one club.
 * ctx: { players: [{id, fullKey, lastKey}], now }
 */
export function buildStories(rawItems, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const seen = new Set();
  const articles = [];
  for (const raw of rawItems) {
    if (!raw?.title || !raw?.link) continue;
    const a = enrichArticle(raw, ctx);
    if (seen.has(a.canonical)) continue;
    seen.add(a.canonical);
    articles.push(a);
  }
  return clusterArticles(articles).map((c) => toStory(c, now));
}

export const SORTS = {
  recent: { label: "Most recent", fn: (a, b) => (b.date ?? 0) - (a.date ?? 0) },
  relevant: { label: "Most relevant", fn: (a, b) => b.score - a.score },
  covered: {
    label: "Most covered",
    fn: (a, b) =>
      b.independent.length - a.independent.length ||
      b.outlets.length - a.outlets.length ||
      (b.date ?? 0) - (a.date ?? 0),
  },
};

/** Stories about a club (by slug). */
export const forClub = (stories, clubSlug) => stories.filter((s) => s.clubs.includes(clubSlug));

/**
 * Stories matching a category filter, optionally limited to one club ("all" = everything, or
 * everything about that club).
 */
export function inCategory(story, cat, clubSlug = null) {
  if (clubSlug && !story.clubs.includes(clubSlug)) return false;
  if (cat === "all") return true;
  return story.categories.has(cat);
}

/**
 * The top story: the most relevant one from the last 36h (for a club when `clubSlug` is given), from
 * a reliable-or-better outlet where possible. Fan opinion never leads.
 */
export function pickFeatured(stories, now = Date.now(), clubSlug = null) {
  const scoped = clubSlug ? forClub(stories, clubSlug) : stories;
  const fresh = scoped.filter((s) => s.tier !== "opinion" && s.date && now - s.date.getTime() < 36 * HOUR);
  const pool = fresh.length ? fresh : scoped.filter((s) => s.tier !== "opinion");
  const score = (s) => relevance(s, now, clubSlug);
  return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** How fresh is a story? Used to visibly mark stale items. */
export function freshness(date, now = Date.now()) {
  if (!date) return "unknown";
  const h = (now - date.getTime()) / HOUR;
  if (h < 6) return "new";
  if (h < 48) return "recent";
  if (h < 24 * 7) return "older";
  return "stale";
}

/** Squad list → keys used for name matching. Ambiguous surnames are skipped. */
export function playerKeys(players = []) {
  const lastCounts = {};
  const keyOf = (p) =>
    fold(p.lastName || "")
      .replace(/[^a-z\s-]/g, "")
      .trim();
  for (const p of players) {
    const k = keyOf(p);
    lastCounts[k] = (lastCounts[k] ?? 0) + 1;
  }
  return players.map((p) => {
    const last = keyOf(p);
    const full = fold(p.name)
      .replace(/[^a-z\s-]/g, "")
      .trim();
    return {
      id: p.id,
      name: p.name,
      fullKey: full.includes(" ") ? full : null,
      lastKey: last.length >= 4 && lastCounts[last] === 1 && !GENERIC.has(last) && !STOP.has(last) ? last : null,
      player: p,
    };
  });
}

/**
 * The briefing: the `n` most important developments from the last ~two days (for a club when
 * `clubSlug` is given). Ranked by relevance, at most two per topic so one saga can't fill the list;
 * fan opinion and analysis are excluded.
 */
export function pickBriefing(stories, now = Date.now(), n = 5, clubSlug = null) {
  const scoped = (clubSlug ? forClub(stories, clubSlug) : stories).filter(
    (s) => s.tier !== "opinion" && s.primary !== "analysis" && s.date,
  );
  const fresh = scoped.filter((s) => now - s.date.getTime() < 48 * HOUR);
  const score = (s) => relevance(s, now, clubSlug);
  const pool = (fresh.length >= n ? fresh : scoped.filter((s) => now - s.date.getTime() < 7 * 24 * HOUR)).sort(
    (a, b) => score(b) - score(a),
  );
  const perTopic = {};
  const out = [];
  for (const s of pool) {
    const topic = s.primary === "contract" ? "transfer" : s.primary;
    if ((perTopic[topic] ?? 0) >= 2) continue;
    perTopic[topic] = (perTopic[topic] ?? 0) + 1;
    out.push(s);
    if (out.length === n) break;
  }
  return out;
}

export const storyMentions = (story, playerId) => story.articles.some((a) => a.players?.has(playerId));

/** Searchable text for a story, including its topic and competition labels. */
export function storyHaystack(story) {
  const labels = [...story.categories].map((c) => CATEGORY_LABEL[c] ?? c).join(" ");
  return `${story.articles.map((a) => `${a.title} ${a.summary} ${a.source}`).join(" ")} ${labels}`.toLowerCase();
}

/* ───────────────────────── data/news.json ───────────────────────── */

/**
 * Validates the pipeline's news.json and turns it into items for buildStories. Throws a FetchError
 * ("data") if the overall shape is wrong; skips (and counts) items without a title or link. Dates
 * become Date objects (null when missing or invalid). Tier and outlet name come from the file's own
 * `outlets` table, falling back to config/clubs.js.
 * @param {unknown} json
 */
export function parseNewsFile(json) {
  const file = /** @type {any} */ (expectObject(json, "news file"));
  const list = expectArray(file.items, "news items");
  const outlets = isObj(file.outlets) ? file.outlets : {};
  let dropped = 0;
  const items = [];
  for (const i of list) {
    if (!isObj(i) || !str(i.title) || !str(i.link)) {
      dropped++;
      continue;
    }
    const outlet = str(i.outlet) ?? "unknown";
    items.push({
      id: str(i.id) ?? i.link,
      title: i.title,
      link: i.link,
      date: date(i.date),
      image: str(i.image),
      excerpt: str(i.excerpt) ?? "",
      author: str(i.author) ?? "",
      outlet,
      source: str(outlets[outlet]?.name) ?? OUTLETS[outlet]?.name ?? outlet,
      tier: str(outlets[outlet]?.tier) ?? OUTLETS[outlet]?.tier ?? "secondary",
      clubs: arr(i.clubs).filter((c) => typeof c === "string"),
      players: arr(i.players).filter((p) => typeof p === "string"),
      also: arr(i.also).filter((x) => isObj(x) && str(x.outlet) && str(x.link)),
    });
  }
  if (dropped) noteDropped("news", dropped);
  return { generatedAt: date(file.generatedAt), items };
}
