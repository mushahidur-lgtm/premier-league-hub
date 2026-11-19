import { describe, expect, it } from "vitest";
import {
  cleanAuthor,
  buildStories,
  clusterArticles,
  enrichArticle,
  forClub,
  freshness,
  inCategory,
  parseNewsFile,
  pickBriefing,
  pickFeatured,
  playerKeys,
  canonicalUrl,
  relevance,
  SORTS,
  fold,
} from "../../src/lib/news.js";
import { outletForUrl } from "../../src/lib/sources.js";
import { getDiagnostics, resetDiagnostics } from "../../src/lib/diagnostics.js";
import { NOW, hoursAgo, raw } from "./helpers.js";

const build = (items, ctx = {}) => buildStories(items, { now: NOW, ...ctx });

describe("source credibility", () => {
  it("assigns tiers from the outlet, or keeps the tier the news file supplied", () => {
    expect(enrichArticle(raw()).tier).toBe("reliable");
    expect(enrichArticle(raw({ outlet: "guardian", source: undefined })).source).toBe("The Guardian");
    expect(enrichArticle(raw({ outlet: "fansite", source: "Fan site", tier: "opinion" })).tier).toBe("opinion");
  });
  it("upgrades a reliable outlet to journalist when a known reporter wrote it", () => {
    const a = enrichArticle(raw({ author: "David Ornstein", title: "Arsenal agree deal" }));
    expect(a.tier).toBe("journalist");
    expect(a.journalist).toBe("David Ornstein");
  });
  it("falls back to secondary for unknown outlets", () => {
    expect(enrichArticle(raw({ outlet: "mystery", source: "Mystery" })).tier).toBe("secondary");
  });
  it("records which sources an article is merely citing", () => {
    expect(enrichArticle(raw({ title: "Arsenal want striker, says Fabrizio Romano" })).cites).toContain(
      "Fabrizio Romano",
    );
  });
  it("maps URLs to outlets without false positives", () => {
    expect(outletForUrl("https://www.bbc.co.uk/sport/football/1")).toBe("bbc");
    expect(outletForUrl("https://www.theguardian.com/football/x")).toBe("guardian");
    expect(outletForUrl("https://notbbc.co.uk/news")).toBeNull();
    expect(outletForUrl("not a url")).toBeNull();
    expect(outletForUrl(undefined)).toBeNull();
  });
  it("cleans bylines", () => {
    expect(cleanAuthor("x@y.com (Tom Canton)")).toBe("Tom Canton");
    expect(cleanAuthor("BBC Sport")).toBe("");
    expect(cleanAuthor("by Jane Doe")).toBe("Jane Doe");
    expect(cleanAuthor(undefined)).toBe("");
  });
});

describe("duplicate detection and story grouping", () => {
  it("collapses the same URL (www, trailing slash, case) into one story", () => {
    const stories = build([
      raw({ link: "https://www.bbc.co.uk/sport/x/" }),
      raw({ link: "https://bbc.co.uk/sport/X", id: "2" }),
    ]);
    expect(stories).toHaveLength(1);
    expect(canonicalUrl("https://www.bbc.co.uk/sport/x/")).toBe(canonicalUrl("https://bbc.co.uk/sport/x"));
  });
  it("groups the same event reported by two outlets and counts both outlets", () => {
    const stories = build([
      raw({ title: "Saka signs new Arsenal contract", link: "https://www.bbc.co.uk/1", date: hoursAgo(3) }),
      raw({
        title: "Arsenal confirm Saka signs new contract",
        link: "https://www.theguardian.com/1",
        outlet: "guardian",
        source: "The Guardian",
        date: hoursAgo(2),
      }),
    ]);
    expect(stories).toHaveLength(1);
    expect(stories[0].outlets.sort()).toEqual(["BBC Sport", "The Guardian"]);
  });
  it("does not merge different events that share only a club or a person", () => {
    const stories = build([
      raw({ title: "Arsenal injury: Saka hamstring scan result", link: "https://www.bbc.co.uk/a" }),
      raw({
        title: "Arsenal reach agreement over Saka contract",
        link: "https://www.theguardian.com/b",
        outlet: "guardian",
        source: "The Guardian",
      }),
    ]);
    expect(stories).toHaveLength(2);
  });
  it("does not merge stories published days apart", () => {
    const stories = build([
      raw({ title: "Arsenal sign new striker Gyokeres deal", link: "https://www.bbc.co.uk/a", date: hoursAgo(1) }),
      raw({
        title: "Arsenal sign new striker Gyokeres deal",
        link: "https://www.theguardian.com/b",
        outlet: "guardian",
        source: "The Guardian",
        date: hoursAgo(24 * 10),
      }),
    ]);
    expect(stories).toHaveLength(2);
  });
  it("keeps stories about different clubs apart, however alike the headlines", () => {
    const stories = build([
      raw({ title: "Fulham training update", link: "https://www.bbc.co.uk/f", clubs: ["fulham"] }),
      raw({
        title: "Everton training update",
        link: "https://www.theguardian.com/e",
        outlet: "guardian",
        source: "The Guardian",
        clubs: ["everton"],
      }),
    ]);
    expect(stories).toHaveLength(2);
  });
  it("keeps different squad players apart", () => {
    const squad = playerKeys([
      { id: "1", name: "Bukayo Saka", lastName: "Saka" },
      { id: "2", name: "Martin Odegaard", lastName: "Ødegaard" },
    ]);
    const stories = build(
      [
        raw({ title: "Saka injury worry for Arsenal", link: "https://www.bbc.co.uk/a" }),
        raw({
          title: "Odegaard injury worry for Arsenal",
          link: "https://www.theguardian.com/b",
          outlet: "guardian",
          source: "The Guardian",
        }),
      ],
      { players: squad },
    );
    expect(stories).toHaveLength(2);
  });
  it("matches accented names via folding", () => {
    expect(fold("Ødegaard")).toBe("odegaard");
    expect(fold("Gabriel Magalhães")).toBe("gabriel magalhaes");
  });
  it("clusterArticles tolerates articles with no date", () => {
    const a = enrichArticle(raw({ date: null, link: "https://x.test/1", title: "Arsenal news one" }));
    const b = enrichArticle(raw({ date: null, link: "https://x.test/2", title: "Totally different words here" }));
    expect(() => clusterArticles([a, b])).not.toThrow();
  });
});

describe("filtering and relevance", () => {
  it("a story belongs to every club its articles were tagged with", () => {
    const stories = build([
      raw({ title: "Chelsea sign midfielder", link: "https://www.bbc.co.uk/c", clubs: ["chelsea"] }),
      raw({ title: "Arsenal beat Spurs 2-0", link: "https://www.bbc.co.uk/a", clubs: ["arsenal", "tottenham"] }),
      raw({ title: "Premier League fixture list released", link: "https://www.bbc.co.uk/pl", clubs: [] }),
    ]);
    expect(forClub(stories, "tottenham").map((s) => s.lead.link)).toEqual(["https://www.bbc.co.uk/a"]);
    expect(forClub(stories, "chelsea")).toHaveLength(1);
    expect(stories.find((s) => s.lead.link.endsWith("/pl")).clubs).toEqual([]);
  });
  it("counts the outlets the pipeline folded into an item as coverage", () => {
    const [s] = build([raw({ also: [{ outlet: "guardian", link: "https://www.theguardian.com/x" }] })]);
    expect(s.outlets.sort()).toEqual(["BBC Sport", "The Guardian"]);
    expect(s.independent).toHaveLength(2);
  });
  it("ranks a club's own stories above others for that club only", () => {
    const [mine, other] = build([
      raw({ title: "Fulham training update", link: "https://www.bbc.co.uk/f", clubs: ["fulham"] }),
      raw({
        title: "Everton training update",
        link: "https://www.theguardian.com/e",
        outlet: "guardian",
        source: "The Guardian",
        clubs: ["everton"],
      }),
    ]).sort((a, b) => a.lead.link.localeCompare(b.lead.link));
    expect(relevance(mine, NOW, "fulham")).toBeGreaterThan(relevance(mine, NOW, "everton"));
    expect(relevance(other, NOW)).toBe(relevance(other, NOW, "everton"));
  });
  it("skips malformed items rather than throwing", () => {
    const stories = build([null, undefined, {}, { title: "no link" }, { link: "https://x.test" }, raw()]);
    expect(stories).toHaveLength(1);
  });
  it("handles articles with an invalid or missing date", () => {
    const stories = build([
      raw({ date: null, link: "https://www.bbc.co.uk/nodate" }),
      raw({ date: new Date("x"), link: "https://www.bbc.co.uk/baddate", title: "Arteta update on squad" }),
    ]);
    expect(stories.length).toBeGreaterThan(0);
    for (const s of stories) expect(Number.isFinite(s.score)).toBe(true);
  });
  it("category filters", () => {
    const stories = build([
      raw({ title: "Arsenal sign defender in £50m deal", link: "https://www.bbc.co.uk/t" }),
      raw({
        title: "Arsenal beat Spurs 2-0 in derby",
        link: "https://www.theguardian.com/m",
        outlet: "guardian",
        source: "The Guardian",
      }),
      raw({ title: "Premier League table preview", link: "https://www.bbc.co.uk/pl", clubs: [] }),
    ]);
    const titles = (cat, club = null) => stories.filter((s) => inCategory(s, cat, club)).map((s) => s.lead.title);
    expect(titles("transfer")).toContain("Arsenal sign defender in £50m deal");
    expect(titles("match", "arsenal")).toEqual(["Arsenal beat Spurs 2-0 in derby"]);
    expect(titles("pl")).toContain("Premier League table preview");
    expect(titles("all")).toContain("Premier League table preview");
    expect(titles("all", "arsenal")).not.toContain("Premier League table preview");
    expect(titles("match", "chelsea")).toEqual([]);
  });
  it("sorts by recency and by relevance", () => {
    const stories = build([
      raw({ title: "Arsenal older story about training", link: "https://www.bbc.co.uk/old", date: hoursAgo(30) }),
      raw({
        title: "Arsenal newer story about tactics",
        link: "https://www.theguardian.com/new",
        outlet: "guardian",
        source: "The Guardian",
        date: hoursAgo(1),
      }),
    ]);
    expect([...stories].sort(SORTS.recent.fn)[0].lead.link).toContain("new");
    expect([...stories].sort(SORTS.relevant.fn)[0].lead.link).toContain("new");
  });
  it("fan opinion never leads the featured story or the briefing", () => {
    const stories = build([
      raw({
        title: "Arsenal fans debate Arteta tactics",
        link: "https://fans.test/1",
        outlet: "fansite",
        source: "Fan site",
        tier: "opinion",
        date: hoursAgo(0.5),
      }),
      raw({ title: "Arteta gives injury update before Spurs", link: "https://www.bbc.co.uk/inj", date: hoursAgo(5) }),
    ]);
    expect(pickFeatured(stories, NOW).tier).not.toBe("opinion");
    expect(pickBriefing(stories, NOW).every((s) => s.tier !== "opinion")).toBe(true);
  });
  it("featured story and briefing can be limited to one club", () => {
    const stories = build([
      raw({ title: "Arsenal injury update", link: "https://www.bbc.co.uk/a", date: hoursAgo(1) }),
      raw({ title: "Leeds injury update", link: "https://www.bbc.co.uk/l", clubs: ["leeds"], date: hoursAgo(2) }),
    ]);
    expect(pickFeatured(stories, NOW, "leeds").lead.link).toBe("https://www.bbc.co.uk/l");
    expect(pickBriefing(stories, NOW, 5, "leeds").map((s) => s.lead.link)).toEqual(["https://www.bbc.co.uk/l"]);
    expect(pickFeatured(stories, NOW, "hull")).toBeNull();
  });
  it("briefing returns nothing (not fabricated filler) when there are no stories", () => {
    expect(pickBriefing([], NOW)).toEqual([]);
    expect(pickFeatured([], NOW)).toBeNull();
  });
  it("freshness labels", () => {
    expect(freshness(hoursAgo(1), NOW)).toBe("new");
    expect(freshness(hoursAgo(20), NOW)).toBe("recent");
    expect(freshness(hoursAgo(24 * 4), NOW)).toBe("older");
    expect(freshness(hoursAgo(24 * 30), NOW)).toBe("stale");
    expect(freshness(null, NOW)).toBe("unknown");
  });
});

describe("parseNewsFile", () => {
  const file = (items, extra = {}) => ({
    generatedAt: "2025-01-15T10:00:00Z",
    outlets: { bbc: { name: "BBC Sport", tier: "reliable" } },
    items,
    ...extra,
  });
  const item = (over = {}) => ({
    id: "1",
    title: "T",
    link: "https://www.bbc.co.uk/1",
    date: "2025-01-15T09:00:00Z",
    image: null,
    excerpt: "",
    author: "",
    outlet: "bbc",
    clubs: ["arsenal"],
    players: [],
    also: [],
    ...over,
  });
  it("turns dates into Dates and takes outlet name and tier from the file", () => {
    const out = parseNewsFile(file([item()]));
    expect(out.generatedAt).toEqual(new Date("2025-01-15T10:00:00Z"));
    expect(out.items[0]).toMatchObject({ source: "BBC Sport", tier: "reliable", clubs: ["arsenal"] });
    expect(out.items[0].date).toEqual(new Date("2025-01-15T09:00:00Z"));
  });
  it.each([null, "x", [], {}, { items: "nope" }])("rejects a malformed file (%j) as a data error", (bad) => {
    expect(() => parseNewsFile(bad)).toThrow(expect.objectContaining({ kind: "data" }));
  });
  it("skips and counts items without a title or link; bad dates become null", () => {
    resetDiagnostics();
    const out = parseNewsFile(
      file([
        item({ title: "" }),
        item({ link: null }),
        null,
        item({ date: "garbage", clubs: "x", also: [{ outlet: 1 }] }),
      ]),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ date: null, clubs: [], also: [] });
    expect(getDiagnostics().dropped.news).toBe(3);
  });
  it("an empty item list is a valid, empty file", () => {
    expect(parseNewsFile(file([])).items).toEqual([]);
  });
  it("its output feeds buildStories directly", () => {
    const { items } = parseNewsFile(file([item({ title: "Arsenal beat Spurs 2-0" })]));
    expect(buildStories(items, { now: NOW })).toHaveLength(1);
  });
});
