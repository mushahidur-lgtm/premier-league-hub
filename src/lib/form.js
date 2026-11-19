// @ts-check
/**
 * Recent league form from a club schedule (parseSchedules output). ESPN's standings carry no form, and
 * its scoreboard can't be asked for a date range, so form comes from each club's own schedule.
 */

/**
 * The club's last `n` Premier League results, oldest first (so the newest sits on the right).
 * Friendlies, cup games and results without a W/D/L are left out.
 * @param {{ results?: any[] } | null | undefined} schedule
 * @param {number} [n]
 * @returns {{ result: "W" | "D" | "L", match: any }[]}
 */
export function recentForm(schedule, n = 5) {
  const results = Array.isArray(schedule?.results) ? schedule.results : [];
  return results
    .filter((m) => m && m.leagueSlug === "eng.1" && ["W", "D", "L"].includes(m.result))
    .sort((a, b) => b.date - a.date)
    .slice(0, n)
    .reverse()
    .map((match) => ({ result: match.result, match }));
}

/** Points from a form list (3 a win, 1 a draw). @param {{ result: string }[]} form */
export const formPoints = (form) => form.reduce((s, f) => s + (f.result === "W" ? 3 : f.result === "D" ? 1 : 0), 0);
