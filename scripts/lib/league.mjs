// @ts-check
/**
 * league.json: gameweeks and fixtures from the official Fantasy Premier League (FPL) data, league-wide form
 * derived from FPL's finished fixtures, and goals/assists leaders from ESPN. Pure; fetch-data.mjs does the IO.
 *
 * FPL is the only source of gameweek numbers (ESPN's scoreboard has none). FPL's gameweek is the fantasy
 * round: a postponed match moves to the round it is replayed in, and has no round (`gameweek: null`) until it
 * is rescheduled. Nothing here infers a number FPL doesn't give.
 */

/** @typedef {{ slug: string, espnId: string, abbr: string }} LeagueClub */
/**
 * @typedef {{
 *   id: number, gameweek: number | null, kickoff: string | null, home: string, away: string,
 *   homeScore: number | null, awayScore: number | null, started: boolean, finished: boolean
 * }} LeagueFixture
 * @typedef {{ id: number, name: string, deadline: string | null, finished: boolean, current: boolean, next: boolean }} Gameweek
 * @typedef {{ fixture: number, result: "W" | "D" | "L", opponent: string, home: boolean, for: number, against: number, kickoff: string | null }} FormEntry
 * @typedef {{ id: string, name: string, club: string | null, value: number, matches: number | null }} Leader
 */

const isObj = (/** @type {unknown} */ v) => v !== null && typeof v === "object" && !Array.isArray(v);
const int = (/** @type {unknown} */ v) => (Number.isInteger(v) ? /** @type {number} */ (v) : null);
const iso = (/** @type {unknown} */ v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/**
 * FPL team id → club slug, matched on FPL's short name = our `abbr`. Returns the map and any FPL team that
 * matched no club (which makes the gameweek data unusable: a fixture without both clubs is never shown).
 * @param {any} bootstrap FPL bootstrap-static
 * @param {LeagueClub[]} clubs
 */
export function mapTeams(bootstrap, clubs) {
  const byAbbr = new Map(clubs.map((c) => [c.abbr, c.slug]));
  /** @type {Map<number, string>} */
  const map = new Map();
  const unmatched = [];
  for (const t of Array.isArray(bootstrap?.teams) ? bootstrap.teams : []) {
    const slug = byAbbr.get(t?.short_name);
    if (slug && int(t.id) != null) map.set(t.id, slug);
    else unmatched.push(String(t?.short_name ?? t?.name ?? "?"));
  }
  return { map, unmatched };
}

/** @param {any} bootstrap @returns {Gameweek[]} */
export function readGameweeks(bootstrap) {
  const events = Array.isArray(bootstrap?.events) ? bootstrap.events : [];
  return events
    .filter((e) => isObj(e) && int(e.id) != null)
    .map((e) => ({
      id: e.id,
      name: typeof e.name === "string" ? e.name : `Gameweek ${e.id}`,
      deadline: iso(e.deadline_time),
      finished: e.finished === true,
      current: e.is_current === true,
      next: e.is_next === true,
    }))
    .sort((a, b) => a.id - b.id);
}

/**
 * @param {any} fixtures FPL fixtures/ (all of them)
 * @param {Map<number, string>} teams
 * @returns {{ fixtures: LeagueFixture[], skipped: number }}
 */
export function readFixtures(fixtures, teams) {
  let skipped = 0;
  /** @type {LeagueFixture[]} */
  const out = [];
  for (const f of Array.isArray(fixtures) ? fixtures : []) {
    const home = teams.get(f?.team_h);
    const away = teams.get(f?.team_a);
    if (!isObj(f) || int(f.id) == null || !home || !away) {
      skipped++;
      continue;
    }
    // A score counts once FPL marks the match over (provisionally at the final whistle, then confirmed).
    const over = f.finished === true || f.finished_provisional === true;
    const hs = int(f.team_h_score);
    const as = int(f.team_a_score);
    out.push({
      id: f.id,
      gameweek: int(f.event),
      kickoff: iso(f.kickoff_time),
      home,
      away,
      homeScore: f.started === true ? hs : null,
      awayScore: f.started === true ? as : null,
      started: f.started === true,
      finished: over && hs != null && as != null,
    });
  }
  out.sort((a, b) => (a.kickoff ?? "9").localeCompare(b.kickoff ?? "9") || a.id - b.id);
  return { fixtures: out, skipped };
}

/**
 * Each club's last `n` finished league matches, oldest first.
 * @param {LeagueFixture[]} fixtures
 * @param {string[]} slugs
 * @returns {Record<string, FormEntry[]>}
 */
export function leagueForm(fixtures, slugs, n = 5) {
  /** @type {Record<string, FormEntry[]>} */
  const form = Object.fromEntries(slugs.map((s) => [s, []]));
  const done = fixtures
    .filter((f) => f.finished && f.kickoff)
    .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));
  for (const f of done) {
    const hs = /** @type {number} */ (f.homeScore);
    const as = /** @type {number} */ (f.awayScore);
    for (const [club, opp, home, gf, ga] of /** @type {const} */ ([
      [f.home, f.away, true, hs, as],
      [f.away, f.home, false, as, hs],
    ])) {
      form[club]?.push({
        fixture: f.id,
        result: gf > ga ? "W" : gf < ga ? "L" : "D",
        opponent: opp,
        home,
        for: gf,
        against: ga,
        kickoff: f.kickoff,
      });
    }
  }
  for (const s of slugs) form[s] = form[s].slice(-n);
  return form;
}

/**
 * Goals and assists leaders from ESPN's eng.1 statistics: the top `n` each, plus anyone tied with the n-th.
 * @param {any} stats
 * @param {Map<string, string>} clubByEspnId
 * @returns {{ goals: Leader[], assists: Leader[] }}
 */
export function readLeaders(stats, clubByEspnId, n = 10) {
  const list = Array.isArray(stats?.stats) ? stats.stats : [];
  /** @param {string} name */
  const pick = (name) => {
    const cat = list.find((s) => s?.name === name);
    /** @type {Leader[]} */
    const out = [];
    for (const l of Array.isArray(cat?.leaders) ? cat.leaders : []) {
      const a = l?.athlete;
      const value = typeof l?.value === "number" && Number.isFinite(l.value) ? l.value : null;
      if (!a || typeof a.id !== "string" || typeof a.displayName !== "string" || value == null) continue;
      const m = /Matches:\s*(\d+)/.exec(String(l.displayValue ?? ""));
      out.push({
        id: a.id,
        name: a.displayName,
        club: clubByEspnId.get(String(a.team?.id)) ?? null,
        value,
        matches: m ? Number(m[1]) : null,
      });
      // Keep everyone tied with the n-th player, so a cut never splits a tie (capped at 2n).
      if (out.length >= n && value !== out[n - 1]?.value) {
        out.pop();
        break;
      }
      if (out.length >= 2 * n) break;
    }
    return out;
  };
  return { goals: pick("goalsLeaders"), assists: pick("assistsLeaders") };
}

/**
 * The whole league.json. `fpl` or `stats` may be null (that source failed): its part is then omitted and
 * listed in `missing`, never filled with guesses.
 * @param {{ bootstrap: any, fixtures: any } | null} fpl
 * @param {any} stats
 * @param {LeagueClub[]} clubs
 * @param {Date} now
 * @param {SquadPlayer[]} [squads] ESPN squad players (for FPL minutes); none = minutes missing
 */
export function buildLeague(fpl, stats, clubs, now, squads = []) {
  const problems = [];
  const missing = [];
  /** @type {any} */
  const out = {
    generatedAt: now.toISOString(),
    season: null,
    gameweeks: null,
    fixtures: null,
    form: null,
    leaders: null,
    minutes: null,
  };
  if (fpl) {
    const { map, unmatched } = mapTeams(fpl.bootstrap, clubs);
    if (unmatched.length || map.size !== clubs.length) {
      problems.push(`FPL teams not matched to clubs: ${unmatched.join(", ") || `${map.size} of ${clubs.length}`}`);
      missing.push("gameweeks", "form", "minutes");
    } else {
      const { fixtures, skipped } = readFixtures(fpl.fixtures, map);
      if (skipped) problems.push(`${skipped} FPL fixtures skipped as malformed`);
      out.gameweeks = readGameweeks(fpl.bootstrap);
      out.fixtures = fixtures;
      out.form = leagueForm(
        fixtures,
        clubs.map((c) => c.slug),
      );
      if (squads.length) {
        const m = fplMinutes(fpl.bootstrap, map, squads);
        out.minutes = m.minutes;
        if (m.unmatched)
          problems.push(`${m.unmatched} of ${m.total} squad players have no FPL match (minutes unknown)`);
      } else missing.push("minutes");
    }
  } else missing.push("gameweeks", "form", "minutes");
  if (stats) {
    out.season = typeof stats?.season?.displayName === "string" ? stats.season.displayName : null;
    out.leaders = readLeaders(stats, new Map(clubs.map((c) => [c.espnId, c.slug])));
  } else missing.push("leaders");
  const asOf = Object.fromEntries(PARTS.map((p) => [p, missing.includes(p) ? null : out.generatedAt]));
  return { league: { ...out, asOf, missing, carriedOver: [] }, problems };
}

/** The parts of league.json, the fields each one owns, and so what can be carried over on its own. */
const PARTS = /** @type {const} */ (["gameweeks", "form", "leaders", "minutes"]);
/** @type {Record<string, string[]>} */
const FIELDS = {
  gameweeks: ["gameweeks", "fixtures"],
  form: ["form"],
  leaders: ["leaders", "season"],
  minutes: ["minutes"],
};

/** @typedef {{ id: string, name: string, lastName: string | null, club: string }} SquadPlayer */

/** Lower case, accents folded, punctuation as spaces: "Ødegaard" → "odegaard". @param {unknown} s */
const fold = (s) =>
  String(s ?? "")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[łŁ]/g, "l")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Minutes (and starts) per ESPN player id, from FPL's player list. A player is matched only inside his own
 * club, and only by: the same full name (spaces ignored); or the same surname, or ESPN's surname equal to the last
 * word of FPL's ("Fernandes" in "Borges Fernandes"), unique in both squads; or FPL's short "web name" equal to his
 * ESPN surname or full name, unique in both squads. Anyone else gets no entry: minutes unknown,
 * never 0 and never a nearest guess.
 * @param {any} bootstrap
 * @param {Map<number, string>} teams FPL team id → club slug
 * @param {SquadPlayer[]} squads
 */
export function fplMinutes(bootstrap, teams, squads) {
  /** @type {Map<string, any[]>} */
  const fplByClub = new Map();
  for (const e of Array.isArray(bootstrap?.elements) ? bootstrap.elements : []) {
    const club = teams.get(e?.team);
    if (!club || int(e.id) == null || int(e.minutes) == null) continue;
    fplByClub.set(club, [...(fplByClub.get(club) ?? []), e]);
  }
  /** @type {Record<string, { fpl: number, minutes: number, starts: number | null }>} */
  const minutes = {};
  let unmatched = 0;
  const byClub = new Map();
  for (const p of squads) byClub.set(p.club, [...(byClub.get(p.club) ?? []), p]);
  for (const [club, players] of byClub) {
    const fpl = fplByClub.get(club) ?? [];
    const count = (/** @type {string[]} */ keys) => {
      const m = new Map();
      for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
      return m;
    };
    const squash = (/** @type {unknown} */ x) => fold(x).replace(/ /g, "");
    // FPL often lists every family name ("Borges Fernandes"); ESPN uses the one players are known by.
    const lastWord = (/** @type {unknown} */ x) => fold(x).split(" ").pop() ?? "";
    const espnSurnames = count(players.map((p) => squash(p.lastName)));
    const fplSurnames = count(fpl.map((e) => squash(e.second_name)));
    const fplLastWords = count(fpl.map((e) => lastWord(e.second_name)));
    const fplWeb = count(fpl.map((e) => fold(e.web_name)));
    const used = new Set();
    for (const p of players) {
      const full = fold(p.name);
      const last = squash(p.lastName);
      const uniqueHere = last && espnSurnames.get(last) === 1;
      const pick =
        fpl.find((e) => squash(`${e.first_name} ${e.second_name}`) === squash(p.name)) ??
        (uniqueHere && fplSurnames.get(last) === 1 ? fpl.find((e) => squash(e.second_name) === last) : undefined) ??
        (uniqueHere && fplLastWords.get(last) === 1 ? fpl.find((e) => lastWord(e.second_name) === last) : undefined) ??
        fpl.find((e) => {
          const w = fold(e.web_name);
          return fplWeb.get(w) === 1 && (w === full || (w === last && espnSurnames.get(last) === 1));
        });
      if (pick && !used.has(pick.id)) {
        used.add(pick.id);
        minutes[p.id] = { fpl: pick.id, minutes: pick.minutes, starts: int(pick.starts) };
      } else unmatched++;
    }
  }
  return { minutes, unmatched, total: squads.length };
}

/**
 * Fills parts this run couldn't fetch from the previously deployed league.json, keeping that copy's own date
 * in `asOf`, so the site shows older but real data (labelled with its age) instead of nothing.
 * @param {any} league  this run's league.json
 * @param {any} previous the live league.json, or null
 */
export function carryOver(league, previous) {
  if (!isObj(previous)) return league;
  const next = { ...league, asOf: { ...league.asOf }, missing: [], carriedOver: [...(league.carriedOver ?? [])] };
  for (const part of league.missing) {
    const fields = FIELDS[part] ?? [];
    const when = iso(previous.asOf?.[part]) ?? iso(previous.generatedAt);
    if (when && fields.every((f) => previous[f] != null) && !(previous.missing ?? []).includes(part)) {
      for (const f of fields) next[f] = previous[f];
      next.asOf[part] = when;
      next.carriedOver.push(part);
    } else next.missing.push(part);
  }
  return next;
}
