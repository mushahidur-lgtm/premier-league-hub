import { describe, expect, it } from "vitest";
import { buildNews } from "../../scripts/lib/news.mjs";
import { foldCase, makePlayerTagger, rosterPlayers } from "../../scripts/lib/players.mjs";
import { CLUBS } from "../../src/config/clubs.js";

// A small league: the names are real headline shapes from the 2026-11-19 feeds.
const P = (id, name, lastName, club) => ({ id, name, lastName, club });
const SQUADS = [
  P("1", "Declan Rice", "Rice", "arsenal"),
  P("2", "Bukayo Saka", "Saka", "arsenal"),
  P("3", "Ben White", "White", "arsenal"),
  P("4", "Martin Ødegaard", "Ødegaard", "arsenal"),
  P("5", "Ceadach O’Neill", "O’Neill", "arsenal"),
  P("10", "Reece James", "James", "chelsea"),
  P("11", "James Trafford", "Trafford", "leeds"),
  P("12", "Morgan Gibbs-White", "Gibbs-White", "nottm-forest"),
  P("13", "Virgil van Dijk", "van Dijk", "liverpool"),
  P("14", "Rico Lewis", "Lewis", "man-city"),
  P("15", "Jenson Arron Jones", "Jones", "sunderland"),
  P("16", "Evanilson", null, "bournemouth"),
  // Same surname at two clubs.
  P("20", "Harvey Barnes", "Barnes", "newcastle"),
  P("21", "Ashley Barnes", "Barnes", "burnley"),
  // Same surname twice in one squad.
  P("30", "Joe Wilson", "Wilson", "fulham"),
  P("31", "Harry Wilson", "Wilson", "fulham"),
];

const tag = makePlayerTagger(SQUADS, CLUBS);
const names = (title, clubs, excerpt = "") =>
  tag({ title, excerpt, clubs })
    .map((id) => SQUADS.find((p) => p.id === id).name)
    .sort();

describe("player tagging", () => {
  it("tags a full name anywhere, even without club context", () => {
    expect(names("Is Trafford England's new No 1? Rob Green on James Trafford", [])).toEqual(["James Trafford"]);
  });

  it("tags a surname only with its club's context", () => {
    expect(names("Rice verbally agrees new Arsenal contract", ["arsenal"])).toEqual(["Declan Rice"]);
    expect(names("Rice verbally agrees new contract", [])).toEqual([]);
    expect(names("Rice verbally agrees new contract", ["chelsea"])).toEqual([]);
  });

  it("matches possessives but is case-sensitive", () => {
    expect(names("'One HELL of a save!' - Saka's best goals for Arsenal", ["arsenal"])).toEqual(["Bukayo Saka"]);
    expect(names("Arsenal players say the rice at the training ground is white", ["arsenal"])).toEqual([]);
  });

  it("folds accents and curly apostrophes", () => {
    expect(names("Goal caps eye-catching Odegaard display", ["arsenal"])).toEqual(["Martin Ødegaard"]);
    expect(names("NI's O'Neill ruled out of Nations League matches", ["arsenal"])).toEqual(["Ceadach O’Neill"]);
    expect(foldCase("Gyökeres’ goal")).toBe("Gyokeres' goal");
  });

  it("never reads a hyphenated surname as its last part", () => {
    expect(names("Gibbs-White double sinks Spurs", ["nottm-forest", "arsenal"])).toEqual(["Morgan Gibbs-White"]);
  });

  it("matches a lowercase particle capitalised at the start of a name", () => {
    expect(names("Liverpool and Van Dijk have a decision to make", ["liverpool"])).toEqual(["Virgil van Dijk"]);
  });

  it("skips a surname that is part of someone else's name", () => {
    // A tipster, a pundit and a stadium, not the players.
    const excerpt = "Our top tipster Lewis Jones, aka Jones Knows, provides his analysis.";
    expect(names("PL Predictions: how will your club fare?", ["man-city", "sunderland"], excerpt)).toEqual([]);
    expect(names("Ten learnings", ["chelsea"], "James Savundra analyses Chelsea's first ten games.")).toEqual([]);
    expect(names("Man Utd host Liverpool at Old Trafford", ["leeds", "liverpool"])).toEqual([]);
  });

  it("still tags a surname after sentence-start capitals, possessives and club words", () => {
    expect(names("Versatile Saka fully fit", ["arsenal"])).toEqual(["Bukayo Saka"]);
    expect(names("Arsenal's White has 'exciting future'", ["arsenal"])).toEqual(["Ben White"]);
    expect(names("Is Trafford England's new No 1?", ["leeds"])).toEqual(["James Trafford"]);
  });

  it("blanks a full name so its first name isn't read as another club's surname", () => {
    // "James" is Reece James's surname; James Trafford's first name must not tag him.
    expect(names("'It's a special moment' - Rob Green on James Trafford", ["chelsea", "leeds"])).toEqual([
      "James Trafford",
    ]);
  });

  it("never tags a surname shared by two clubs in the same story", () => {
    expect(names("Barnes scores as Newcastle beat Burnley", ["newcastle", "burnley"])).toEqual([]);
    expect(names("Barnes: Bruno return just what we need", ["newcastle"])).toEqual(["Harvey Barnes"]);
    expect(names("Harvey Barnes scores as Newcastle beat Burnley", ["newcastle", "burnley"])).toEqual([
      "Harvey Barnes",
    ]);
  });

  it("never tags a surname shared inside one squad, but does tag the full name", () => {
    expect(names("Wilson eyeing survival step", ["fulham"])).toEqual([]);
    expect(names("Harry Wilson eyeing survival step", ["fulham"])).toEqual(["Harry Wilson"]);
  });

  it("treats a one-word name as a surname", () => {
    expect(names("Evanilson ignites eighth straight Bournemouth win", ["bournemouth"])).toEqual(["Evanilson"]);
    expect(names("Evanilson ignites eighth straight win", [])).toEqual([]);
  });

  it("requires club context for a full name two squads share", () => {
    const twins = [P("a", "Danny Ward", "Ward", "leeds"), P("b", "Danny Ward", "Ward", "ipswich")];
    const t = makePlayerTagger(twins, CLUBS);
    expect(t({ title: "Danny Ward signs new deal", clubs: [] })).toEqual([]);
    expect(t({ title: "Danny Ward signs new deal", clubs: ["ipswich"] })).toEqual(["b"]);
  });
});

describe("rosterPlayers", () => {
  it("keeps id, name and last name, skipping unreadable athletes", () => {
    const json = { athletes: [{ id: 7, displayName: "Bukayo Saka", lastName: "Saka" }, { displayName: "x" }, null] };
    expect(rosterPlayers(json, "arsenal")).toEqual([
      { id: "7", name: "Bukayo Saka", lastName: "Saka", club: "arsenal" },
    ]);
    expect(rosterPlayers({}, "arsenal")).toEqual([]);
  });
});

describe("buildNews with players", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const item = (title, extra = {}) => ({
    id: title,
    title,
    link: `https://www.bbc.co.uk/sport/${encodeURIComponent(title)}`,
    date: "2026-11-19T10:00:00Z",
    excerpt: "",
    outlet: "bbc",
    ...extra,
  });

  it("tags players after de-duplication, using the clubs every copy brought", () => {
    const out = buildNews(
      [
        { items: [item("Rice agrees new deal")], club: "arsenal" },
        { items: [item("Rice agrees new deal", { link: "https://www.theguardian.com/x" })], club: null },
      ],
      CLUBS,
      { now, players: SQUADS },
    );
    expect(out).toHaveLength(1);
    expect(out[0].players).toEqual(["1"]);
  });

  it("writes an empty list when no rosters loaded", () => {
    const out = buildNews([{ items: [item("Rice agrees new deal")], club: "arsenal" }], CLUBS, { now });
    expect(out[0].players).toEqual([]);
  });
});
