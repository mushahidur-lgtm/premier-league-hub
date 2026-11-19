import { describe, expect, it } from "vitest";
import { injuryReports, isAbsenceReport, readHeadline } from "../../src/lib/injuries.js";
import { buildStories, parseNewsFile } from "../../src/lib/news.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const P = (id, name, lastName) => ({ id, name, lastName });
const GUEHI = P("1", "Marc Guéhi", "Guéhi");
const BURN = P("2", "Dan Burn", "Burn");
const BROBBEY = P("3", "Brian Brobbey", "Brobbey");
const XHAKA = P("4", "Granit Xhaka", "Xhaka");
const MARTINEZ = P("5", "Emiliano Martínez", "Martínez");
const ONEILL = P("6", "Ceadach O’Neill", "O’Neill");
const SAKA = P("7", "Bukayo Saka", "Saka");
const RICE = P("8", "Declan Rice", "Rice");

const read = (title, players) => Object.fromEntries(readHeadline(title, players));

describe("readHeadline", () => {
  it("reads injury wording about the named player", () => {
    expect(read("Wales without injured Williams for Portugal game", [P("9", "Neco Williams", "Williams")])).toEqual({
      9: "injured",
    });
    expect(read("NI's O'Neill ruled out of Nations League matches", [ONEILL])).toEqual({ 6: "injured" });
  });

  it("gives the injury to the player it describes, not the one replacing him", () => {
    expect(read("Burn replaces injured Guehi in England squad", [GUEHI, BURN])).toEqual({ 1: "injured" });
  });

  it("shares wording across a list of names", () => {
    expect(read("Sunderland latest: Brobbey and Xhaka miss training ahead of Villa", [BROBBEY, XHAKA])).toEqual({
      3: "doubt",
      4: "doubt",
    });
  });

  it("reads a return as a return, even next to injury words", () => {
    expect(read("Man City latest: Guehi returns to training - with a surprise guest!", [GUEHI])).toEqual({
      1: "back",
    });
    expect(read("Chelsea latest: Martinez keeps clean sheet on return from broken jaw", [MARTINEZ])).toEqual({
      5: "back",
    });
    expect(read("Versatile Saka fully fit and 'honoured' to be called up", [SAKA])).toEqual({ 7: "back" });
  });

  it("ignores words that only look like injury news", () => {
    expect(read("Saka scores injury-time winner", [SAKA])).toEqual({});
    expect(read("Saka grabs injury time winner at Anfield", [SAKA])).toEqual({});
    expect(read("'No doubt' Saka will start, says Arteta", [SAKA])).toEqual({});
    expect(
      read("Grealish apologises for absence after breach of discipline", [P("10", "Jack Grealish", "Grealish")]),
    ).toEqual({});
    expect(
      read("Last season difficult with injury and miscarriage - Muniz", [P("11", "Rodrigo Muniz", "Muniz")]),
    ).toEqual({});
  });

  it("needs the player in the headline", () => {
    expect(read("Arsenal suffer injury blow before derby", [SAKA])).toEqual({});
  });

  it("does not give a far-away injury to the other named player", () => {
    // Rice is named, but the injury wording sits next to Saka.
    expect(read("Rice scores twice as Arsenal win but Saka injured", [RICE, SAKA])).toEqual({ 7: "injured" });
  });

  it("reads fitness doubts", () => {
    expect(read("Saka fitness call to come at 'last minute'", [SAKA])).toEqual({ 7: "doubt" });
    expect(read("Saka a doubt for derby after knock", [SAKA])).toEqual({ 7: "doubt" });
  });
});

describe("injuryReports", () => {
  const file = (items) =>
    parseNewsFile({
      generatedAt: "2026-11-19T12:00:00Z",
      outlets: { bbc: { name: "BBC Sport", tier: "reliable" }, blog: { name: "Fan blog", tier: "opinion" } },
      items: items.map((i, n) => ({
        id: String(n),
        link: `https://www.bbc.co.uk/sport/${n}`,
        outlet: "bbc",
        clubs: ["arsenal"],
        excerpt: "",
        ...i,
      })),
    }).items;
  const reports = (items) => injuryReports(buildStories(file(items), { now: NOW }), [SAKA, RICE], NOW);

  it("reports the latest fitness news per player, with outlet and time", () => {
    const r = reports([
      { title: "Saka ruled out with hamstring injury", date: "2026-11-16T10:00:00Z", players: ["7"] },
      { title: "Saka returns to training ahead of derby", date: "2026-11-19T09:00:00Z", players: ["7"] },
    ]);
    expect(r.get("7")).toMatchObject({
      kind: "back",
      source: "BBC Sport",
      title: "Saka returns to training ahead of derby",
    });
    expect(isAbsenceReport(r.get("7"))).toBe(false);
  });

  it("flags a player ESPN may still list as fine", () => {
    const r = reports([
      { title: "Saka ruled out with hamstring injury", date: "2026-11-18T10:00:00Z", players: ["7"] },
    ]);
    expect(r.get("7")).toMatchObject({ kind: "injured", label: "Reported injured" });
    expect(isAbsenceReport(r.get("7"))).toBe(true);
  });

  it("needs the pipeline's player tag, a reliable outlet and a recent date", () => {
    const r = reports([
      { title: "Saka ruled out with hamstring injury", date: "2026-11-18T10:00:00Z", players: [] },
      { title: "Rice ruled out with knee injury", date: "2026-11-18T10:00:00Z", players: ["8"], outlet: "blog" },
      { title: "Rice sidelined by ankle injury", date: "2026-11-01T10:00:00Z", players: ["8"] },
    ]);
    expect(r.size).toBe(0);
  });
});
