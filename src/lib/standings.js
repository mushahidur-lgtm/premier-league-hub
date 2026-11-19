// @ts-check
/**
 * Points gaps for a club's league-table card. Pure and tolerant of missing data: every field is null
 * when the table doesn't contain what's needed (never a guess).
 *
 *   second:  the club's points minus 2nd place (positive = ahead of them; the club in 2nd → null)
 *   topFour: distance from the top-four line. Inside the top four: the cushion over 5th.
 *            Outside: the deficit to 4th. `inside` says which.
 *   safety:  distance from the relegation line. Above it: the cushion over the first relegation
 *            place. In the bottom three: the deficit to the last safe place. `inDrop` says which.
 */

/** Number of clubs relegated from a 20-team Premier League. */
export const RELEGATION_PLACES = 3;

/**
 * @typedef {{ id: string, rank?: number, pts?: number }} TableRow
 * @typedef {{ rank: number | null, second: number | null, topFour: number | null, inside: boolean | null,
 *   safety: number | null, inDrop: boolean | null }} TableGaps
 */

/**
 * @param {TableRow[] | null | undefined} rows
 * @param {string} teamId ESPN team id
 * @returns {TableGaps}
 */
export function tableGaps(rows, teamId) {
  /** @type {TableGaps} */
  const empty = { second: null, topFour: null, inside: null, rank: null, safety: null, inDrop: null };
  if (!Array.isArray(rows) || !rows.length) return empty;
  const sorted = /** @type {Required<TableRow>[]} */ (
    rows.filter((r) => Number.isFinite(r?.pts) && Number.isFinite(r?.rank))
  ).sort((a, b) => a.rank - b.rank);
  const me = sorted.find((r) => r.id === teamId);
  if (!me) return empty;
  const at = (/** @type {number} */ rank) => sorted.find((r) => r.rank === rank) ?? null;
  const second = at(2);
  const fourth = at(4);
  const fifth = at(5);
  const inside = me.rank <= 4;
  let topFour = null;
  if (inside && fifth) topFour = me.pts - fifth.pts;
  else if (!inside && fourth) topFour = me.pts - fourth.pts;

  // The drop zone is measured from the bottom of a full table only; a short table can't say where it starts.
  const firstDrop = sorted.length >= 20 ? sorted.length - RELEGATION_PLACES + 1 : null;
  let safety = null;
  let inDrop = null;
  if (firstDrop != null) {
    inDrop = me.rank >= firstDrop;
    const line = at(inDrop ? firstDrop - 1 : firstDrop);
    safety = line ? me.pts - line.pts : null;
    if (safety == null) inDrop = null;
  }
  return {
    rank: me.rank,
    second: second && me.rank !== 2 ? me.pts - second.pts : null,
    topFour,
    inside: topFour == null ? null : inside,
    safety,
    inDrop,
  };
}
