import { describe, expect, it } from "vitest";
import { enrichArticle } from "../../src/lib/news.js";
import { raw } from "./helpers.js";

const tag = (title, excerpt = "") => {
  const a = enrichArticle(raw({ title, excerpt, link: `https://x.test/${encodeURIComponent(title)}` }));
  return { primary: a.primary, cats: [...a.categories], tc: [...a.titleConcepts], c: [...a.concepts] };
};

describe("transfer-window stories are tagged as transfers, not match news", () => {
  it("plural 'transfers', a £ amount or the window outrank match wording", () => {
    for (const t of [
      "Arsenal consensus reached over £162m January transfers",
      "Arsenal plan £60m January window raid",
      "Arsenal set transfer budget after win over Chelsea",
    ]) {
      const r = tag(t);
      expect(r.primary, `${t} → ${JSON.stringify(r)}`).toBe("transfer");
      expect(r.cats).toContain("transfer");
    }
  });
  it("genuine match reports are unaffected", () => {
    expect(tag("Arsenal beat Chelsea 2-0 at the Emirates").primary).toBe("match");
    expect(tag("Arsenal v Chelsea: team news and predicted line-ups").primary).toBe("match");
  });
});
