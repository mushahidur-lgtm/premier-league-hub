import { describe, expect, it } from "vitest";
import { tableGaps } from "../../src/lib/standings.js";

const table = (pts) => pts.map((p, i) => ({ id: `t${i + 1}`, rank: i + 1, pts: p }));

describe("tableGaps", () => {
  it("leader: lead over 2nd and cushion over 5th", () => {
    expect(tableGaps(table([27, 22, 21, 18, 16, 10]), "t1")).toEqual({
      rank: 1,
      second: 5,
      topFour: 11,
      inside: true,
      safety: null,
      inDrop: null,
    });
  });
  it("outside the top four: deficit to 4th (negative) and to 2nd", () => {
    expect(tableGaps(table([30, 28, 25, 22, 19, 17]), "t6")).toEqual({
      rank: 6,
      second: -11,
      topFour: -5,
      inside: false,
      safety: null,
      inDrop: null,
    });
  });
  it("2nd place has no gap to itself", () => {
    expect(tableGaps(table([30, 28, 25, 22, 19]), "t2").second).toBeNull();
  });
  it("is null, never NaN, when the table is short, empty or lacks points", () => {
    expect(tableGaps([], "t1")).toEqual({
      second: null,
      topFour: null,
      inside: null,
      rank: null,
      safety: null,
      inDrop: null,
    });
    expect(tableGaps(null, "t1").rank).toBeNull();
    expect(tableGaps(table([10, 9]), "t1")).toMatchObject({ second: 1, topFour: null });
    expect(tableGaps([{ id: "t1", rank: 1 }], "t1").rank).toBeNull();
    expect(tableGaps(table([5, 4, 3, 2, 1]), "missing").rank).toBeNull();
  });
});

describe("tableGaps: relegation line", () => {
  // 20 clubs, 40 points down to 21 in steps of 1: 17th has 24, 18th has 23.
  const full = table(Array.from({ length: 20 }, (_, i) => 40 - i));
  it("above the drop: cushion over 18th", () => {
    expect(tableGaps(full, "t15")).toMatchObject({ rank: 15, safety: 3, inDrop: false });
    expect(tableGaps(full, "t17")).toMatchObject({ safety: 1, inDrop: false });
  });
  it("in the bottom three: deficit to 17th", () => {
    expect(tableGaps(full, "t18")).toMatchObject({ safety: -1, inDrop: true });
    expect(tableGaps(full, "t20")).toMatchObject({ safety: -3, inDrop: true });
  });
  it("level on points with the line is 0, not a guess", () => {
    const level = full.map((r) => (r.rank === 18 ? { ...r, pts: 24 } : r));
    expect(tableGaps(level, "t17")).toMatchObject({ safety: 0, inDrop: false });
  });
  it("a short table has no relegation line", () => {
    expect(tableGaps(table([10, 9, 8]), "t3")).toMatchObject({ safety: null, inDrop: null });
  });
});
