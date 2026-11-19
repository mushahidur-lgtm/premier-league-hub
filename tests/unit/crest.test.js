import { describe, expect, it } from "vitest";
import { sizedCrest } from "../../src/lib/crest.js";

const FULL = "https://a.espncdn.com/i/teamlogos/soccer/500/359.png";

describe("sizedCrest", () => {
  it("asks ESPN's combiner for the drawn size", () => {
    expect(sizedCrest(FULL, 24)).toBe("https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/359.png&w=24&h=24");
    expect(sizedCrest(FULL, 24, 2)).toContain("&w=48&h=48");
  });
  it("never asks for more than the original 500 px", () => {
    expect(sizedCrest(FULL, 400, 2)).toContain("&w=500&h=500");
  });
  it("leaves other URLs alone", () => {
    for (const url of ["https://example.com/a.png", `${FULL}?x=1`, "https://a.espncdn.com/combiner/i?img=/x.png"]) {
      expect(sizedCrest(url, 24)).toBe(url);
    }
  });
});
