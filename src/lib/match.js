// @ts-check
/**
 * Match centre logic over a parsed ESPN summary (src/lib/parsers.js parseSummary) and this site's news.
 * Pure functions.
 */

/**
 * @typedef {{ id?: string, kind: string, minute: string, teamId: string, primary: string | null,
 *   secondary: string | null }} KeyEvent
 * @typedef {{ id: string | null, date: Date | null, competition: string | null,
 *   home: { id: string, name: string | null, abbr: string | null, score: number, winner: boolean },
 *   away: { id: string, name: string | null, abbr: string | null, score: number, winner: boolean } }} Meeting
 */

const GOAL_KINDS = new Set(["goal", "penalty", "own-goal"]);

/**
 * Goals, cards and substitutions per side. ESPN credits an own goal to the side it counts for, so goals
 * group by the event's team as they are.
 * @param {KeyEvent[]} events
 * @param {string[]} teamIds [home, away]
 */
export function bySide(events, teamIds) {
  return teamIds.map((id) => {
    const mine = events.filter((e) => e.teamId === id);
    return {
      teamId: id,
      goals: mine.filter((e) => GOAL_KINDS.has(e.kind)),
      cards: mine.filter((e) => e.kind === "yellow" || e.kind === "red"),
      subs: mine.filter((e) => e.kind === "sub"),
    };
  });
}

/**
 * Wins, draws and losses for `teamId` over previous meetings. A level score settled on penalties counts as a
 * draw (the match was drawn) and is listed in `shootouts`.
 * @param {Meeting[]} meetings
 * @param {string} teamId
 */
export function headToHeadRecord(meetings, teamId) {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let shootouts = 0;
  for (const m of meetings) {
    const mine = m.home.id === teamId ? m.home : m.away.id === teamId ? m.away : null;
    if (!mine) continue;
    const theirs = mine === m.home ? m.away : m.home;
    if (mine.score > theirs.score) wins++;
    else if (mine.score < theirs.score) losses++;
    else {
      draws++;
      if (mine.winner || theirs.winner) shootouts++;
    }
  }
  return { wins, draws, losses, shootouts, played: wins + draws + losses };
}

/** Did a level meeting go to penalties (ESPN marks a winner although the score is level)? @param {Meeting} m */
export const settledOnPenalties = (m) => m.home.score === m.away.score && (m.home.winner || m.away.winner);

const DAY = 86400e3;

/**
 * This site's stories for a match: `about` are tagged with both clubs (the match itself, or both clubs in
 * one story); `around` are tagged with either club within `days` of kick-off, for when there are none.
 * Newest first.
 * @template {{ clubs: string[], date: Date | null }} S
 * @param {S[]} stories
 * @param {(string | null)[]} slugs the two clubs (null for a side outside the league)
 * @param {Date | null} kickoff
 * @param {{ limit?: number, days?: number }} [opts]
 * @returns {{ about: S[], around: S[] }}
 */
export function relatedStories(stories, slugs, kickoff, { limit = 6, days = 3 } = {}) {
  const clubs = slugs.filter((s) => s != null);
  if (!clubs.length) return { about: [], around: [] };
  const newest = (/** @type {S} */ a, /** @type {S} */ b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
  const about = clubs.length === 2 ? stories.filter((s) => clubs.every((c) => s.clubs.includes(c))).sort(newest) : [];
  if (about.length || !kickoff) return { about: about.slice(0, limit), around: [] };
  const t = kickoff.getTime();
  const around = stories
    .filter(
      (s) => s.date != null && Math.abs(s.date.getTime() - t) <= days * DAY && clubs.some((c) => s.clubs.includes(c)),
    )
    .sort(newest);
  return { about: [], around: around.slice(0, limit) };
}

/** While a match is in play, the summary is fetched again this often (ESPN responses are reused for 30 s). */
export const LIVE_POLL_MS = 60e3;

/** @param {{ state?: string } | null | undefined} status ESPN's status type */
export const isLive = (status) => status?.state === "in";
