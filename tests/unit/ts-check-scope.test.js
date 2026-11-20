// `npm run typecheck` checks exactly the files that start with `// @ts-check` (tsconfig: checkJs false).
// This keeps every file in its scope there, and stops `@ts-nocheck` being used to silence it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const filesIn = (dir, ext) =>
  readdirSync(join(root, dir), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(ext))
    .map((f) => join(dir, f));

const SCOPE = [...filesIn("src/lib", ".js"), ...filesIn("src/config", ".js"), ...filesIn("scripts", ".mjs")];

describe("typecheck scope", () => {
  it("covers some files", () => expect(SCOPE.length).toBeGreaterThan(25));
  it.each(SCOPE)("%s opts in with // @ts-check and never opts out", (file) => {
    const src = readFileSync(join(root, file), "utf8");
    const firstCode = src.split("\n").find((l) => l.trim() && !l.startsWith("#!"));
    expect(firstCode?.trim()).toBe("// @ts-check");
    expect(src).not.toMatch(/@ts-nocheck/);
  });
});
