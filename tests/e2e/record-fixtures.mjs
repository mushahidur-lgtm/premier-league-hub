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
const league = await get(`${SITE}/league.json`);
const stats = await get(`${SITE}/stats.json`);
const fpl = await get(`${SITE}/fpl.json`);
// Two squad players with league appearances: one with a recorded profile and match log, both for comparing.
const regulars = roster.athletes.filter((a) =>
  a.statistics?.splits?.categories?.some((c) => c.stats?.some((s) => s.name === "appearances" && s.value > 0)),
);
const [player, other] = regulars;
const ATHLETES = "https://site.web.api.espn.com/apis/common/v3/sports/soccer/eng.1/athletes";
const bio = await get(`${ATHLETES}/${player.id}`);
const log = await get(`${ATHLETES}/${player.id}/gamelog`);
// Only the parts the parsers read (no links, videos or tracking ids).
const keep = [
  "id",
  "displayName",
  "fullName",
  "firstName",
  "lastName",
  "age",
  "displayDOB",
  "citizenship",
  "flag",
  "position",
  "jersey",
  "displayJersey",
  "displayHeight",
  "displayWeight",
  "headshot",
  "status",
];
const athlete = { athlete: Object.fromEntries(keep.map((k) => [k, bio.athlete[k]])) };
athlete.athlete.team = { id: bio.athlete.team?.id, displayName: bio.athlete.team?.displayName };
const gamelog = { names: log.names, labels: log.labels, events: log.events, seasonTypes: log.seasonTypes };
for (const e of Object.values(gamelog.events)) {
  delete e.links;
  if (e.opponent) e.opponent = { id: e.opponent.id, displayName: e.opponent.displayName };
  if (e.team) e.team = { id: e.team.id };
}
// The recorded player's previous Premier League season from ESPN's core API (only the figures the parser reads).
const previousYear = stats.seasons?.[1]?.year;
const seasonJson = await get(
  `https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/${previousYear}/types/1/athletes/${player.id}/statistics`,
);
const SEASON_KEYS = new Set([
  "appearances",
  "minutes",
  "totalGoals",
  "goalAssists",
  "totalShots",
  "shotsOnTarget",
  "saves",
  "yellowCards",
  "redCards",
]);
const athleteSeason = {
  splits: {
    categories: seasonJson.splits.categories.map((c) => ({
      name: c.name,
      stats: c.stats.filter((s) => SEASON_KEYS.has(s.name)).map((s) => ({ name: s.name, value: s.value })),
    })),
  },
};
news.items = news.items.slice(0, 120); // keeps the fixture small; enough for every section
// One made-up injury story about a squad player ESPN lists as fine, so the e2e tests always exercise
// the "reported injured" note (rule 3) whatever the real news was on the day.
const fine = roster.athletes.find((a) => Array.isArray(a.injuries) && !a.injuries.length && a.lastName);
news.items.unshift({
  id: "e2e-injury",
  title: `${fine.lastName} ruled out of weekend game with hamstring injury`,
  link: "https://www.bbc.co.uk/sport/football/e2e-injury-fixture",
  date: new Date(Date.parse(recordedAt) - 2 * 3600e3).toISOString(),
  excerpt: "Fixture story for the end-to-end tests.",
  author: "",
  outlet: "bbc",
  clubs: [club.slug],
  players: [String(fine.id)],
  also: [],
});

await Promise.all([
  save("standings.json", standings),
  save("scoreboard.json", scoreboard),
  save("schedule.json", schedule),
  save("schedule-fixtures.json", fixtures),
  save("roster.json", roster),
  save("summary.json", summary),
  save("news.json", news),
  save("meta.json", meta),
  save("league.json", league),
  save("athlete.json", athlete),
  save("gamelog.json", gamelog),
  save("stats.json", stats),
  save("fpl.json", fpl),
  save("athlete-season.json", athleteSeason),
  save("recorded.json", {
    recordedAt,
    club: club.slug,
    espnId: club.espnId,
    eventId: last.id,
    playerId: player.id,
    otherPlayerId: other.id,
  }),
]);
console.log(JSON.stringify({ recordedAt, club: club.slug, eventId: last.id }));
