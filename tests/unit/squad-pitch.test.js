import { describe, expect, it } from "vitest";
import { layoutLineup, parseFormation, pitchPoints } from "../../src/lib/pitch.js";
import { playerKeys } from "../../src/lib/news.js";

describe("squad name keys", () => {
  it("builds name-matching keys that skip ambiguous surnames", () => {
    const keys = playerKeys([
      { id: "a", name: "Gabriel Jesus", lastName: "Jesus" },
      { id: "b", name: "Gabriel Martinelli", lastName: "Martinelli" },
      { id: "c", name: "Ben White", lastName: "White" },
      { id: "d", name: "Jamie White", lastName: "White" },
      { id: "e", name: "Raya", lastName: "" },
    ]);
    expect(keys.find((k) => k.id === "c").lastKey).toBeNull(); // ambiguous
    expect(keys.find((k) => k.id === "b").lastKey).toBe("martinelli");
    expect(keys.find((k) => k.id === "e").fullKey).toBeNull(); // single name: never matched loosely
  });
});

describe("pitch layout", () => {
  const p = (position, place, name = position) => ({ position, place, name });
  const eleven = [
    p("G", 1),
    p("LB", 3),
    p("CD-L", 4),
    p("CD-R", 5),
    p("RB", 2),
    p("CM-L", 6),
    p("CM-R", 8),
    p("AM", 10),
    p("LF", 11),
    p("CF", 9),
    p("RF", 7),
  ];
  it("parses plain formations only", () => {
    expect(parseFormation("4-2-3-1")).toEqual([4, 2, 3, 1]);
    expect(parseFormation("4231")).toBeNull();
    expect(parseFormation(null)).toBeNull();
    expect(parseFormation("4-4-2-1-1-1-1")).toBeNull();
  });
  it("places goalkeeper first and honours a matching formation", () => {
    const out = layoutLineup({ formation: "4-3-3", starters: eleven });
    expect(out.exact).toBe(true);
    expect(out.rows[0]).toHaveLength(1);
    expect(out.rows.map((r) => r.length)).toEqual([1, 4, 3, 3]);
  });
  it("falls back to position depth when the formation doesn't match the players", () => {
    const out = layoutLineup({ formation: "4-4-3", starters: eleven });
    expect(out.exact).toBe(false);
    expect(out.rows.flat()).toHaveLength(11);
  });
  it("handles missing or empty lineups", () => {
    expect(layoutLineup(null).rows).toEqual([]);
    expect(layoutLineup({ starters: [] }).rows).toEqual([]);
  });
  it("keeps every point inside the pitch", () => {
    const pts = pitchPoints(layoutLineup({ formation: "4-3-3", starters: eleven }));
    expect(pts).toHaveLength(11);
    expect(pts.every(({ x, y }) => x > 0 && x < 100 && y >= 0 && y <= 100)).toBe(true);
    expect(pitchPoints({ rows: [] })).toEqual([]);
  });
});
