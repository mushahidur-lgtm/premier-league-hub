import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CLUBS } from "../../src/config/clubs.js";

/**
 * CLAUDE.md: "Everything club-specific lives in src/config/clubs.js. Nothing else in src/ may mention a
 * specific club." Checked here so the rule stays enforced as pages are added.
 */
// Vitest runs from the project root (import.meta.url is not a file: URL under jsdom).
const SRC = join(process.cwd(), "src");
const ALLOWED = new Set(["config/clubs.js"]);

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(jsx?|mjs|css|html)$/.test(e.name) ? [join(dir, e.name)] : [],
  );

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (s, flags = "i") => new RegExp(`(?<![\\w-])${escape(s)}(?![\\w-])`, flags);

/** Club-specific words: names, aliases and slugs (any case), abbreviations and ESPN ids (exact). */
const BANNED = [
  ...CLUBS.flatMap((c) =>
    [c.name, c.shortName, ...c.aliases, c.slug].map((n) => ({ club: c.slug, what: n, re: word(n) })),
  ),
  ...CLUBS.map((c) => ({ club: c.slug, what: c.abbr, re: word(c.abbr, "") })),
  ...CLUBS.map((c) => ({
    club: c.slug,
    what: `ESPN id ${c.espnId}`,
    re: new RegExp(`(?<![\\w.])${c.espnId}(?![\\w.])`),
  })),
  // People and places that identify one club as surely as its name.
  ...["Arteta", "Emirates", "Kroenke", "Anfield", "Old Trafford", "Etihad", "Stamford Bridge"].map((n) => ({
    club: "-",
    what: n,
    re: word(n),
  })),
];

describe("no club is named outside config/clubs.js", () => {
  const list = files(SRC).filter((f) => !ALLOWED.has(relative(SRC, f).replace(/\\/g, "/")));

  it("checks a real set of files", () => {
    expect(list.length).toBeGreaterThan(10);
  });

  it.each(list.map((f) => [relative(SRC, f).replace(/\\/g, "/"), f]))("%s", (_name, file) => {
    const text = readFileSync(file, "utf8");
    const hits = BANNED.filter((b) => b.re.test(text)).map((b) => `${b.what} (${b.club})`);
    expect(hits).toEqual([]);
  });
});
