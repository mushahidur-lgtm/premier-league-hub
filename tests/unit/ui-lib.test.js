import { describe, expect, it } from "vitest";
import { CLUBS } from "../../src/config/clubs.js";
import { accentVars, contrast, DEFAULT_ACCENT, INK, luminance, readableOn, SURFACE } from "../../src/lib/accent.js";
import { formPoints, recentForm } from "../../src/lib/form.js";
import { queryWords, search } from "../../src/lib/search.js";
import { titleFor } from "../../src/lib/titles.js";

describe("accent", () => {
  it("computes WCAG contrast", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
    expect(Number.isNaN(luminance("nope"))).toBe(true);
  });
  it.each(CLUBS.map((c) => [c.slug, c]))("%s gets an accent that passes AA as text and as a fill", (_s, club) => {
    const v = accentVars(club);
    expect(contrast(v["--accent"], SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v["--accent-ink"], v["--accent"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(INK, v["--accent-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v["--accent"], v["--accent-soft"])).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps a colour that already passes and darkens one that doesn't", () => {
    expect(readableOn("#063672")).toBe("#063672");
    const light = "#6CABDD";
    expect(contrast(light, SURFACE)).toBeLessThan(4.5);
    expect(contrast(readableOn(light), SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
  it("falls back to the site accent with no club or a bad colour", () => {
    expect(accentVars(null)["--accent"]).toBe(DEFAULT_ACCENT);
    expect(readableOn("red")).toBe(DEFAULT_ACCENT);
  });
});

const m = (id, result, date, leagueSlug = "eng.1") => ({ id, result, date: new Date(date), leagueSlug });

describe("recentForm", () => {
  it("returns the last league results oldest first, skipping cups and friendlies", () => {
    const schedule = {
      results: [
        m("6", "W", "2026-11-08"),
        m("5", "L", "2026-11-04", "uefa.champions"),
        m("4", "D", "2026-11-01"),
        m("3", "L", "2026-10-25"),
        m("2", "W", "2026-10-18"),
        m("1", "W", "2026-10-04"),
        m("0", "W", "2026-09-27"),
      ],
    };
    const form = recentForm(schedule);
    expect(form.map((f) => f.match.id)).toEqual(["1", "2", "3", "4", "6"]);
    expect(formPoints(form)).toBe(10);
  });
  it("is empty without data", () => {
    expect(recentForm(null)).toEqual([]);
    expect(recentForm({ results: [m("1", null, "2026-11-01")] })).toEqual([]);
  });
});

describe("search", () => {
  const clubs = CLUBS;
  const [a, b] = CLUBS;
  const players = [
    { player: { id: "p1", name: "Martin Ødegaard" }, clubSlug: a.slug },
    { player: { id: "p2", name: "Ollie Watkins" }, clubSlug: b.slug },
  ];
  const story = (title, date) => ({
    articles: [{ title, summary: "", source: "BBC Sport" }],
    categories: new Set(["injury"]),
    date: new Date(date),
  });
  const stories = [story("Watkins injury update", "2026-11-18"), story("Watkins scores twice", "2026-11-19")];

  it("ignores blank and one-letter queries", () => {
    expect(queryWords(" ")).toEqual([]);
    expect(queryWords("a")).toEqual([]);
    expect(search("x", { clubs }).clubs).toEqual([]);
  });
  it("finds clubs by name, abbreviation or alias", () => {
    expect(search(a.abbr.toLowerCase(), { clubs }).clubs.map((c) => c.slug)).toContain(a.slug);
    expect(search(b.aliases.at(-1), { clubs }).clubs.map((c) => c.slug)).toContain(b.slug);
  });
  it("matches players without accents and with their club as context", () => {
    expect(search("odegaard", { players }).players.map((p) => p.player.id)).toEqual(["p1"]);
    expect(search(`watkins ${b.shortName}`, { clubs, players }).players.map((p) => p.player.id)).toEqual(["p2"]);
    expect(search(`watkins ${a.shortName}`, { clubs, players }).players).toEqual([]);
  });
  it("matches at the start of words only", () => {
    const pool = {
      players: [{ player: { id: "p3", name: "Declan Rice" }, clubSlug: a.slug }],
      stories: [story("Lauren Price wins", "2026-11-18")],
    };
    expect(search("rice", pool).players).toHaveLength(1);
    expect(search("rice", pool).stories).toHaveLength(0);
    expect(search("ri", pool).players).toHaveLength(1);
  });
  it("needs every word in a story, newest first", () => {
    expect(search("watkins", { stories }).stories.map((s) => s.articles[0].title)).toEqual([
      "Watkins scores twice",
      "Watkins injury update",
    ]);
    expect(search("watkins injury", { stories }).stories).toHaveLength(1);
  });
});

describe("titleFor", () => {
  it("names each route", () => {
    expect(titleFor({ name: "home" })).toMatch(/table/);
    expect(titleFor({ name: "club", slug: "x" }, { clubName: "Club X" })).toMatch(/^Club X · /);
    expect(titleFor({ name: "club", slug: "x" })).toMatch(/^Club not found/);
    expect(titleFor({ name: "match", eventId: "1" }, { matchName: "A v B" })).toMatch(/^A v B · /);
    expect(titleFor({ name: "search", query: "rice" })).toMatch(/^Search: rice/);
    expect(titleFor({ name: "not-found", path: "/x" })).toMatch(/^Page not found/);
  });
});
