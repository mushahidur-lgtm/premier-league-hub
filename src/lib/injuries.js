// @ts-check
/**
 * Injury cross-check (rule 3): what recent headlines say about a squad's fitness, so the squad list
 * never shows an "all clear" that the news contradicts.
 *
 * A report needs all of:
 *   - the article is tagged with the player (the pipeline's player tags, scripts/lib/players.mjs),
 *   - the player is named in the headline, and the headline's injury wording is about them,
 *   - a reliable-or-better outlet, published in the last REPORT_WINDOW_DAYS.
 * The latest report per player wins, so "X returns to training" replaces an older "X injured".
 *
 * Wording is stricter than the news categoriser's "injury" concept: "injury-time", "no doubt",
 * "absence" and "knocked out" are not injury news, and a story about a past injury ("last season")
 * is ignored.
 */
import { fold } from "./news.js";
import { TIERS } from "./sources.js";

export const REPORT_WINDOW_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/** @typedef {"injured" | "doubt" | "back"} ReportKind */
export const REPORT_LABEL = /** @type {Record<ReportKind, string>} */ ({
  injured: "Reported injured",
  doubt: "Reported doubt",
  back: "Reported back from injury",
});

// Each pattern matches folded (lowercase, accent-free) headline text. Order matters: a fresh injury
// event first, so "limps off on return from injury" is an injury; then "back", so "returns from
// injury" or "on return from broken jaw" is a return; then injury nouns; then doubts.
const FRESH =
  /\b(limp(s|ed)? off|stretchered|setback|re-?injur\w*|ruled out|suffer(s|ed)? (a |an )?(\w+ )?(injury|knock|blow)|picks? up (a |an )?(\w+ )?(injury|knock)|out for (the )?(season|weeks|months)|injured again)\b/;
const BACK =
  /\b(returns? to (full )?training|back in (full )?training|back from injury|returns? from (a |his |an )?(\w+ )?(injury|knee|hamstring|ankle|thigh|calf|groin|broken|fracture)|on (his )?return from|fully fit|fit again|fit to (face|play|start)|recover(ed|s) from|injury boost|boost as \w+ returns?)\b/;
const INJURED =
  /\b(injur(y|ed|ies)(?![- ]time)|ruled out|sidelined|surgery|operation|hamstring|knee|ankle|groin|calf|thigh|achilles|acl|broken|fractur\w*|torn|tear|rupture\w*|concussion|stretchered|limp(s|ed)? off|out for (the )?(season|weeks|months)|blow as)\b/;
const DOUBT =
  /\b((?<!no )doubt(ful)?|fitness (call|test|concern|worry|race|battle|doubt)|race to be fit|miss(es)? training|knock|scan|precaution\w*)\b/;
// A story about a past injury. Not "career": "career-threatening" is the most serious news there is.
const PAST = /\b(last season|last year|recalls?|years ago)\b/;

/**
 * Words of a folded headline with their positions, keeping "," and "&" as their own tokens so
 * lists of names ("Brobbey and Xhaka", "Rice, Saka") can be followed.
 * @param {string} t
 */
const tokenize = (t) =>
  [...t.matchAll(/[a-z0-9]+(?:['-][a-z0-9]+)*|[,&]/g)].map((m) => ({ w: m[0], at: m.index ?? 0 }));

/** Token index of the token that starts at or contains `at`. @param {{ w: string, at: number }[]} tokens @param {number} at */
const tokenAt = (tokens, at) => {
  let i = 0;
  while (i + 1 < tokens.length && tokens[i + 1].at <= at) i++;
  return i;
};

/**
 * Where each player is named in a folded headline, as token indexes. Full name first, then surname.
 * @param {string} t folded headline
 * @param {{ id: string, name: string, lastName?: string | null }[]} players
 */
function namePositions(t, players) {
  const tokens = tokenize(t);
  /** @type {Map<string, number[]>} */
  const found = new Map();
  for (const p of players) {
    const keys = [p.name, p.lastName].flatMap((n) => (n ? [fold(n).replace(/[‘’]/g, "'")] : []));
    for (const k of keys) {
      const re = new RegExp(`(?<![a-z0-9'-])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9-])`, "g");
      const at = [...t.matchAll(re)].map((m) => tokenAt(tokens, m.index ?? 0));
      if (at.length) {
        found.set(p.id, at);
        break;
      }
    }
  }
  return { tokens, found };
}

/**
 * Which of the named players a match of `re` is about. One named player: that player. Several: the
 * one nearest to the wording (within four words), plus anyone listed with them ("X and Y miss
 * training").
 * @param {RegExp} re @param {string} t
 * @param {{ tokens: { w: string, at: number }[], found: Map<string, number[]> }} names
 * @returns {string[]}
 */
function attribute(re, t, names) {
  const m = re.exec(t);
  if (!m) return [];
  const ids = [...names.found.keys()];
  if (ids.length === 1) return ids;
  const term = tokenAt(names.tokens, m.index);
  let best = null;
  let bestDist = Infinity;
  for (const [id, at] of names.found)
    for (const i of at) {
      const d = Math.abs(i - term);
      if (d < bestDist) [best, bestDist] = [id, d];
    }
  if (best === null || bestDist > 4) return [];
  // Names joined to the nearest one by "and", "&" or "," share the wording.
  const out = new Set([best]);
  const bestAt = /** @type {number[]} */ (names.found.get(best));
  for (const [id, at] of names.found) {
    if (out.has(id)) continue;
    for (const i of at)
      for (const j of bestAt) {
        const [lo, hi] = i < j ? [i, j] : [j, i];
        const between = names.tokens.slice(lo + 1, hi).map((x) => x.w);
        if (between.length === 1 && ["and", "&", ","].includes(between[0])) out.add(id);
      }
  }
  return [...out];
}

/**
 * What a headline says about the named players' fitness, if anything.
 * @param {string} title
 * @param {{ id: string, name: string, lastName?: string | null }[]} players  the players this article is tagged with
 * @returns {Map<string, ReportKind>}
 */
export function readHeadline(title, players) {
  const t = fold(title).replace(/[‘’]/g, "'");
  /** @type {Map<string, ReportKind>} */
  const out = new Map();
  if (!players.length || PAST.test(t)) return out;
  const names = namePositions(t, players);
  if (!names.found.size) return out;
  for (const [kind, re] of /** @type {[ReportKind, RegExp][]} */ ([
    ["injured", FRESH],
    ["back", BACK],
    ["injured", INJURED],
    ["doubt", DOUBT],
  ]))
    for (const id of attribute(re, t, names)) if (!out.has(id)) out.set(id, kind);
  return out;
}

/**
 * @typedef {{ kind: ReportKind, label: string, source: string, date: Date, link: string, title: string }} InjuryReport
 */

/**
 * The latest fitness report per player, from the stories' articles.
 * @param {any[]} stories  from buildStories
 * @param {{ id: string, name: string, lastName?: string | null }[]} players  one squad
 * @param {number} [now]
 * @returns {Map<string, InjuryReport>}
 */
export function injuryReports(stories, players, now = Date.now()) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const minRank = TIERS.reliable.rank;
  /** @type {Map<string, InjuryReport>} */
  const out = new Map();
  for (const s of stories)
    for (const a of s.articles ?? []) {
      if (!a.players?.size || !a.date || (TIERS[a.tier]?.rank ?? 0) < minRank) continue;
      const age = now - a.date.getTime();
      if (age < -DAY || age > REPORT_WINDOW_DAYS * DAY) continue;
      const tagged = [...a.players].map((id) => byId.get(id)).filter((p) => p !== undefined);
      for (const [id, kind] of readHeadline(a.title, tagged)) {
        const prev = out.get(id);
        if (prev && prev.date >= a.date) continue;
        out.set(id, { kind, label: REPORT_LABEL[kind], source: a.source, date: a.date, link: a.link, title: a.title });
      }
    }
  return out;
}

/** A report that means "not fully fit" (injured or doubt), as opposed to a return. @param {InjuryReport | undefined} r */
export const isAbsenceReport = (r) => r?.kind === "injured" || r?.kind === "doubt";

/**
 * One player's latest report, read with his whole squad as candidates, so injury wording still goes to the
 * nearest named player ("Saka replaces injured Martinelli" is about Martinelli, not Saka). Never call
 * injuryReports with a one-player list for this.
 * @param {any[]} stories
 * @param {{ id: string, name: string, lastName?: string | null }[]} squad the player's whole squad
 * @param {string} playerId
 * @param {number} [now]
 * @returns {InjuryReport | null}
 */
export function reportFor(stories, squad, playerId, now = Date.now()) {
  return injuryReports(stories, squad, now).get(playerId) ?? null;
}
