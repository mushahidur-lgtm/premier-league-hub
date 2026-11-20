// @ts-check
/**
 * Checks for the pipeline's output, run before anything is written (so a malformed or unsafe file is
 * never deployed), plus the health floor and error wording. Pure functions, no dependencies.
 */

/** IPv4, or IPv6 with at least four groups (so times like "10:00:00" in dates and messages don't match). */
const ADDRESS_SRC = String.raw`\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|\[[0-9a-f]*:[0-9a-f:]*\]`;
const ADDRESS = new RegExp(ADDRESS_SRC, "i");
const ADDRESSES = new RegExp(ADDRESS_SRC, "gi");
const SECRET_PARAM = /([?&](?:access_?token|api_?key|apikey|token|key|secret|password|sig|signature)=)[^&\s"]*/gi;
/** Things that look like credentials in a URL or message. */
const SECRET =
  /(?:[?&](?:access_?token|api_?key|apikey|token|key|secret|password|sig|signature)=)|authorization:|bearer\s/i;

/** @param {unknown} v */
const isIso = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));
/** @param {unknown} v */
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** @param {unknown} v */
const isCount = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= 0;

/**
 * A failure message safe to publish: the error's message plus its cause's code (Node's fetch says only
 * "fetch failed"), with any IP address or credential-like text removed.
 * @param {unknown} err
 * @param {number} timeoutMs
 */
export function describeError(err, timeoutMs) {
  const e = /** @type {any} */ (err);
  if (e?.name === "TimeoutError") return `Timed out after ${timeoutMs / 1000}s`;
  const code = e?.cause?.code ?? e?.code;
  const message = String(e?.message ?? e ?? "Unknown error");
  const text = code && !message.includes(code) ? `${message} (${code})` : message;
  return redact(text).slice(0, 200);
}

/** Replaces IP addresses and credential-looking query parameters. @param {string} text */
export function redact(text) {
  return text.replace(ADDRESSES, "[address]").replace(SECRET_PARAM, "$1[redacted]");
}

/**
 * Problems with a news.json object; [] when it is fine.
 * @param {any} news
 * @param {{ clubSlugs: Set<string> }} ctx
 * @returns {string[]}
 */
export function validateNews(news, { clubSlugs }) {
  const p = [];
  if (!isObj(news)) return ["news.json is not an object"];
  if (!isIso(news.generatedAt)) p.push("generatedAt is not a date");
  if (!isObj(news.outlets) || !Object.keys(news.outlets).length) p.push("outlets missing");
  if (!Array.isArray(news.items)) return [...p, "items is not an array"];
  const outlets = new Set(Object.keys(news.outlets ?? {}));
  const ids = new Set();
  news.items.forEach((/** @type {any} */ it, /** @type {number} */ i) => {
    const at = `items[${i}]`;
    if (!isObj(it)) return p.push(`${at} is not an object`);
    if (typeof it.id !== "string" || !it.id) p.push(`${at}.id missing`);
    else if (ids.has(it.id)) p.push(`${at}.id duplicated (${it.id})`);
    else ids.add(it.id);
    if (typeof it.title !== "string" || !it.title.trim()) p.push(`${at}.title missing`);
    if (typeof it.link !== "string" || !/^https?:\/\//.test(it.link)) p.push(`${at}.link is not a web address`);
    if (it.date !== null && !isIso(it.date)) p.push(`${at}.date is not a date`);
    if (!outlets.has(it.outlet)) p.push(`${at}.outlet unknown (${it.outlet})`);
    if (!Array.isArray(it.clubs) || it.clubs.some((/** @type {any} */ c) => !clubSlugs.has(c)))
      p.push(`${at}.clubs has an unknown club`);
    if (!Array.isArray(it.players) || it.players.some((/** @type {any} */ id) => !/^\d+$/.test(String(id))))
      p.push(`${at}.players is not a list of ESPN ids`);
    if (it.also !== undefined && !Array.isArray(it.also)) p.push(`${at}.also is not a list`);
    for (const f of ["image", "excerpt", "author"])
      if (it[f] != null && typeof it[f] !== "string") p.push(`${at}.${f} is not text`);
    if (typeof it.link === "string" && SECRET.test(it.link)) p.push(`${at}.link carries a credential-like parameter`);
  });
  return p;
}

/**
 * Problems with a meta.json object; [] when it is fine. `rosters` is optional (older files lack it).
 * @param {any} meta
 * @returns {string[]}
 */
export function validateMeta(meta) {
  const p = [];
  if (!isObj(meta)) return ["meta.json is not an object"];
  if (!isIso(meta.generatedAt)) p.push("generatedAt is not a date");
  if (!isObj(meta.counts)) p.push("counts missing");
  else for (const [k, v] of Object.entries(meta.counts)) if (!isCount(v)) p.push(`counts.${k} is not a count`);
  if (!Array.isArray(meta.feeds)) p.push("feeds is not an array");
  else
    meta.feeds.forEach((/** @type {any} */ f, /** @type {number} */ i) => {
      if (!isObj(f) || typeof f.ok !== "boolean" || typeof f.url !== "string") p.push(`feeds[${i}] malformed`);
    });
  if (meta.rosters !== undefined && !Array.isArray(meta.rosters)) p.push("rosters is not an array");
  const text = JSON.stringify(meta);
  if (ADDRESS.test(text)) p.push("meta.json contains an IP address");
  if (SECRET.test(text)) p.push("meta.json contains something that looks like a credential");
  return p;
}

/**
 * Is this run good enough to deploy? "failed" means: keep the site that is live now (the job exits non-zero,
 * so GitLab does not publish). "degraded" deploys, with the reasons in meta.json.
 *   failed    fewer than half the feeds worked, or fewer than `minItems` stories survived
 *   degraded  any feed or squad failed
 * @param {{ feeds: number, feedsOk: number, items: number, rosters: number, rostersOk: number }} c
 * @param {{ minFeedShare?: number, minItems?: number }} [floor]
 * @returns {{ status: "ok" | "degraded" | "failed", problems: string[] }}
 */
export function runHealth(c, { minFeedShare = 0.5, minItems = 100 } = {}) {
  const problems = [];
  let failed = false;
  if (c.feedsOk < c.feeds * minFeedShare) {
    failed = true;
    problems.push(`only ${c.feedsOk} of ${c.feeds} feeds worked (need at least ${Math.ceil(c.feeds * minFeedShare)})`);
  }
  if (c.items < minItems) {
    failed = true;
    problems.push(`only ${c.items} stories (need at least ${minItems})`);
  }
  if (!failed && c.feedsOk < c.feeds) problems.push(`${c.feeds - c.feedsOk} of ${c.feeds} feeds failed`);
  if (c.rostersOk < c.rosters) problems.push(`${c.rosters - c.rostersOk} of ${c.rosters} squads failed`);
  return { status: failed ? "failed" : problems.length ? "degraded" : "ok", problems };
}

const RESULTS = new Set(["W", "D", "L"]);
const PART_NAMES = new Set(["gameweeks", "form", "leaders", "minutes"]);

/**
 * Problems with a league.json object; [] when it is fine. Each part may be null only if it is listed in
 * `missing`.
 * @param {any} league
 * @param {{ clubSlugs: Set<string> }} ctx
 * @returns {string[]}
 */
export function validateLeague(league, { clubSlugs }) {
  const p = [];
  if (!isObj(league)) return ["league.json is not an object"];
  if (!isIso(league.generatedAt)) p.push("generatedAt is not a date");
  if (!Array.isArray(league.missing) || league.missing.some((/** @type {any} */ m) => !PART_NAMES.has(m)))
    p.push("missing is not a list of parts");
  if (!Array.isArray(league.carriedOver)) p.push("carriedOver is not a list");
  if (!isObj(league.asOf)) p.push("asOf missing");
  const missing = new Set(Array.isArray(league.missing) ? league.missing : []);
  const club = (/** @type {any} */ s) => clubSlugs.has(s);
  const need = (/** @type {string} */ part, /** @type {boolean} */ ok, /** @type {string} */ what) => {
    if (missing.has(part)) return;
    if (!ok) p.push(what);
    else if (!isIso(league.asOf?.[part])) p.push(`asOf.${part} is not a date`);
  };

  const gwOk =
    Array.isArray(league.gameweeks) &&
    league.gameweeks.every(
      (/** @type {any} */ g) => isObj(g) && Number.isInteger(g.id) && typeof g.name === "string",
    ) &&
    Array.isArray(league.fixtures) &&
    league.fixtures.every(
      (/** @type {any} */ f) =>
        isObj(f) &&
        Number.isInteger(f.id) &&
        (f.gameweek === null || Number.isInteger(f.gameweek)) &&
        (f.kickoff === null || isIso(f.kickoff)) &&
        club(f.home) &&
        club(f.away) &&
        (f.homeScore === null || Number.isInteger(f.homeScore)) &&
        (f.awayScore === null || Number.isInteger(f.awayScore)),
    );
  need("gameweeks", gwOk, "gameweeks or fixtures malformed");

  const formOk =
    isObj(league.form) &&
    Object.entries(league.form).every(
      ([slug, list]) =>
        club(slug) &&
        Array.isArray(list) &&
        list.every((/** @type {any} */ e) => isObj(e) && RESULTS.has(e.result) && club(e.opponent)),
    );
  need("form", formOk, "form malformed");

  const leaderList = (/** @type {any} */ l) =>
    Array.isArray(l) &&
    l.every(
      (/** @type {any} */ x) =>
        isObj(x) && /^\d+$/.test(String(x.id)) && typeof x.name === "string" && typeof x.value === "number",
    );
  need(
    "leaders",
    isObj(league.leaders) && leaderList(league.leaders.goals) && leaderList(league.leaders.assists),
    "leaders malformed",
  );
  const minutesOk =
    isObj(league.minutes) &&
    Object.entries(league.minutes).every(
      ([id, m]) =>
        /^\d+$/.test(id) &&
        isObj(m) &&
        Number.isInteger(m.fpl) &&
        isCount(m.minutes) &&
        (m.starts === null || isCount(m.starts)),
    );
  need("minutes", minutesOk, "minutes malformed");
  return p;
}

const STAT_PARTS = new Set(["current", "previous", "players"]);
const TEAM_STATUS = new Set(["ok", "absent", "unavailable"]);
const numOrNull = (/** @type {unknown} */ v) => v === null || (typeof v === "number" && Number.isFinite(v));

/**
 * Problems with a stats.json object; [] when it is fine.
 * @param {any} stats
 * @param {{ clubSlugs: Set<string> }} ctx
 * @returns {string[]}
 */
export function validateStats(stats, { clubSlugs }) {
  const p = [];
  if (!isObj(stats)) return ["stats.json is not an object"];
  if (!isIso(stats.generatedAt)) p.push("generatedAt is not a date");
  if (!Array.isArray(stats.missing) || stats.missing.some((/** @type {any} */ m) => !STAT_PARTS.has(m)))
    p.push("missing is not a list of parts");
  if (!Array.isArray(stats.carriedOver)) p.push("carriedOver is not a list");
  if (!isObj(stats.asOf)) p.push("asOf missing");
  const missing = new Set(Array.isArray(stats.missing) ? stats.missing : []);
  if (!Array.isArray(stats.seasons)) return [...p, "seasons is not a list"];
  for (const s of stats.seasons) {
    if (!isObj(s) || !STAT_PARTS.has(s.part) || !Number.isInteger(s.year) || typeof s.label !== "string") {
      p.push("season malformed");
      continue;
    }
    if (missing.has(s.part)) continue;
    if (!isIso(stats.asOf?.[s.part])) p.push(`asOf.${s.part} is not a date`);
    const ok =
      isObj(s.teams) &&
      Object.entries(s.teams).every(
        ([slug, t]) =>
          clubSlugs.has(slug) &&
          isObj(t) &&
          TEAM_STATUS.has(t.status) &&
          (t.status !== "ok" || (isObj(t.stats) && Object.values(t.stats).every(numOrNull))),
      );
    if (!ok) p.push(`${s.part} teams malformed`);
  }
  if (!missing.has("players")) {
    if (!isIso(stats.asOf?.players)) p.push("asOf.players is not a date");
    const ok =
      Array.isArray(stats.players) &&
      stats.players.every(
        (/** @type {any} */ x) =>
          isObj(x) &&
          /^\d+$/.test(x.id) &&
          typeof x.name === "string" &&
          clubSlugs.has(x.club) &&
          ["apps", "goals", "assists", "minutes", "xg", "xa"].every((k) => numOrNull(x[k])),
      );
    if (!ok) p.push("players malformed");
  }
  return p;
}

const FPL_POSITIONS = new Set(["GKP", "DEF", "MID", "FWD"]);
const FPL_STATUSES = new Set(["a", "d", "i", "s", "u", "n"]);
const intOrNull = (/** @type {unknown} */ v) => v === null || Number.isInteger(v);

/**
 * Problems with an fpl.json object; [] when it is fine.
 * @param {any} fpl
 * @param {{ clubSlugs: Set<string> }} ctx
 * @returns {string[]}
 */
export function validateFpl(fpl, { clubSlugs }) {
  const p = [];
  if (!isObj(fpl)) return ["fpl.json is not an object"];
  if (!isIso(fpl.generatedAt)) p.push("generatedAt is not a date");
  if (!isIso(fpl.asOf)) p.push("asOf is not a date");
  if (typeof fpl.carriedOver !== "boolean") p.push("carriedOver is not a boolean");
  const r = fpl.rules;
  if (!isObj(r) || !["squadSize", "perClub", "budget"].every((k) => intOrNull(r[k])) || !numOrNull(r.sellOnFee))
    p.push("rules malformed");
  const gw = (/** @type {any} */ g) =>
    g === null || (isObj(g) && Number.isInteger(g.id) && (g.deadline === null || isIso(g.deadline)));
  if (!isObj(fpl.gameweeks) || !gw(fpl.gameweeks.current) || !gw(fpl.gameweeks.next)) p.push("gameweeks malformed");
  if (!Array.isArray(fpl.players) || fpl.players.length < 100) p.push("players missing or too few");
  else {
    const bad = fpl.players.filter(
      (/** @type {any} */ x) =>
        !isObj(x) ||
        !Number.isInteger(x.id) ||
        typeof x.name !== "string" ||
        typeof x.fullName !== "string" ||
        !clubSlugs.has(x.club) ||
        !FPL_POSITIONS.has(x.pos) ||
        !isCount(x.price) ||
        !FPL_STATUSES.has(x.status) ||
        typeof x.news !== "string" ||
        !(x.espn === null || (typeof x.espn === "string" && /^\d+$/.test(x.espn))) ||
        !["owned", "ppg", "form", "xg", "xa", "ep"].every((k) => numOrNull(x[k])) ||
        !["points", "minutes", "starts", "chance"].every((k) => intOrNull(x[k])),
    );
    if (bad.length) p.push(`${bad.length} players malformed`);
  }
  if (!isObj(fpl.clubs) || Object.keys(fpl.clubs).length !== clubSlugs.size) p.push("clubs missing");
  else
    for (const [slug, c] of Object.entries(fpl.clubs)) {
      const ok =
        clubSlugs.has(slug) &&
        isObj(c) &&
        isCount(c.played) &&
        Array.isArray(c.fixtures) &&
        c.fixtures.every(
          (/** @type {any} */ f) =>
            isObj(f) &&
            intOrNull(f.gw) &&
            (f.kickoff === null || isIso(f.kickoff)) &&
            clubSlugs.has(f.opp) &&
            typeof f.home === "boolean" &&
            (f.fdr === null || (Number.isInteger(f.fdr) && f.fdr >= 1 && f.fdr <= 5)),
        );
      if (!ok) p.push(`clubs.${slug} malformed`);
    }
  const text = JSON.stringify(fpl);
  if (ADDRESS.test(text)) p.push("fpl.json contains an IP address");
  return p;
}
