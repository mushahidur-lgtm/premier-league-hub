import { describe, expect, it } from "vitest";
import { isChunkError } from "../../src/lib/lazy.js";

describe("chunk load errors", () => {
  it.each([
    ["TypeError", "Failed to fetch dynamically imported module: https://x/assets/club-1.js"],
    ["TypeError", "Importing a module script failed."],
    ["ChunkLoadError", "Loading chunk 3 failed."],
  ])("%s: %s is a chunk error", (name, message) => {
    expect(isChunkError({ name, message })).toBe(true);
  });
  it("ordinary errors are not", () => {
    for (const e of [new Error("boom"), new TypeError("x is not a function"), null, undefined, {}]) {
      expect(isChunkError(e)).toBe(false);
    }
  });
});
