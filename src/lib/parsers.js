// @ts-check
/**
 * ESPN response parsers. Each one validates what it is given:
 *   - wrong overall structure  -> FetchError "data" (the section shows an error + Retry)
 *   - one malformed record     -> skipped and counted in diagnostics
 *   - missing / malformed field -> null or empty, never 0 and never a guess
 */
import { availabilityOf } from "./availability.js";
import { noteDropped } from "./diagnostics.js";
import { arr, date, expectArray, expectObject, isObj, keepValid, num, str } from "./validate.js";

export { num };

export const logoOf = (team) =>
  str(team?.logos?.[0]?.href) ||
  str(team?.logo) ||
  (team?.id != null ? `https://a.espncdn.com/i/teamlogos/soccer/500/${team.id}.png` : null);

/** League slug -> readable competition names. */
const COMPETITIONS = {
  "eng.1": { name: "Premier League", short: "PL" },
  "uefa.champions": { name: "Champions League", short: "UCL" },
  "eng.fa": { name: "FA Cup", short: "FA Cup" },
  "eng.league_cup": { name: "Carabao Cup", short: "Carabao" },
  "uefa.europa": { name: "Europa League", short: "UEL" },
  "uefa.europa.conf": { name: "Conference League", short: "UECL" },
  "eng.charity": { name: "Community Shield", short: "Shield" },
};
/** Pre-season and club friendlies (ESPN files them under slugs such as "club.friendly"). */
export const isFriendlySlug = (slug = "") => /friendly|club[.]|preseason/i.test(slug);

export function competitionOf(slug, fallback) {
  if (COMPETITIONS[slug]) return COMPETITIONS[slug];
  if (isFriendlySlug(slug)) return { name: "Friendly", short: "Friendly" };
  return { name: fallback || "Match", short: fallback || "Match" };
}

/* ───────────────────────── Fixtures and results ───────────────────────── */

/**
 * One schedule or scoreboard event -> match, or null when it can't be shown (no id). `date` is null
 * when ESPN's is missing/invalid.
 *
 * `teamId` is the ESPN id of the club whose point of view this is (a club's schedule): it fills
 * `team`, `opp`, `isHome` and `result`. Without it (league-wide fixtures) those are all null.
 * @param {any} e
 * @param {string | null} [teamId]
 */
export function parseEvent(e, teamId = null) {
  if (!isObj(e) || e.id == null) return null;
  const comp = isObj(e.competitions?.[0]) ? e.competitions[0] : {};
  const status = isObj(comp.status?.type) ? comp.status.type : isObj(e.status?.type) ? e.status.type : {};
  const sides = arr(comp.competitors)
    .filter(isObj)
    .map((c) => ({
      id: str(c.team?.id) ?? str(c.id),
      name: str(c.team?.displayName) ?? str(c.team?.name) ?? "TBD",
      short: str(c.team?.shortDisplayName) ?? str(c.team?.displayName),
      abbr: str(c.team?.abbreviation) ?? "",
      logo: logoOf(c.team),
      homeAway: c.homeAway,
      score: num(c.score),
      shootout: num(c.shootoutScore),
    }));
  const team = teamId ? (sides.find((s) => s.id === teamId) ?? null) : null;
  const opp = team ? (sides.find((s) => s !== team) ?? null) : null;
  const home = sides.find((s) => s.homeAway === "home") ?? sides[0];
  const away = sides.find((s) => s.homeAway === "away") ?? sides[1];
  const state = ["pre", "in", "post"].includes(status.state) ? status.state : "pre";
  let result = null;
  if (state === "post" && team?.score != null && opp?.score != null) {
    if (team.score > opp.score) result = "W";
    else if (team.score < opp.score) result = "L";
    else if (team.shootout != null && opp.shootout != null) result = team.shootout > opp.shootout ? "W" : "L";
    else result = "D";
  }
  const slug = str(e.league?.slug) ?? str(comp.league?.slug) ?? "";
  const c = competitionOf(slug, str(e.league?.abbreviation) || str(e.league?.name) || str(comp.type?.text));
  return {
    id: String(e.id),
    date: date(e.date),
    leagueSlug: slug,
    competition: c.name,
    compShort: c.short,
    friendly: isFriendlySlug(slug),
    venue: str(comp.venue?.fullName),
    city: str(comp.venue?.address?.city),
    state,
    completed: !!status.completed,
    statusDetail: str(status.shortDetail) ?? str(status.detail) ?? str(status.description),
    clock: str(comp.status?.displayClock),
    postponed: /postponed|canceled|cancelled/i.test(`${status.name ?? ""} ${status.description ?? ""}`.trim()),
    isHome: team ? team.homeAway === "home" : null,
    sideCount: sides.length,
    home,
    away,
    team,
    opp,
    result,
  };
}

/**
 * Schedule or scoreboard responses -> { results, fixtures }. At least one response must have the
 * expected structure (an `events` array); events without an id, a valid kick-off time or two teams
 * are skipped. Pass the club's ESPN id for a club schedule, or null for league-wide events.
 * @param {any[]} jsons
 * @param {string | null} [teamId]
 */
export function parseSchedules(jsons, teamId = null) {
  const valid = arr(jsons).filter((j) => isObj(j) && Array.isArray(j.events));
  if (!valid.length) expectArray(undefined, "schedule events");
  const byId = new Map();
  let dropped = 0;
  for (const j of valid) {
    for (const e of j.events) {
      const m = parseEvent(e, teamId);
      // No usable kick-off time can't be placed on a calendar, and an Invalid Date would be cached as
      // null and crash date maths on the next visit; fewer than two teams can't be rendered.
      if (!m || !m.date || m.sideCount < 2) {
        dropped++;
        continue;
      }
      byId.set(m.id, m);
    }
  }
  if (dropped) noteDropped("schedule", dropped);
  const all = [...byId.values()];
  const results = all.filter((m) => m.state === "post" && !m.postponed).sort((a, b) => b.date - a.date);
  const fixtures = all.filter((m) => m.state !== "post").sort((a, b) => a.date - b.date);
  return { results, fixtures, dropped };
}

/* ───────────────────────── Squad ───────────────────────── */

const groupOf = (p) => {
  const a = (str(p?.abbreviation) || str(p?.name) || "").toUpperCase();
  if (!a) return "Other"; // no position given: don't guess one
  if (a.startsWith("G")) return "Goalkeepers";
  if (a.startsWith("D")) return "Defenders";
  if (a.startsWith("M")) return "Midfielders";
  return "Forwards";
};
const GROUP_ORDER = { Goalkeepers: 0, Defenders: 1, Midfielders: 2, Forwards: 3, Other: 4 };

export function parseRoster(json) {
  expectObject(json, "roster");
  const athletes = keepValid(
    expectArray(json.athletes, "roster athletes"),
    (a) => isObj(a) && a.id != null && str(a.displayName),
    "roster",
  );
  const players = athletes.map((a) => {
    const stats = {};
    for (const cat of arr(a.statistics?.splits?.categories))
      for (const s of arr(cat?.stats)) if (isObj(s) && s.name) stats[s.name] = num(s.value);
    return {
      id: String(a.id),
      name: a.displayName,
      shortName: str(a.shortName),
      lastName: str(a.lastName) ?? a.displayName,
      jersey: str(a.jersey) ?? "",
      position: str(a.position?.displayName) ?? str(a.position?.name) ?? "",
      group: groupOf(a.position),
      age: num(a.age),
      nationality: str(a.citizenship),
      dob: date(a.dateOfBirth),
      birthPlace: [str(a.birthPlace?.city), str(a.birthPlace?.country)].filter(Boolean).join(", ") || null,
      height: str(a.displayHeight),
      weight: str(a.displayWeight),
      season: str(json.season?.displayName),
      flag: str(a.flag?.href) ?? undefined,
      // ESPN only supplies a headshot for a few players; guessed URLs 404, so none is invented.
      photo: str(a.headshot?.href),
      link: arr(a.links).find((l) => isObj(l) && arr(l.rel).includes("playercard"))?.href,
      availability: availabilityOf(a),
      stats,
    };
  });
  players.sort(
    (x, y) => GROUP_ORDER[x.group] - GROUP_ORDER[y.group] || (Number(x.jersey) || 99) - (Number(y.jersey) || 99),
  );
  return { players };
}

/* ───────────────────────── Standings ───────────────────────── */

export function parseStandings(json) {
  expectObject(json, "standings");
  const entries = expectArray(json.children?.[0]?.standings?.entries ?? json.standings?.entries, "standings entries");
  const rows = keepValid(entries, (e) => isObj(e) && e.team?.id != null, "standings").map((e) => {
    const s = Object.fromEntries(
      arr(e.stats)
        .filter((x) => isObj(x) && x.name)
        .map((x) => [x.name, num(x.value) ?? num(x.displayValue)]),
    );
    return {
      id: String(e.team.id),
      name: str(e.team.displayName),
      short: str(e.team.shortDisplayName) ?? str(e.team.displayName),
      abbr: str(e.team.abbreviation),
      logo: logoOf(e.team),
      rank: s.rank ?? undefined,
      gp: s.gamesPlayed ?? undefined,
      w: s.wins ?? undefined,
      d: s.ties ?? undefined,
      l: s.losses ?? undefined,
      gf: s.pointsFor ?? undefined,
      ga: s.pointsAgainst ?? undefined,
      gd: s.pointDifferential ?? undefined,
      pts: s.points ?? undefined,
      note: isObj(e.note) ? { color: e.note.color, label: e.note.description } : null,
    };
  });
  rows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return { rows, season: str(json.season?.displayName) || str(json.children?.[0]?.name) || str(json.name) };
}

/* ───────────────────────── Match detail ───────────────────────── */

const STAT_ROWS = [
  ["possessionPct", "Possession", "%"],
  ["totalShots", "Shots"],
  ["shotsOnTarget", "Shots on target"],
  ["wonCorners", "Corners"],
  ["passPct", "Pass accuracy", "pct"],
  ["saves", "Saves"],
  ["foulsCommitted", "Fouls"],
  ["offsides", "Offsides"],
  ["yellowCards", "Yellow cards"],
  ["redCards", "Red cards"],
];

function rosterPlayer(p) {
  return {
    id: p.athlete?.id,
    name: str(p.athlete?.displayName),
    jersey: str(p.jersey),
    position: str(p.position?.abbreviation) ?? "",
    positionName: str(p.position?.displayName) ?? "",
    place: p.formationPlace ? num(p.formationPlace) : null,
    subbedIn: !!p.subbedIn,
    subbedOut: !!p.subbedOut,
    stats: Object.fromEntries(
      arr(p.stats)
        .filter((s) => isObj(s) && s.name)
        .map((s) => [s.name, num(s.value)]),
    ),
  };
}

/** ESPN match summary -> lineups, events and team stats. Missing pieces stay empty. */
export function parseSummary(json) {
  expectObject(json, "match summary");
  const header = json.header?.competitions?.[0];
  const teams = arr(json.boxscore?.teams)
    .filter(isObj)
    .map((t) => ({
      id: String(t.team?.id),
      name: str(t.team?.displayName),
      stats: Object.fromEntries(
        arr(t.statistics)
          .filter((s) => isObj(s) && s.name)
          .map((s) => [s.name, num(s.displayValue)]),
      ),
    }));
  const stats =
    teams.length === 2
      ? STAT_ROWS.filter(([k]) => teams.every((t) => t.stats[k] != null)).map(([k, label, unit]) => {
          const fmt = (v) => (unit === "pct" ? `${Math.round(v * 100)}%` : unit === "%" ? `${v}%` : String(v));
          return {
            key: k,
            label,
            home: teams[0].stats[k],
            away: teams[1].stats[k],
            fmt,
            teamIds: [teams[0].id, teams[1].id],
          };
        })
      : [];
  const lineups = arr(json.rosters)
    .filter(isObj)
    .map((r) => ({
      teamId: String(r.team?.id),
      team: str(r.team?.displayName),
      formation: str(r.formation),
      starters: arr(r.roster)
        .filter((p) => isObj(p) && p.starter && isObj(p.athlete))
        .map(rosterPlayer),
      subs: arr(r.roster)
        .filter((p) => isObj(p) && !p.starter && isObj(p.athlete))
        .map(rosterPlayer),
    }))
    .filter((l) => l.starters.length);
  const events = arr(json.keyEvents)
    .filter(isObj)
    .flatMap((k) => {
      const type = str(k.type?.type) ?? "";
      const kind = k.scoringPlay
        ? /own/i.test(k.type?.text ?? "")
          ? "own-goal"
          : /penalty/i.test(k.type?.text ?? "")
            ? "penalty"
            : "goal"
        : /yellow/.test(type)
          ? "yellow"
          : /red/.test(type)
            ? "red"
            : type === "substitution"
              ? "sub"
              : null;
      if (!kind) return [];
      const names = arr(k.participants)
        .map((p) => str(p?.athlete?.displayName))
        .filter(Boolean);
      let primary = names[0] ?? null;
      let secondary = names[1] ?? null;
      if (kind === "sub") {
        // "Substitution, <club>. A replaces B."
        const m = (k.text ?? "").match(/\.\s*(.+?) replaces (.+?)(?:\s+because.*)?\.?$/);
        if (m) {
          primary = m[1];
          secondary = m[2];
        }
      }
      return [
        {
          id: k.id,
          kind,
          minute: str(k.clock?.displayValue) ?? "",
          teamId: String(k.team?.id ?? ""),
          primary,
          secondary, // assist for goals (only when ESPN names one), player off for subs
          text: k.text,
        },
      ];
    });
  // Teams, score and kick-off for the match centre header, read like any schedule event.
  const match = isObj(header)
    ? parseEvent({
        id: json.header?.id ?? header.id,
        date: header.date,
        league: json.header?.league,
        competitions: [header],
      })
    : null;
  return {
    match,
    status: header?.status?.type,
    clock: header?.status?.displayClock,
    stats,
    lineups,
    events,
    // Top performer per stat category per team, as published by ESPN.
    leaders: arr(json.leaders)
      .filter(isObj)
      .map((l) => ({
        teamId: String(l.team?.id),
        items: arr(l.leaders)
          .filter(isObj)
          .flatMap((c) =>
            arr(c.leaders)
              .slice(0, 1)
              .map((x) => ({
                label: c.displayName,
                value: x?.displayValue,
                name: str(x?.athlete?.displayName),
                detail: x?.summary ?? null,
              })),
          )
          .filter((x) => x.name),
      }))
      .filter((l) => l.items.length),
    recap: str(json.article?.headline)
      ? {
          headline: json.article.headline,
          description: str(json.article.description) ?? "",
          link: json.article.links?.web?.href ?? null,
          source: "ESPN",
        }
      : null,
    attendance: json.gameInfo?.attendance ?? null,
    referee: str(json.gameInfo?.officials?.[0]?.displayName),
    venue: str(json.gameInfo?.venue?.fullName),
  };
}
