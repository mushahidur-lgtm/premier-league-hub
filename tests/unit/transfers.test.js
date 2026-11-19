import { describe, expect, it } from "vitest";
import { buildStories, parseNewsFile } from "../../src/lib/news.js";
import { transferFeed, transferStatus } from "../../src/lib/transfers.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");

describe("transferStatus", () => {
  it.each([
    "Aston Villa latest: Onana signs new deal",
    "JJ Gabriel confirms Manchester United exit",
    "Saka completes move to Real Madrid",
    "Rice extends his contract until 2031",
  ])("confirmed: %s", (t) => expect(transferStatus(t)).toBe("confirmed"));

  it.each([
    // Hedges win over completion wording.
    "Arsenal set to sign Kofane",
    "Arsenal close to new deals for Raya, Timber and Hincapie",
    "Hincapie in advanced talks over new Arsenal deal",
    "Rice verbally agrees new Arsenal contract",
    "Declan Rice agrees new Arsenal contract",
    "Fernandes rejects second Man Utd contract offer",
    "Has Saka signed his last Arsenal contract?",
    // "Signing" as a noun.
    "Arsenal willing to make sales to beat Chelsea and Liverpool to Scott signing",
    "Arsenal monitor Leverkusen striker Kofane",
  ])("reported: %s", (t) => expect(transferStatus(t)).toBe("reported"));
});

describe("transferFeed", () => {
  const stories = (titles) =>
    buildStories(
      parseNewsFile({
        generatedAt: "2026-11-19T12:00:00Z",
        outlets: { bbc: { name: "BBC Sport", tier: "reliable" } },
        items: titles.map(([title, players = []], n) => ({
          id: String(n),
          title,
          link: `https://www.bbc.co.uk/sport/${n}`,
          date: new Date(NOW - n * 3600e3).toISOString(),
          outlet: "bbc",
          clubs: ["arsenal"],
          players,
          excerpt: "",
        })),
      }).items,
      { now: NOW },
    );

  it("keeps transfer and contract stories, labelled, newest first", () => {
    const feed = transferFeed(
      stories([["Arsenal monitor Leverkusen striker Kofane"], ["Rice verbally agrees new Arsenal contract", ["1"]]]),
    );
    expect(feed.map((f) => [f.status, f.kind, f.story.lead.title])).toEqual([
      ["reported", "Transfer", "Arsenal monitor Leverkusen striker Kofane"],
      ["reported", "Contract", "Rice verbally agrees new Arsenal contract"],
    ]);
  });

  it("leaves out stories that only sound like transfers", () => {
    const feed = transferFeed(
      stories([
        ["Arsenal Double winner Storey dies aged 81"],
        ["Man Utd announce financial results as revenue and wages rise"],
        ["Brighton breeze past 10-man Brentford to move up to second", ["2"]],
        ["Le Fée’s penalty stuns Chelsea and breathes life into defiant Sunderland", ["3"]],
        ["Crystal Palace sack Pierre Sage and in advanced talks to appoint Thomas Frank"],
        ["Hometown glory? Norwegian library unveils £100k history book donated by Haaland"],
        ["Transfer Centre LIVE! Time for Man Utd to sell Fernandes? Vote here!", ["4"]],
      ]),
    );
    expect(feed).toEqual([]);
  });

  it("filters by club", () => {
    const s = stories([["Arsenal monitor Leverkusen striker Kofane"]]);
    expect(transferFeed(s, { club: "chelsea" })).toEqual([]);
    expect(transferFeed(s, { club: "arsenal" })).toHaveLength(1);
  });
});
