// @ts-check
/**
 * Simplified league-wide transfer feed: transfer and contract stories, each marked "confirmed" or
 * "reported", with the outlet and its tier.
 *
 * No outlet in the pipeline is an official club source, so "confirmed" means a reliable outlet's
 * headline uses completion wording ("signs", "completes", "joins", "confirmed") with no hedge.
 * Any hedge wins over completion wording: "set to join", "close to signing", "in talks",
 * "verbally agrees", a question mark. "Signing" as a noun ("…to Scott signing") is not completion
 * wording. An agreement reported before an announcement ("agrees new contract") stays "reported".
 * Contract renewals are included and labelled "Contract", since they decide who stays.
 */
import { fold } from "./news.js";

const HEDGE =
  /\b(close to|closing in|set to|poised|nears?|nearing|edg(e|es|ing) (closer|towards)|in talks|talks|eyes?|eyeing|interest\w*|linked|links?|could|would|might|may|bid|bids|offer|offers|target\w*|wants?|keen|consider\w*|race|chase|pursu\w*|monitor\w*|verbally|expected|likely|plans?|planning|weigh\w*|rejects?|rebuff\w*|rumou?r\w*|reportedly|reports?|willing|ready to|open to|tipped|should|vote|live)\b|\?/;
const DONE =
  /\b(signs|signed|completes?|completed|joins|joined|seals?|sealed|confirms?|confirmed|officially|unveil\w*|announces?|announced|pens|re-signs?|extends? (his |their )?(contract|deal|stay)|departs?|released)\b/;

// The news categoriser's "transfer" concept is broad (it catches "move up to second", "offer" and any
// £ figure), so the feed also needs a player-move word in the headline, and either a tagged player or
// a word that only a transfer story uses. Manager appointments and sackings, club finances, fan pieces,
// newsletters, live blogs and fan votes are left out.
const MOVE_WORDS =
  /\b(sign(s|ed|ing)?|transfers?|bid|(?<!le )fee|loan\w*|swap|target(s|ed|ing)?|joins?|joined|deal|contract|renew\w*|extension|exit|departure|depart\w*|talks|linked|interest|wants?|monitor\w*|pursu\w*|move (to|for)|(summer|january|loan|permanent|transfer|dream|shock) move)\b|[£€]\s?\d/;
const TRANSFER_ONLY =
  /\b(transfers?|window|january|exit|departure|leaves|bid|(?<!le )fee|loan\w*|monitor\w*|target(s|ed|ing)?|linked with|interest in|move for|swap)\b|[£€]\s?\d/;
const NOT_A_TRANSFER =
  /\b(financial results|revenue|accounts|sack(s|ed|ing)?|appoint\w*|head coach|manager|boss|job|board|legal|fans?|library|ratings|football daily|newsletter|podcast|quiz|vote|transfer centre|live blog)\b|\blive!/;

/** @typedef {"confirmed" | "reported"} TransferStatus */

/**
 * Is this headline confirmed or reported?
 * @param {string} title
 * @returns {TransferStatus}
 */
export function transferStatus(title) {
  const t = fold(title);
  return DONE.test(t) && !HEDGE.test(t) ? "confirmed" : "reported";
}

/**
 * Is this story about a player moving or staying (a transfer or contract story)?
 * @param {any} s  a story from buildStories
 */
export function isTransferStory(s) {
  if (!s.categories?.has("transfer") || s.primary === "analysis" || s.tier === "opinion" || !s.clubs.length)
    return false;
  const t = fold(s.lead.title);
  if (!MOVE_WORDS.test(t) || NOT_A_TRANSFER.test(t)) return false;
  return s.articles.some((a) => a.players?.size) || TRANSFER_ONLY.test(t);
}

/**
 * Transfer and contract stories about Premier League clubs, newest first, with status.
 * @param {any[]} stories  from buildStories
 * @param {{ limit?: number, club?: string | null }} [opts]
 */
export function transferFeed(stories, { limit = 10, club = null } = {}) {
  return stories
    .filter((s) => isTransferStory(s) && (!club || s.clubs.includes(club)))
    .map((s) => ({
      story: s,
      status: transferStatus(s.lead.title),
      kind: s.primary === "contract" ? "Contract" : "Transfer",
    }))
    .sort((a, b) => (b.story.date ?? 0) - (a.story.date ?? 0))
    .slice(0, limit);
}
