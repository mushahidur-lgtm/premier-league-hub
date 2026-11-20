// @ts-check
/**
 * Player tagging for the pipeline: which squad players a story names.
 *
 * Collision rules (a wrong tag is worse than a missing one, because tags drive the injury notes):
 *   - A full name ("Declan Rice") tags its player anywhere, unless two squads share that full name;
 *     then it needs club context like a surname does.
 *   - A surname ("Rice"), or a one-word name, tags a player only when the story is already tagged
 *     with that player's club, the surname is unique in that squad, and no player of another club the
 *     story is tagged with has the same surname. A story with no club tags gets no surname tags.
 *   - Matching folds accents but keeps case, so "Rice" never matches "rice". Word edges exclude
 *     letters, digits, apostrophes before the name and hyphens on both sides ("Gibbs-White" is not
 *     White, "O'Neill" is not Neill), while possessives ("Raya's") still match.
 *   - Full names are matched first and blanked out, so "Reece James" never also tags a "James"
 *     surname at another club.
 */

/** @typedef {{ id: string, name: string, lastName: string | null, club: string }} SquadPlayer */
/** @typedef {{ slug: string, name: string, shortName: string, aliases: string[] }} NamedClub */

const SPECIAL = /** @type {Record<string, string>} */ ({
  ø: "o",
  Ø: "O",
  æ: "ae",
  Æ: "Ae",
  ß: "ss",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  œ: "oe",
  Œ: "Oe",
  ı: "i",
});

/** Accent-folded, case kept, curly apostrophes straightened. @param {string} s */
export const foldCase = (s) =>
  String(s)
    .replace(/[øØæÆßłŁđĐœŒı]/g, (c) => SPECIAL[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ]/g, "'");

const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name as a whole word. A lowercase particle ("van Dijk") also matches capitalised ("Van Dijk"). */
const wordRe = (/** @type {string} */ name) => {
  const first = name[0];
  const head = first !== first.toUpperCase() ? `[${first}${first.toUpperCase()}]` : escapeRe(first);
  return new RegExp(`(?<![\\p{L}\\p{N}'-])${head}${escapeRe(name.slice(1))}(?![\\p{L}\\p{N}-])`, "gu");
};

const CAP_WORD = /^\p{Lu}[\p{L}'.-]*$/u;
const SENTENCE_START = /(^|[\n.:!?;"(–—-]|\s[-–—]|['‘“])\s*$/u;

/**
 * Is the surname at `index` part of someone else's two-word name ("Lewis Jones", "Old Trafford",
 * "James Savundra")? True when a capitalised word sits right next to it, unless that word is a
 * possessive ("City's Guehi", "Trafford England's"), a club word, all capitals ("NI", "VAR"), or
 * (before it) the first word of a sentence, where the capital is just sentence case.
 * @param {string} text @param {number} index @param {number} length @param {Set<string>} clubWords
 */
function partOfOtherName(text, index, length, clubWords) {
  const ok = (/** @type {string} */ w) => /'s$/.test(w) || clubWords.has(w) || w === w.toUpperCase();
  const bare = (/** @type {string} */ w) => w.replace(/[,;:!?)"']+$/, "");
  const after = /^ (\S+)/u.exec(text.slice(index + length));
  if (after && CAP_WORD.test(bare(after[1])) && !ok(bare(after[1]))) return true;
  const before = /(\S+) $/u.exec(text.slice(0, index));
  if (before && CAP_WORD.test(before[1]) && !ok(before[1])) {
    const preceding = text.slice(0, index - before[0].length);
    if (!SENTENCE_START.test(preceding)) return true;
  }
  return false;
}

/** Words that are never a usable surname on their own. */
const NOT_A_SURNAME = new Set(
  "Man City United Premier League Cup England Football Club Sport Sports Saint St".split(" "),
);

/**
 * Reads the players from one ESPN roster response. Keeps only what tagging needs; unreadable
 * athletes are skipped.
 * @param {any} json
 * @param {string} club  club slug
 * @returns {SquadPlayer[]}
 */
export function rosterPlayers(json, club) {
  const athletes = Array.isArray(json?.athletes) ? json.athletes : [];
  return athletes
    .filter((a) => a && a.id != null && typeof a.displayName === "string" && a.displayName.trim())
    .map((a) => ({
      id: String(a.id),
      name: a.displayName.trim(),
      lastName: typeof a.lastName === "string" && a.lastName.trim() ? a.lastName.trim() : null,
      club,
    }));
}

/**
 * Builds a tagger over every squad.
 * @param {SquadPlayer[]} players  all clubs' players together
 * @param {NamedClub[]} clubs      for the words a surname must not be (club names and aliases)
 * @returns {(item: { title: string, excerpt?: string, clubs: string[] }) => string[]}
 */
export function makePlayerTagger(players, clubs) {
  const clubWords = new Set(
    clubs.flatMap((c) => [c.name, c.shortName, ...c.aliases]).flatMap((n) => foldCase(n).split(/[^\p{L}\p{N}]+/u)),
  );
  for (const w of NOT_A_SURNAME) clubWords.add(w);

  // Full names, and how many squads use each.
  const fullCount = new Map();
  const entries = players.map((p) => {
    const full = foldCase(p.name);
    const multi = /\s/.test(full);
    // One-word names ("Rodri") behave like surnames: they need club context.
    const surname = multi ? (p.lastName ? foldCase(p.lastName) : (full.split(/\s+/).pop() ?? full)) : full;
    if (multi) fullCount.set(full, (fullCount.get(full) ?? 0) + 1);
    return { ...p, full: multi ? full : null, surname };
  });

  // Surnames per club, to find ones that are ambiguous inside a squad.
  /** @type {Map<string, Map<string, number>>} */
  const perClub = new Map();
  for (const e of entries) {
    const m = perClub.get(e.club) ?? new Map();
    m.set(e.surname, (m.get(e.surname) ?? 0) + 1);
    perClub.set(e.club, m);
  }

  const rules = entries.map((e) => {
    // A multi-word surname ("Lewis-Skelly", "van Dijk") is still a surname: it needs club context.
    const usable = e.surname.length >= 3 && perClub.get(e.club)?.get(e.surname) === 1 && !clubWords.has(e.surname);
    return {
      id: e.id,
      club: e.club,
      surname: e.surname,
      fullRe: e.full ? wordRe(e.full) : null,
      fullNeedsContext: e.full ? (fullCount.get(e.full) ?? 0) > 1 : false,
      surnameRe: usable ? wordRe(e.surname) : null,
    };
  });

  return (item) => {
    const clubsOf = new Set(item.clubs ?? []);
    let text = foldCase(`${item.title}\n${item.excerpt ?? ""}`);
    /** @type {Set<string>} */
    const found = new Set();

    // 1. Full names; blank each match so its words can't be read as someone else's surname.
    for (const r of rules) {
      if (!r.fullRe) continue;
      if (r.fullNeedsContext && !clubsOf.has(r.club)) continue;
      r.fullRe.lastIndex = 0;
      if (r.fullRe.test(text)) {
        found.add(r.id);
        text = text.replace(r.fullRe, (m) => " ".repeat(m.length));
      }
    }

    // 2. Surnames, only for the story's own clubs, and only if no other tagged club shares them.
    const inContext = rules.filter((r) => r.surnameRe && clubsOf.has(r.club));
    const clubsBySurname = new Map();
    for (const r of rules)
      if (clubsOf.has(r.club)) clubsBySurname.set(r.surname, (clubsBySurname.get(r.surname) ?? 0) + 1);
    for (const r of inContext) {
      if (found.has(r.id) || clubsBySurname.get(r.surname) > 1) continue;
      const re = /** @type {RegExp} */ (r.surnameRe);
      for (const m of text.matchAll(re)) {
        if (!partOfOtherName(text, m.index ?? 0, m[0].length, clubWords)) {
          found.add(r.id);
          break;
        }
      }
    }
    return [...found];
  };
}
