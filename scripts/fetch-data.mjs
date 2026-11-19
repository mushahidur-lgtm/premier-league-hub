#!/usr/bin/env node
// @ts-check
/**
 * Data pipeline: fetch every club and league news feed, parse, tag clubs, de-duplicate and write
 * public/data/news.json + public/data/meta.json for the site to read same-origin.
 *
 * Node 22, no npm dependencies. Runs in the GitLab `pages` job (on push and on schedule).
 * A failing feed is recorded in meta.json and never fails the build; the run only fails if
 * every feed fails (so a broken network doesn't deploy an empty site over a good one).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CLUBS, LEAGUE_FEEDS, OUTLETS } from "../src/config/clubs.js";
import { parseFeed } from "./lib/feed-parser.mjs";
import { buildNews } from "./lib/news.mjs";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
const USER_AGENT = "premier-league-hub/1.0 (unofficial fan site; news pipeline)";

/** @param {string} url */
async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return { text: await res.text(), status: res.status };
}

/** Run async jobs with a small concurrency cap, keeping input order. */
async function pool(/** @type {(() => Promise<any>)[]} */ jobs, limit) {
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

async function main() {
  const started = Date.now();
  // Club feeds first so a story's first (kept) copy carries its club's own outlet.
  const feeds = [
    ...CLUBS.flatMap((c) => c.feeds.map((f) => ({ ...f, club: c.slug }))),
    ...LEAGUE_FEEDS.map((f) => ({ ...f, club: null })),
  ];

  const results = await pool(
    feeds.map((f) => async () => {
      const t0 = Date.now();
      try {
        const { text, status } = await fetchText(f.url);
        const items = parseFeed(text, f.outlet);
        return { feed: f, items, status, ok: true, error: null, ms: Date.now() - t0 };
      } catch (err) {
        const e = /** @type {any} */ (err);
        const error = e?.name === "TimeoutError" ? `Timed out after ${TIMEOUT_MS / 1000}s` : String(e?.message ?? e);
        return { feed: f, items: [], status: e?.status ?? null, ok: false, error, ms: Date.now() - t0 };
      }
    }),
    CONCURRENCY,
  );

  const okCount = results.filter((r) => r.ok).length;
  if (okCount === 0) {
    console.error("Every feed failed; refusing to write empty news data.");
    for (const r of results) console.error(`  ${r.feed.url}: ${r.error}`);
    process.exit(1);
  }

  const now = new Date();
  const items = buildNews(
    results.map((r) => ({ items: r.items, club: r.feed.club })),
    CLUBS,
    { now },
  );
  const generatedAt = now.toISOString();

  const news = {
    generatedAt,
    outlets: Object.fromEntries(Object.entries(OUTLETS).map(([id, o]) => [id, { name: o.name, tier: o.tier }])),
    items,
  };
  const meta = {
    generatedAt,
    durationMs: Date.now() - started,
    counts: {
      feeds: results.length,
      feedsOk: okCount,
      rawItems: results.reduce((n, r) => n + r.items.length, 0),
      items: items.length,
    },
    feeds: results.map((r) => ({
      club: r.feed.club,
      outlet: r.feed.outlet,
      url: r.feed.url,
      ok: r.ok,
      status: r.status,
      items: r.items.length,
      error: r.error,
      ms: r.ms,
    })),
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "news.json"), JSON.stringify(news));
  await writeFile(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(`news.json: ${items.length} stories from ${okCount}/${results.length} feeds in ${meta.durationMs} ms`);
  for (const r of results.filter((x) => !x.ok))
    console.log(`  failed: ${r.feed.outlet} ${r.feed.club ?? "league"} (${r.error})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
