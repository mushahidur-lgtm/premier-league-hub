// The pages job's precompress step: every compressed copy must decompress to exactly the original.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "..", "..", "scripts", "precompress.mjs");
const dir = mkdtempSync(join(tmpdir(), "plh-precompress-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("precompress", () => {
  it("writes .gz and .br copies of text files that decompress to the original, and skips the rest", () => {
    const big = JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => ({ id: i, title: `Story ${i}` })) });
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data", "news.json"), big);
    writeFileSync(join(dir, "index.html"), `<!doctype html><title>x</title>${" ".repeat(2000)}`);
    writeFileSync(join(dir, "tiny.js"), "1");
    writeFileSync(join(dir, "font.woff2"), Buffer.alloc(4000, 7));
    const out = execFileSync(process.execPath, [script, dir], { encoding: "utf8" });
    expect(out).toMatch(/precompressed 2 files/);
    for (const f of ["data/news.json", "index.html"]) {
      const original = readFileSync(join(dir, f));
      expect(gunzipSync(readFileSync(join(dir, `${f}.gz`)))).toEqual(original);
      expect(brotliDecompressSync(readFileSync(join(dir, `${f}.br`)))).toEqual(original);
    }
    expect(existsSync(join(dir, "tiny.js.gz"))).toBe(false); // under 1 KB
    expect(existsSync(join(dir, "font.woff2.gz"))).toBe(false); // already compressed
  });
});
