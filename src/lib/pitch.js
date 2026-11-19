// @ts-check
/**
 * Pitch layout from ESPN lineup data.
 *
 * ESPN gives each starter a position abbreviation (G, RB, CD-L, AM, F…) and the
 * team's formation string ("4-2-3-1"). Players are placed in rows by the
 * formation (goalkeeper, then each line from back to front); inside a row they
 * are ordered left → right by their position label. Nothing is invented: if the
 * formation string and the number of outfield starters disagree, the layout
 * falls back to grouping by position type.
 */

const depthOf = (pos = "") => {
  const p = pos.toUpperCase();
  if (p === "G" || p === "GK") return 0;
  if (/^(RB|LB|CD|CB|SW|RWB|LWB|WB)/.test(p)) return 1;
  if (/^(DM|CDM)/.test(p)) return 2;
  if (/^(CM|LM|RM|M)/.test(p)) return 3;
  if (/^(AM|CAM|LW|RW|W)/.test(p)) return 4;
  return 5; // F, CF, ST, SS
};

/** Left → right sort key: wide left (-2), inner left (-1), centre (0), inner right (1), wide right (2). */
const sideOf = (pos = "") => {
  const p = pos.toUpperCase();
  if (/^L[A-Z]/.test(p)) return -2;
  if (/^R[A-Z]/.test(p)) return 2;
  if (/-L$/.test(p)) return -1;
  if (/-R$/.test(p)) return 1;
  return 0;
};

/** "4-2-3-1" → [4,2,3,1]; null if it isn't a plain dash-separated line list. */
export function parseFormation(f) {
  if (!f || !/^\d(-\d){1,4}$/.test(f)) return null;
  return f.split("-").map(Number);
}

/**
 * Returns { rows: [[player…] back→front, GK first], formation, exact }.
 * `exact` is true when the rows follow the published formation.
 */
export function layoutLineup(lineup) {
  const starters = lineup?.starters ?? [];
  const gk = starters.filter((p) => depthOf(p.position) === 0);
  const field = starters.filter((p) => depthOf(p.position) !== 0);
  const counts = parseFormation(lineup?.formation);
  const ordered = [...field].sort(
    (a, b) => depthOf(a.position) - depthOf(b.position) || (a.place ?? 0) - (b.place ?? 0),
  );
  const byX = (row) =>
    [...row].sort((a, b) => sideOf(a.position) - sideOf(b.position) || (a.place ?? 0) - (b.place ?? 0));

  let rows;
  let exact = false;
  if (counts && counts.reduce((s, n) => s + n, 0) === ordered.length) {
    rows = [];
    let i = 0;
    for (const n of counts) {
      rows.push(byX(ordered.slice(i, i + n)));
      i += n;
    }
    exact = true;
  } else {
    // Fallback: one row per distinct position depth.
    const groups = new Map();
    for (const p of ordered) {
      const k = depthOf(p.position);
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    rows = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => byX(r));
  }
  return { rows: [gk, ...rows].filter((r) => r.length), formation: lineup?.formation ?? null, exact };
}

/** SVG coordinates (percent) for each player: back row at the bottom, attack at the top. */
export function pitchPoints(layout) {
  const n = layout.rows.length;
  const pts = [];
  layout.rows.forEach((row, ri) => {
    const y = n === 1 ? 50 : 90 - (ri * 78) / (n - 1); // GK ≈ 90, front line ≈ 12
    row.forEach((p, ci) => {
      const x = ((ci + 1) * 100) / (row.length + 1);
      pts.push({ p, x, y });
    });
  });
  return pts;
}
