import { describe, expect, it } from "vitest";
import { parseHash, toHash } from "../../src/lib/route.js";
import { BASE } from "../../src/config/site.js";

describe("parseHash", () => {
  it("treats empty and root hashes as home", () => {
    expect(parseHash("")).toEqual({ name: "home" });
    expect(parseHash("#/")).toEqual({ name: "home" });
  });

  it("parses club and match routes", () => {
    expect(parseHash("#/club/man-city")).toEqual({ name: "club", slug: "man-city" });
    expect(parseHash("#/match/740123")).toEqual({ name: "match", eventId: "740123" });
  });

  it("parses search with a query", () => {
    expect(parseHash("#/search?q=saka%20injury")).toEqual({ name: "search", query: "saka injury" });
  });

  it("rejects malformed routes", () => {
    expect(parseHash("#/club/Bad Slug").name).toBe("not-found");
    expect(parseHash("#/match/abc").name).toBe("not-found");
    expect(parseHash("#/nowhere").name).toBe("not-found");
  });

  it("round-trips through toHash", () => {
    for (const hash of ["#/", "#/club/arsenal", "#/match/740123", "#/search?q=salah"]) {
      expect(toHash(parseHash(hash))).toBe(hash);
    }
  });
});

describe("site config", () => {
  it("serves from the GitLab Pages project path", () => {
    expect(BASE).toBe("/premier-league-hub/");
  });
});
