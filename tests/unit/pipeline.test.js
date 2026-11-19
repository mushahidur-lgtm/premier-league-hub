import { describe, expect, it } from "vitest";
import { decode, parseFeed, stripHtml, upgradeImage } from "../../scripts/lib/feed-parser.mjs";
import { buildNews, canonicalLink, dedupe, makeClubTagger } from "../../scripts/lib/news.mjs";
import { CLUBS } from "../../src/config/clubs.js";

const BBC_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:media="http://search.yahoo.com/mrss/" version="2.0"><channel><title><![CDATA[BBC Sport]]></title>
<item>
  <title><![CDATA[Saka back in training ahead of derby]]></title>
  <description><![CDATA[Arsenal winger trains with the squad.]]></description>
  <link>https://www.bbc.co.uk/sport/football/articles/abc123?at_medium=RSS&amp;at_campaign=rss</link>
  <guid isPermaLink="false">https://www.bbc.co.uk/sport/football/articles/abc123#0</guid>
  <pubDate>Thu, 19 Nov 2026 07:38:22 GMT</pubDate>
  <media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/a1/b2.jpg"/>
</item>
<item><title>No link here</title><pubDate>Thu, 19 Nov 2026 07:00:00 GMT</pubDate></item>
</channel></rss>`;

const GUARDIAN_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" version="2.0"><channel>
<item>
  <title>Arteta&#8217;s side find a way | Barney Ronay</title>
  <link>https://www.theguardian.com/football/2026/nov/19/arsenal-report</link>
  <description>&lt;p&gt;First paragraph&lt;/p&gt;&lt;p&gt;Second &amp;amp; last&lt;/p&gt;</description>
  <pubDate>Wed, 18 Nov 2026 08:00:35 GMT</pubDate>
  <guid>https://www.theguardian.com/football/2026/nov/19/arsenal-report</guid>
  <media:content width="140" url="https://i.guim.co.uk/img/small.jpg"/>
  <dc:creator>Barney Ronay</dc:creator>
</item></channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title type="html">Chelsea &amp; Spurs draw</title>
<link rel="alternate" href="https://example.com/story"/><id>tag:example.com,2026:1</id>
<published>2026-11-18T12:00:00Z</published><summary>Summary text</summary><author><name>Jo Smith</name></author></entry>
</feed>`;

describe("feed parser", () => {
  it("parses BBC RSS with CDATA, entities, thumbnails and drops items without links", () => {
    const items = parseFeed(BBC_RSS, "bbc");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Saka back in training ahead of derby",
      link: "https://www.bbc.co.uk/sport/football/articles/abc123?at_medium=RSS&at_campaign=rss",
      id: "https://www.bbc.co.uk/sport/football/articles/abc123#0",
      date: "2026-11-19T07:38:22.000Z",
      image: "https://ichef.bbci.co.uk/ace/standard/800/cpsprodpb/a1/b2.jpg",
      excerpt: "Arsenal winger trains with the squad.",
      outlet: "bbc",
    });
  });

  it("parses Guardian RSS: escaped HTML description, byline split from the title, dc:creator", () => {
    const [item] = parseFeed(GUARDIAN_RSS, "guardian");
    expect(item.title).toBe("Arteta’s side find a way");
    expect(item.author).toBe("Barney Ronay");
    expect(item.excerpt).toBe("First paragraph. Second & last");
    expect(item.image).toBe("https://i.guim.co.uk/img/small.jpg");
  });

  it("parses Atom entries", () => {
    const [item] = parseFeed(ATOM, "bbc");
    expect(item).toMatchObject({
      title: "Chelsea & Spurs draw",
      link: "https://example.com/story",
      date: "2026-11-18T12:00:00.000Z",
      author: "Jo Smith",
      excerpt: "Summary text",
    });
  });

  it("rejects non-feeds and empty input", () => {
    expect(() => parseFeed("", "bbc")).toThrow(/empty/);
    expect(() => parseFeed("<html><body>Blocked</body></html>", "bbc")).toThrow(/Not an RSS/);
  });

  it("decodes entities and strips HTML", () => {
    expect(decode("&pound;5 &#x2019; &#8217; &amp;")).toBe("£5 ’ ’ &");
    expect(stripHtml("<p>a <b>b</b></p>")).toBe("a b");
    expect(upgradeImage("https://ichef.bbci.co.uk/news/240/x.jpg")).toBe("https://ichef.bbci.co.uk/news/800/x.jpg");
  });
});

describe("club tagging", () => {
  const tag = makeClubTagger(CLUBS);
  const t = (title) => tag({ title });

  it("finds clubs by name and nickname", () => {
    expect(t("Spurs beat Chelsea at the Bridge")).toEqual(["chelsea", "tottenham"]);
    expect(t("Man City and Manchester United both drop points")).toEqual(["man-city", "man-utd"]);
  });

  it("does not match inside other words or ambiguous names", () => {
    expect(t("Villarreal sign striker")).toEqual([]);
    expect(t("Forest Green Rovers win again")).toEqual([]);
    expect(t("Palace intrigue at Buckingham")).toEqual([]);
    expect(t("City fans protest")).toEqual([]);
    expect(t("Hullabaloo over VAR")).toEqual([]);
  });

  it("matches multi-word aliases and possessives", () => {
    expect(t("Crystal Palace's new stand")).toEqual(["crystal-palace"]);
    expect(t("Nottingham Forest appoint coach")).toEqual(["nottm-forest"]);
    expect(t("Aston Villa held")).toEqual(["aston-villa"]);
  });
});

describe("dedupe and buildNews", () => {
  const base = { id: "x", image: null, excerpt: "", author: "", date: "2026-11-19T10:00:00.000Z" };

  it("merges the same link (ignoring query strings) and unions club tags", () => {
    expect(canonicalLink("https://www.bbc.co.uk/a/b/?x=1#y")).toBe("bbc.co.uk/a/b");
    const out = dedupe([
      { ...base, title: "Story", link: "https://www.bbc.co.uk/a?x=1", outlet: "bbc", clubs: ["arsenal"] },
      { ...base, title: "Story", link: "https://www.bbc.co.uk/a?x=2", outlet: "bbc", clubs: ["chelsea"] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].clubs).toEqual(["arsenal", "chelsea"]);
  });

  it("merges near-identical headlines from different outlets and keeps the other link", () => {
    const out = dedupe([
      {
        ...base,
        title: "Liverpool sign Brazilian midfielder for £60m",
        link: "https://bbc.co.uk/1",
        outlet: "bbc",
        clubs: ["liverpool"],
      },
      {
        ...base,
        title: "Liverpool sign Brazilian midfielder for £60m fee",
        link: "https://theguardian.com/2",
        outlet: "guardian",
        clubs: ["liverpool"],
      },
      { ...base, title: "Liverpool lose at home", link: "https://bbc.co.uk/3", outlet: "bbc", clubs: ["liverpool"] },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].also).toEqual([{ outlet: "guardian", link: "https://theguardian.com/2" }]);
  });

  it("does not merge similar headlines far apart in time", () => {
    const out = dedupe([
      { ...base, title: "Arsenal v Chelsea preview", link: "https://a/1", outlet: "bbc", clubs: [] },
      {
        ...base,
        title: "Arsenal v Chelsea preview",
        link: "https://a/2",
        outlet: "bbc",
        clubs: [],
        date: "2026-11-01T10:00:00.000Z",
      },
    ]);
    expect(out).toHaveLength(2);
  });

  it("adds the feed's club, drops stale items and sorts newest first", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    const items = [
      { ...base, title: "Training update", link: "https://a/1", outlet: "bbc", date: "2026-11-18T10:00:00.000Z" },
      { ...base, title: "Old news", link: "https://a/2", outlet: "bbc", date: "2026-10-01T10:00:00.000Z" },
      { ...base, title: "Chelsea late winner", link: "https://a/3", outlet: "bbc", date: "2026-11-19T09:00:00.000Z" },
    ];
    const out = buildNews([{ items, club: "brentford" }], CLUBS, { now });
    expect(out.map((i) => i.title)).toEqual(["Chelsea late winner", "Training update"]);
    expect(out[0].clubs).toEqual(["brentford", "chelsea"]);
    expect(out[1].clubs).toEqual(["brentford"]);
    expect(out[0].players).toEqual([]);
  });
});
