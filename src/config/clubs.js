// @ts-check

/**
 * The 20 Premier League clubs for the 2026/27 season. The only place in src/ that
 * names specific clubs. Used by the browser app and by scripts/fetch-data.mjs.
 *
 * - `espnId`: from ESPN's eng.1 teams list
 *   (https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams), checked 2026-11-19.
 * - `colors`: curated club colours (ESPN's `color` field is wrong for several clubs). The UI derives an
 *   accessible accent from these in Phase 3; never put text directly on them without a contrast check.
 * - `aliases`: names that tag a news story to this club. Whole-word, case-sensitive. Deliberately no
 *   ambiguous words ("City", "United", "Palace", "Forest", "Bees").
 * - `feeds`: club news feeds, every URL checked on FEEDS_CHECKED (see PLAN.md for the results).
 */

/** @typedef {"bbc" | "guardian" | "sky"} OutletId */
/** @typedef {{ outlet: OutletId, url: string }} Feed */
/**
 * @typedef {{
 *   espnId: string, slug: string, name: string, shortName: string, abbr: string,
 *   colors: { primary: string, secondary: string }, aliases: string[], feeds: Feed[]
 * }} Club
 */

export const FEEDS_CHECKED = "2026-11-19";

/** @type {Record<OutletId, { name: string, tier: "reliable", domains: string[] }>} */
export const OUTLETS = {
  bbc: { name: "BBC Sport", tier: "reliable", domains: ["bbc.co.uk", "bbc.com"] },
  guardian: { name: "The Guardian", tier: "reliable", domains: ["theguardian.com"] },
  sky: { name: "Sky Sports", tier: "reliable", domains: ["skysports.com"] },
};

export const crestUrl = (/** @type {string} */ espnId) => `https://a.espncdn.com/i/teamlogos/soccer/500/${espnId}.png`;

const bbc = (/** @type {string} */ slug) => ({
  outlet: /** @type {const} */ ("bbc"),
  url: `https://feeds.bbci.co.uk/sport/football/teams/${slug}/rss.xml`,
});
const guardian = (/** @type {string} */ slug) => ({
  outlet: /** @type {const} */ ("guardian"),
  url: `https://www.theguardian.com/football/${slug}/rss`,
});
const sky = (/** @type {number} */ id) => ({
  outlet: /** @type {const} */ ("sky"),
  url: `https://www.skysports.com/rss/${id}`,
});

/** League-wide feeds; stories are tagged to clubs by their aliases. */
/** @type {Feed[]} */
export const LEAGUE_FEEDS = [
  { outlet: "bbc", url: "https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml" },
  { outlet: "guardian", url: "https://www.theguardian.com/football/premierleague/rss" },
  sky(11660),
];

/** @type {Club[]} */
export const CLUBS = [
  {
    espnId: "359",
    slug: "arsenal",
    name: "Arsenal",
    shortName: "Arsenal",
    abbr: "ARS",
    colors: { primary: "#EF0107", secondary: "#063672" },
    aliases: ["Arsenal", "Gunners"],
    feeds: [bbc("arsenal"), guardian("arsenal"), sky(11670)],
  },
  {
    espnId: "362",
    slug: "aston-villa",
    name: "Aston Villa",
    shortName: "Aston Villa",
    abbr: "AVL",
    colors: { primary: "#670E36", secondary: "#95BFE5" },
    aliases: ["Aston Villa", "Villa"],
    feeds: [bbc("aston-villa"), guardian("aston-villa"), sky(11677)],
  },
  {
    espnId: "349",
    slug: "bournemouth",
    name: "AFC Bournemouth",
    shortName: "Bournemouth",
    abbr: "BOU",
    colors: { primary: "#DA291C", secondary: "#000000" },
    aliases: ["Bournemouth", "Cherries"],
    feeds: [bbc("afc-bournemouth"), guardian("bournemouth")],
  },
  {
    espnId: "337",
    slug: "brentford",
    name: "Brentford",
    shortName: "Brentford",
    abbr: "BRE",
    colors: { primary: "#E30613", secondary: "#FBB800" },
    aliases: ["Brentford"],
    feeds: [bbc("brentford"), guardian("brentford")],
  },
  {
    espnId: "331",
    slug: "brighton",
    name: "Brighton & Hove Albion",
    shortName: "Brighton",
    abbr: "BHA",
    colors: { primary: "#0057B8", secondary: "#FFCD00" },
    aliases: ["Brighton", "Seagulls"],
    feeds: [bbc("brighton-and-hove-albion"), guardian("brightonfootball")],
  },
  {
    espnId: "363",
    slug: "chelsea",
    name: "Chelsea",
    shortName: "Chelsea",
    abbr: "CHE",
    colors: { primary: "#034694", secondary: "#DBA111" },
    aliases: ["Chelsea"],
    feeds: [bbc("chelsea"), guardian("chelsea"), sky(11668)],
  },
  {
    espnId: "388",
    slug: "coventry",
    name: "Coventry City",
    shortName: "Coventry",
    abbr: "COV",
    colors: { primary: "#59CBE8", secondary: "#1D2C5E" },
    aliases: ["Coventry"],
    feeds: [bbc("coventry-city"), guardian("coventry")],
  },
  {
    espnId: "384",
    slug: "crystal-palace",
    name: "Crystal Palace",
    shortName: "Crystal Palace",
    abbr: "CRY",
    colors: { primary: "#1B458F", secondary: "#C4122E" },
    aliases: ["Crystal Palace"],
    feeds: [bbc("crystal-palace"), guardian("crystalpalace"), sky(11706)],
  },
  {
    espnId: "368",
    slug: "everton",
    name: "Everton",
    shortName: "Everton",
    abbr: "EVE",
    colors: { primary: "#003399", secondary: "#FFFFFF" },
    aliases: ["Everton", "Toffees"],
    feeds: [bbc("everton"), guardian("everton"), sky(11671)],
  },
  {
    espnId: "370",
    slug: "fulham",
    name: "Fulham",
    shortName: "Fulham",
    abbr: "FUL",
    colors: { primary: "#000000", secondary: "#CC0000" },
    aliases: ["Fulham"],
    feeds: [bbc("fulham"), guardian("fulham"), sky(11681)],
  },
  {
    espnId: "306",
    slug: "hull",
    name: "Hull City",
    shortName: "Hull",
    abbr: "HUL",
    colors: { primary: "#F5A12D", secondary: "#000000" },
    aliases: ["Hull City", "Hull"],
    feeds: [bbc("hull-city"), guardian("hullcity")],
  },
  {
    espnId: "373",
    slug: "ipswich",
    name: "Ipswich Town",
    shortName: "Ipswich",
    abbr: "IPS",
    colors: { primary: "#0044A9", secondary: "#DE2C37" },
    aliases: ["Ipswich"],
    feeds: [bbc("ipswich-town"), guardian("ipswichtown"), sky(11707)],
  },
  {
    espnId: "357",
    slug: "leeds",
    name: "Leeds United",
    shortName: "Leeds",
    abbr: "LEE",
    colors: { primary: "#1D428A", secondary: "#FFCD00" },
    aliases: ["Leeds"],
    feeds: [bbc("leeds-united"), guardian("leedsunited"), sky(11715)],
  },
  {
    espnId: "364",
    slug: "liverpool",
    name: "Liverpool",
    shortName: "Liverpool",
    abbr: "LIV",
    colors: { primary: "#C8102E", secondary: "#00B2A9" },
    aliases: ["Liverpool"],
    feeds: [bbc("liverpool"), guardian("liverpool"), sky(11669)],
  },
  {
    espnId: "382",
    slug: "man-city",
    name: "Manchester City",
    shortName: "Man City",
    abbr: "MCI",
    colors: { primary: "#6CABDD", secondary: "#1C2C5B" },
    aliases: ["Manchester City", "Man City"],
    feeds: [bbc("manchester-city"), guardian("manchestercity"), sky(11679)],
  },
  {
    espnId: "360",
    slug: "man-utd",
    name: "Manchester United",
    shortName: "Man Utd",
    abbr: "MUN",
    colors: { primary: "#DA291C", secondary: "#FBE122" },
    aliases: ["Manchester United", "Man Utd", "Man United"],
    feeds: [bbc("manchester-united"), guardian("manchester-united"), sky(11667)],
  },
  {
    espnId: "361",
    slug: "newcastle",
    name: "Newcastle United",
    shortName: "Newcastle",
    abbr: "NEW",
    colors: { primary: "#241F20", secondary: "#41B6E6" },
    aliases: ["Newcastle", "Magpies"],
    feeds: [bbc("newcastle-united"), guardian("newcastleunited"), sky(11678)],
  },
  {
    espnId: "393",
    slug: "nottm-forest",
    name: "Nottingham Forest",
    shortName: "Nottm Forest",
    abbr: "NFO",
    colors: { primary: "#DD0000", secondary: "#FFFFFF" },
    aliases: ["Nottingham Forest", "Nottm Forest", "Nott'm Forest"],
    feeds: [bbc("nottingham-forest"), guardian("nottinghamforest")],
  },
  {
    espnId: "366",
    slug: "sunderland",
    name: "Sunderland",
    shortName: "Sunderland",
    abbr: "SUN",
    colors: { primary: "#EB172B", secondary: "#211E1E" },
    aliases: ["Sunderland", "Black Cats"],
    feeds: [bbc("sunderland"), guardian("sunderland"), sky(11695)],
  },
  {
    espnId: "367",
    slug: "tottenham",
    name: "Tottenham Hotspur",
    shortName: "Spurs",
    abbr: "TOT",
    colors: { primary: "#132257", secondary: "#FFFFFF" },
    aliases: ["Tottenham", "Spurs"],
    feeds: [bbc("tottenham-hotspur"), guardian("tottenham-hotspur"), sky(11675)],
  },
];

/** @param {string} slug */
export const clubBySlug = (slug) => CLUBS.find((c) => c.slug === slug) ?? null;

/** @param {string | number} espnId */
export const clubByEspnId = (espnId) => CLUBS.find((c) => c.espnId === String(espnId)) ?? null;
