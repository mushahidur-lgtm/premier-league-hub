#!/usr/bin/env node
// @ts-check
/**
 * Data pipeline: fetch every club and league news feed, parse, tag clubs, de-duplicate and write
 * public/data/news.json + public/data/meta.json for the site to read same-origin.
 *
 * Node 22, no npm dependencies. Runs in the GitLab `pages` job (on push and on schedule).
 * A failing feed or squad is recorded in meta.json (`status`, `problems`, per-source errors with any address
 * removed). The run exits non-zero, writing nothing, when fewer than half the feeds work, too few stories
 * survive, or the output fails validation: the `pages` job then fails and GitLab keeps the site that is live.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CLUBS, LEAGUE_FEEDS, OUTLETS } from "../src/config/clubs.js";
import { parseFeed } from "./lib/feed-parser.mjs";
import { buildNews } from "./lib/news.mjs";
import { rosterPlayers } from "./lib/players.mjs";
import { describeError, runHealth, validateMeta, validateNews } from "./lib/validate-data.mjs";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
const USER_AGENT = "premier-league-hub/1.0 (unofficial fan site; news pipeline)";
const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9";
// Squads for player tagging: the roster endpoint, never bare /teams/:id (rule 1).
const rosterUrl = (/** @type {string} */ espnId) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/${espnId}/roster`;

/** @param {string} url @param {string} [accept] */
async function fetchText(url, accept = FEED_ACCEPT) {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept },
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
        const status = /** @type {any} */ (err)?.status ?? null;
        return { feed: f, items: [], status, ok: false, error: describeError(err, TIMEOUT_MS), ms: Date.now() - t0 };
      }
    }),
    CONCURRENCY,
  );

  // A failed roster never fails the build: that club's players just go untagged.
  const rosters = await pool(
    CLUBS.map((c) => async () => {
      try {
        const { text } = await fetchText(rosterUrl(c.espnId), "application/json");
        const players = rosterPlayers(JSON.parse(text), c.slug);
        return { club: c.slug, ok: players.length > 0, players, error: players.length ? null : "No players" };
      } catch (err) {
        return { club: c.slug, ok: false, players: [], error: describeError(err, TIMEOUT_MS) };
      }
    }),
    CONCURRENCY,
  );

  const okCount = results.filter((r) => r.ok).length;
  if (okCount === 0) return fail(["every feed failed"], results);

  const now = new Date();
  const items = buildNews(
    results.map((r) => ({ items: r.items, club: r.feed.club })),
    CLUBS,
    { now, players: rosters.flatMap((r) => r.players) },
  );
  const generatedAt = now.toISOString();

  const news = {
    generatedAt,
    outlets: Object.fromEntries(Object.entries(OUTLETS).map(([id, o]) => [id, { name: o.name, tier: o.tier }])),
    items,
  };
  const health = runHealth({
    feeds: results.length,
    feedsOk: okCount,
    items: items.length,
    rosters: rosters.length,
    rostersOk: rosters.filter((r) => r.ok).length,
  });
  if (health.status === "failed") return fail(health.problems, results);

  const meta = {
    generatedAt,
    durationMs: Date.now() - started,
    status: health.status,
    problems: health.problems,
    counts: {
      feeds: results.length,
      feedsOk: okCount,
      rawItems: results.reduce((n, r) => n + r.items.length, 0),
      items: items.length,
      rostersOk: rosters.filter((r) => r.ok).length,
      players: rosters.reduce((n, r) => n + r.players.length, 0),
      itemsWithPlayers: items.filter((i) => i.players.length).length,
    },
    rosters: rosters.map((r) => ({ club: r.club, ok: r.ok, players: r.players.length, error: r.error })),
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

  const invalid = [...validateNews(news, { clubSlugs: new Set(CLUBS.map((c) => c.slug)) }), ...validateMeta(meta)];
  if (invalid.length) return fail([`output failed validation: ${invalid.slice(0, 10).join("; ")}`], results);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "news.json"), JSON.stringify(news));
  await writeFile(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(
    `status: ${health.status}${health.problems.length ? ` (${health.problems.join("; ")})` : ""}; output valid`,
  );
  console.log(`news.json: ${items.length} stories from ${okCount}/${results.length} feeds in ${meta.durationMs} ms`);
  console.log(
    `players: ${meta.counts.players} from ${meta.counts.rostersOk}/${CLUBS.length} rosters; ` +
      `${meta.counts.itemsWithPlayers} stories name a player`,
  );
  for (const r of rosters.filter((x) => !x.ok)) console.log(`  roster failed: ${r.club} (${r.error})`);
  for (const r of results.filter((x) => !x.ok))
    console.log(`  failed: ${r.feed.outlet} ${r.feed.club ?? "league"} (${r.error})`);
}

/**
 * Stops the run without writing anything, so the `pages` job fails and the live site keeps its last good data.
 * @param {string[]} problems
 * @param {{ ok: boolean, error: string | null, feed: { url: string } }[]} results
 */
function fail(problems, results) {
  console.error(`Not deploying new data: ${problems.join("; ")}. The live site keeps its current data.`);
  for (const r of results.filter((x) => !x.ok)) console.error(`  ${r.feed.url}: ${r.error}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
