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
import {
  describeError,
  runHealth,
  validateLeague,
  validateMeta,
  validateNews,
  validateStats,
} from "./lib/validate-data.mjs";
import { buildLeague, carryOver } from "./lib/league.mjs";
import { buildStats, carryOverStats, rosterStats, withFpl } from "./lib/stats.mjs";
import { SITE_URL } from "../src/config/site.js";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
const USER_AGENT = "premier-league-hub/1.0 (unofficial fan site; news pipeline)";
// League data (league.json): official FPL gameweeks and fixtures (no CORS, so pipeline only) and ESPN leaders.
const FPL_BOOTSTRAP = "https://fantasy.premierleague.com/api/bootstrap-static/";
const FPL_FIXTURES = "https://fantasy.premierleague.com/api/fixtures/";
const ESPN_STATS = "https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.1/statistics";
// Season team statistics (ESPN core API; one small JSON per club and season).
const teamStatsUrl = (/** @type {number} */ year, /** @type {string} */ espnId) =>
  `https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/${year}/types/1/teams/${espnId}/statistics`;
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
        const raw = JSON.parse(text);
        const players = rosterPlayers(raw, c.slug);
        return { club: c.slug, ok: players.length > 0, players, raw, error: players.length ? null : "No players" };
      } catch (err) {
        return { club: c.slug, ok: false, players: [], raw: null, error: describeError(err, TIMEOUT_MS) };
      }
    }),
    CONCURRENCY,
  );

  const okCount = results.filter((r) => r.ok).length;
  if (okCount === 0) return fail(["every feed failed"], results);

  const now = new Date();
  const league = await leagueData(
    now,
    rosters.flatMap((r) => r.players),
  );
  const stats = await statsData(now, {
    year: league.year,
    rosters,
    minutes: league.file?.minutes ?? null,
    bootstrap: league.bootstrap,
  });
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
    stats: stats.file
      ? {
          missing: stats.file.missing,
          carriedOver: stats.file.carriedOver,
          asOf: stats.file.asOf,
          problems: stats.problems,
        }
      : { missing: ["current", "previous", "players"], carriedOver: [], asOf: null, problems: stats.problems },
    league: league.file
      ? {
          missing: league.file.missing,
          carriedOver: league.file.carriedOver,
          asOf: league.file.asOf,
          problems: league.problems,
        }
      : {
          missing: ["gameweeks", "form", "leaders", "minutes"],
          carriedOver: [],
          asOf: null,
          problems: league.problems,
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

  const invalid = [...validateNews(news, { clubSlugs: new Set(CLUBS.map((c) => c.slug)) }), ...validateMeta(meta)];
  if (invalid.length) return fail([`output failed validation: ${invalid.slice(0, 10).join("; ")}`], results);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "news.json"), JSON.stringify(news));
  await writeFile(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));
  if (league.file) await writeFile(join(OUT_DIR, "league.json"), JSON.stringify(league.file));
  if (stats.file) await writeFile(join(OUT_DIR, "stats.json"), JSON.stringify(stats.file));
  console.log(
    `stats.json: ${stats.file ? `missing [${stats.file.missing}], carried over [${stats.file.carriedOver}]` : "not written"}` +
      `${stats.problems.length ? `; ${stats.problems.join("; ")}` : ""}`,
  );
  console.log(
    `league.json: ${league.file ? `missing [${league.file.missing}], carried over [${league.file.carriedOver}]` : "not written"}` +
      `${league.problems.length ? `; ${league.problems.join("; ")}` : ""}`,
  );

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

/** @param {string} url */
async function fetchJson(url) {
  const { text } = await fetchText(url, "application/json");
  return JSON.parse(text);
}

/**
 * league.json from FPL (gameweeks, fixtures, form) and ESPN (leaders). A source that fails, or output that
 * fails validation, never stops the news deploy: its part is carried over from the live league.json with
 * that copy's date, or left out and listed in `missing`.
 * @param {Date} now
 * @param {any[]} squads ESPN squad players, for FPL minutes
 * @returns {Promise<{ file: any, problems: string[], bootstrap: any, year: number | null }>}
 */
async function leagueData(now, squads) {
  /** @type {string[]} */
  const problems = [];
  /** @param {string} label @param {string} url */
  const tryJson = async (label, url) => {
    try {
      return await fetchJson(url);
    } catch (err) {
      problems.push(`${label}: ${describeError(err, TIMEOUT_MS)}`);
      return null;
    }
  };
  const [bootstrap, fixtures, stats] = await Promise.all([
    tryJson("FPL bootstrap-static", FPL_BOOTSTRAP),
    tryJson("FPL fixtures", FPL_FIXTURES),
    tryJson("ESPN statistics", ESPN_STATS),
  ]);
  const built = buildLeague(bootstrap && fixtures ? { bootstrap, fixtures } : null, stats, CLUBS, now, squads);
  problems.push(...built.problems);
  let file = built.league;
  const slugs = new Set(CLUBS.map((c) => c.slug));
  const invalid = validateLeague(file, { clubSlugs: slugs });
  if (invalid.length) {
    problems.push(`league.json failed validation: ${invalid.slice(0, 5).join("; ")}`);
    file = { ...file, gameweeks: null, fixtures: null, form: null, leaders: null, season: null, minutes: null };
    file.missing = ["gameweeks", "form", "leaders", "minutes"];
  }
  if (file.missing.length) {
    const previous = await tryJson("previous league.json", `${SITE_URL}data/league.json`);
    if (previous && !validateLeague(previous, { clubSlugs: slugs }).length) file = carryOver(file, previous);
  }
  const year = Number.isInteger(stats?.season?.year) ? stats.season.year : null;
  if (validateLeague(file, { clubSlugs: slugs }).length) return { file: null, problems, bootstrap, year };
  return { file, problems, bootstrap, year };
}

/** The season year ESPN uses ("2026" for 2026-27), from the date when ESPN didn't say: seasons start in August. */
const yearFromDate = (/** @type {Date} */ d) => (d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);

/**
 * stats.json: ESPN team statistics for this season and the last (one small request per club and season),
 * and this season's player figures from the squads already fetched, with FPL minutes, xG and xA. Like
 * league.json, a failed part is carried over from the live file or listed as missing; never blocks the deploy.
 * @param {Date} now
 * @param {{ year: number | null, rosters: { club: string, raw: any }[], minutes: any, bootstrap: any }} input
 */
async function statsData(now, { year, rosters, minutes, bootstrap }) {
  /** @type {string[]} */
  const problems = [];
  const current = year ?? yearFromDate(now);
  if (year == null) problems.push(`season year taken from the date (${current}): ESPN statistics unavailable`);
  const years = [current, current - 1];
  /** @type {Record<number, Record<string, any>>} */
  const teams = Object.fromEntries(years.map((y) => [y, {}]));
  await pool(
    years.flatMap((y) =>
      CLUBS.map((c) => async () => {
        try {
          teams[y][c.slug] = await fetchJson(teamStatsUrl(y, c.espnId));
        } catch (err) {
          teams[y][c.slug] = /** @type {any} */ (err)?.status === 404 ? "absent" : "error";
        }
      }),
    ),
    CONCURRENCY,
  );
  const squads = rosters.filter((r) => r.raw).flatMap((r) => rosterStats(r.raw, r.club));
  const players = squads.length ? withFpl(squads, minutes, bootstrap) : null;
  const built = buildStats({ now, years, teams, players });
  problems.push(...built.problems);
  let file = built.stats;
  const slugs = { clubSlugs: new Set(CLUBS.map((c) => c.slug)) };
  const invalid = validateStats(file, slugs);
  if (invalid.length) {
    problems.push(`stats.json failed validation: ${invalid.slice(0, 5).join("; ")}`);
    return { file: null, problems };
  }
  if (file.missing.length) {
    try {
      const previous = await fetchJson(`${SITE_URL}data/stats.json`);
      if (!validateStats(previous, slugs).length) file = carryOverStats(file, previous);
    } catch (err) {
      problems.push(`previous stats.json: ${describeError(err, TIMEOUT_MS)}`);
    }
  }
  return { file: validateStats(file, slugs).length ? null : file, problems };
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
