// Records the responses the end-to-end tests replay, into tests/e2e/fixtures/.
//   node tests/e2e/record-fixtures.mjs
// Only response bodies are saved (public ESPN data and this site's own news files), never headers,
// so the fixtures hold no IPs, cookies or tokens. Re-record when ESPN changes shape, then update
// RECORDED_AT in tests/e2e/fixtures.js to the "recordedAt" this script prints.
import { mkdir, writeFile } from "node:fs/promises";
import { CLUBS } from "../../src/config/clubs.js";

const OUT = new URL("./fixtures/", import.meta.url);
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const SITE = "https://mushahidur.gitlab.io/premier-league-hub/data";
const club = CLUBS[0];

const get = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": "premier-league-hub-fixture-recorder" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const save = (name, json) => writeFile(new URL(name, OUT), JSON.stringify(json));

await mkdir(OUT, { recursive: true });
const recordedAt = new Date().toISOString();
const standings = await get("https://site.web.api.espn.com/apis/v2/sports/soccer/eng.1/standings");
const scoreboard = await get(`${ESPN}/eng.1/scoreboard`);
const schedule = await get(`${ESPN}/all/teams/${club.espnId}/schedule`);
const fixtures = await get(`${ESPN}/all/teams/${club.espnId}/schedule?fixture=true`);
const roster = await get(`${ESPN}/eng.1/teams/${club.espnId}/roster`);
const last = [...schedule.events]
  .filter((e) => e.competitions?.[0]?.status?.type?.state === "post")
  .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
const fullSummary = await get(`${ESPN}/all/summary?event=${last.id}`);
// Only the parts parseSummary reads.
const summary = Object.fromEntries(
  ["header", "boxscore", "rosters", "keyEvents", "leaders", "article", "gameInfo"].map((k) => [k, fullSummary[k]]),
);
const news = await get(`${SITE}/news.json`);
const meta = await get(`${SITE}/meta.json`);
news.items = news.items.slice(0, 120); // keeps the fixture small; enough for every section

await Promise.all([
  save("standings.json", standings),
  save("scoreboard.json", scoreboard),
  save("schedule.json", schedule),
  save("schedule-fixtures.json", fixtures),
  save("roster.json", roster),
  save("summary.json", summary),
  save("news.json", news),
  save("meta.json", meta),
  save("recorded.json", { recordedAt, club: club.slug, espnId: club.espnId, eventId: last.id }),
]);
console.log(JSON.stringify({ recordedAt, club: club.slug, eventId: last.id }));
