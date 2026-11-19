import { describe, expect, it } from "vitest";
import { CLUBS, LEAGUE_FEEDS, OUTLETS, clubByEspnId, clubBySlug, crestUrl } from "../../src/config/clubs.js";

describe("club config", () => {
  it("has the 20 clubs with unique ids, slugs and abbreviations", () => {
    expect(CLUBS).toHaveLength(20);
    for (const key of ["espnId", "slug", "abbr", "name"]) {
      expect(new Set(CLUBS.map((c) => c[key])).size).toBe(20);
    }
  });

  it("uses URL-safe slugs that the router accepts", () => {
    for (const c of CLUBS) expect(c.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("has valid hex colours", () => {
    for (const c of CLUBS) {
      expect(c.colors.primary).toMatch(/^#[0-9A-F]{6}$/);
      expect(c.colors.secondary).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("gives every club at least two https feeds from known outlets", () => {
    for (const c of CLUBS) {
      expect(c.feeds.length).toBeGreaterThanOrEqual(2);
      for (const f of c.feeds) {
        expect(f.url).toMatch(/^https:\/\//);
        expect(OUTLETS[f.outlet]).toBeDefined();
      }
    }
    for (const f of LEAGUE_FEEDS) expect(OUTLETS[f.outlet]).toBeDefined();
  });

  it("never uses rss2json or public CORS relays", () => {
    const urls = [...CLUBS.flatMap((c) => c.feeds), ...LEAGUE_FEEDS].map((f) => f.url).join(" ");
    expect(urls).not.toMatch(/rss2json|allorigins|codetabs|corsproxy/);
  });

  it("has no feed URL used by two clubs", () => {
    const urls = CLUBS.flatMap((c) => c.feeds.map((f) => f.url));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("has no alias shared between clubs, and no ambiguous single words", () => {
    const aliases = CLUBS.flatMap((c) => c.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const bad of ["City", "United", "Palace", "Forest", "Town", "Bees"]) expect(aliases).not.toContain(bad);
  });

  it("builds ESPN crest URLs and looks clubs up", () => {
    expect(crestUrl("359")).toBe("https://a.espncdn.com/i/teamlogos/soccer/500/359.png");
    expect(clubBySlug("man-city")?.espnId).toBe("382");
    expect(clubByEspnId(367)?.slug).toBe("tottenham");
    expect(clubBySlug("nope")).toBeNull();
  });
});
