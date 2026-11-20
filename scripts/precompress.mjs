#!/usr/bin/env node
// @ts-check
/**
 * Writes a gzip (.gz) and a Brotli (.br) copy next to every text file in the site folder, for GitLab Pages:
 * Pages sends a compressed copy only when one exists beside the original (it doesn't compress on the fly),
 * choosing .br or .gz by the browser's Accept-Encoding. Without this, every file is sent uncompressed.
 *
 * Usage: node scripts/precompress.mjs [dir]   (default: public). Node 22, no dependencies.
 * Fonts and images are skipped: they are already compressed.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const TEXT = /\.(html|js|mjs|css|json|svg|txt|xml|webmanifest)$/i;
/** Smaller than this, compression saves too little to be worth a second request path. */
const MIN_BYTES = 1024;

/** @param {string} dir @returns {Promise<string[]>} */
async function textFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await textFiles(p)));
    else if (e.isFile() && TEXT.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Compresses one buffer both ways; returns null when it is too small to bother.
 * @param {Buffer} data
 */
function compress(data) {
  if (data.length < MIN_BYTES) return null;
  return {
    gz: gzipSync(data, { level: 9 }),
    br: brotliCompressSync(data, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
    }),
  };
}

async function main() {
  const dir = process.argv[2] ?? "public";
  let before = 0;
  let gz = 0;
  let br = 0;
  let count = 0;
  for (const file of await textFiles(dir)) {
    const data = await readFile(file);
    const c = compress(data);
    if (!c) continue;
    await writeFile(`${file}.gz`, c.gz);
    await writeFile(`${file}.br`, c.br);
    before += data.length;
    gz += c.gz.length;
    br += c.br.length;
    count++;
  }
  const kb = (/** @type {number} */ n) => `${Math.round(n / 1024)} KB`;
  console.log(`precompressed ${count} files: ${kb(before)} → gzip ${kb(gz)}, brotli ${kb(br)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
