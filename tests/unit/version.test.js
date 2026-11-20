import { describe, expect, it } from "vitest";
import { isNewer } from "../../src/lib/version.js";
import { asPref, darkCrest, nextPref, resolveTheme } from "../../src/lib/theme.js";

describe("new-version check", () => {
  it("only a different build id counts as newer", () => {
    expect(isNewer({ build: "abc" }, "def")).toBe(true);
    expect(isNewer({ build: "abc" }, "abc")).toBe(false);
    expect(isNewer({}, "abc")).toBe(false);
    expect(isNewer(null, "abc")).toBe(false);
    expect(isNewer({ build: "abc" }, null)).toBe(false);
  });
});

describe("theme", () => {
  it("resolves the stored choice against the device", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(asPref("nonsense")).toBe("system");
    expect([nextPref("system"), nextPref("light"), nextPref("dark")]).toEqual(["light", "dark", "system"]);
  });
  it("uses ESPN's dark-background crest", () => {
    expect(darkCrest("https://a.espncdn.com/i/teamlogos/soccer/500/359.png")).toBe(
      "https://a.espncdn.com/i/teamlogos/soccer/500-dark/359.png",
    );
  });
});

describe("dark crests", () => {
  it("only the club ESPN has no dark crest for is marked", async () => {
    const { CLUBS } = await import("../../src/config/clubs.js");
    expect(CLUBS.filter((c) => c.noDarkCrest).map((c) => c.espnId)).toEqual(["388"]);
  });
});
