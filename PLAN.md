# PLAN.md

Living plan for Premier League Hub. Tick items as they're done; record decisions and prompt corrections here.

## Scope (version 1)

- **League home** (`#/`): live table (form, GD, qualification/relegation zones), this gameweek's fixtures/results in the
  viewer's timezone, top stories across the league, "pick your club" entry point.
- **Club pages** (`#/club/<slug>`, all 20): next match + countdown, last result, table position + form, club news with
  source credibility, squad with availability, fixtures and results.
- **Match centre** (`#/match/<event-id>`): lineups, formation pitch, events, team stats.
- **My club**: picker stored in `localStorage`; home leads with that club; UI takes its colours as an accent (AA
  contrast).
- **Search** (`#/search?q=`) across clubs, players and stories.
- Footer disclaimer (unofficial; data from ESPN; news links to original outlets).

Not in v1: club history, women's teams, fan predictions, full transfer tracker (Phase 4 adds a simplified one),
accounts/backend, Premier League logo or wordmark.

## Folder structure (target)

```
.gitlab-ci.yml                Phase 1
scripts/fetch-data.mjs        Phase 1: news pipeline (Node 22, no deps)
public/data/                  generated: news.json, meta.json (git-ignored)
src/
  main.jsx, App.jsx           shell, hash router, lazy routes
  index.css                   Tailwind + theme tokens (club accent via CSS variables)
  config/site.js              BASE path, site name
  config/clubs.js             Phase 1: 20 clubs (ESPN id, slug, names, colours, crest, verified feeds)
  lib/                        pure, @ts-check: route, net, cache, validate, errors, parsers, news, sources,
                              standings, format, pitch, storage, availability (Phase 2 ports)
  components/                 Phase 3: ui primitives, home, club, match, search, pitch
tests/
  unit/                       Vitest
  e2e/                        Phase 3: Playwright + recorded fixtures (local only)
```

## Data flow

```
Browser --fetch (CORS)-------> site.api.espn.com: schedule / standings / roster / summary
   |                           shared in-flight requests -> 30 s memo -> last-good copy in localStorage
   +--fetch (same origin)----> data/news.json, data/meta.json
                                  ^
GitLab CI `pages` job (push + schedule): node scripts/fetch-data.mjs
   -> fetch each club's RSS/Atom feeds -> parse -> de-dupe -> tag clubs/players -> write JSON -> vite build -> Pages
```

## Phases

### Phase 0: plan and scaffold

- [x] Read Arsenal Hub README, `src/lib` list, `package.json`
- [x] Write `PLAN.md` and `CLAUDE.md`
- [x] Scaffold Vite + React 18 + Tailwind v4 + ESLint + Prettier + Vitest; MIT LICENSE; `.gitignore`
- [x] `npm run lint && npm test && npm run build` pass locally
- [x] Local git repo with initial commits
- [x] Install `glab` and sign in (done via `glab auth login --device`)
- [x] `glab repo create premier-league-hub --public`, add remote, push (no deploy). Repo: https://gitlab.com/mushahidur/premier-league-hub; Pages URL will be https://mushahidur.gitlab.io/premier-league-hub/

### Phase 1: data pipeline and deploy

- [x] `src/config/clubs.js` for all 20 clubs (ESPN ids from the `eng.1` teams list; crest URL; colours)
- [x] Check every candidate feed URL (BBC, Guardian, Sky, league-wide); keep working ones, record results in `clubs.js`
- [x] `scripts/fetch-data.mjs` (no deps; RSS/Atom parser; de-dupe; club tagging; `news.json` + `meta.json`) + tests
- [x] `.gitlab-ci.yml` (test → deploy, `pages` job, node_modules cache on lockfile, no Playwright)
- [x] Placeholder page reads `data/meta.json`; first deploy (**ask first**)
- [x] Measure pipeline duration; compute schedule interval for < ~300 min/month; write the arithmetic in README
      (push 53 s, scheduled 27 s; every 4 hours chosen)
- [x] Create pipeline schedule, America/Toronto (**ask first**): id 4568716, `0 */4 * * *`, ref `main`. A manual run
      (pipeline 3090966094) ran only `pages`, 26 s, 57/57 feeds, and the live `meta.json` updated.
- [x] Verify Pages URL loads, routes survive refresh, `data/news.json` is served (57/57 feeds, 419 stories from CI;
      GitLab's runners are not blocked by Sky)

#### Phase 1 feed check (2026-11-19)

| Source                              | Result                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| BBC Sport team feeds                | 20/20 work. Bournemouth is `afc-bournemouth`, Brighton is `brighton-and-hove-albion`.           |
| Guardian team feeds                 | 20/20 work. Brighton is `brightonfootball`; Villa redirects to `aston-villa`.                   |
| Sky Sports team feeds (`/rss/<id>`) | 14/20 clubs. None for Bournemouth, Brentford, Brighton, Coventry, Hull or Nottingham Forest.    |
| League-wide                         | BBC Premier League (51 items), Guardian Premier League (20), Sky Premier League (`/rss/11660`). |

Sky started returning 403 to this machine (every Sky URL, homepage included) after a bulk scan of feed ids
11600–11719, so the scan tripped a rate limit. The Sky feeds stay in `clubs.js`; `meta.json` shows whether they work
from GitLab's runners. Never scan feed ids in bulk again. (Update, Phase 4: the block lifted; Sky answered 57/57
feeds from this machine on 2026-11-19.) The pipeline fetches 57 feeds, 6 at a time, with a 15 s
timeout and an identifying user agent.

Phase 1 decisions:

- **Pipeline layout:** `scripts/fetch-data.mjs` (IO only), `scripts/lib/feed-parser.mjs` (regex RSS/Atom parser ported
  from Arsenal Hub's `feeds.js`, which needs DOMParser) and `scripts/lib/news.mjs` (club tagging, de-dupe, 14-day
  window, 800-item cap). The pure parts are unit-tested.
- **Failure policy:** a failed feed is recorded in `meta.json` and never fails the build. The job fails only if every
  feed fails, so a network outage can't deploy empty news over good news.
- **Club tagging** uses whole-word, case-sensitive aliases from `clubs.js`. A test bans ambiguous words ("City",
  "United", "Palace", "Forest", "Bees"). A story from a club's own feed is always tagged with that club.
- **Players:** `players: []` on every item until Phase 4 (tagging needs the 20 squads).
- **Colours** are curated, not ESPN's (ESPN has Brighton `0606fa`, Coventry `87cced`). Abbreviations use the usual
  MCI/MUN where ESPN says MNC/MAN, so match ESPN data by `espnId`, never by abbreviation.
- **Scheduled runs skip the `test` job**; they only refresh data and redeploy.

### Phase 2: shared code

- [x] Port team-agnostic `lib/` modules + tests from Arsenal Hub, parameterised by club
- [x] Nothing in `src/` mentions Arsenal except `clubs.js`; ported tests pass (enforced for every club by
      `tests/unit/no-club-names.test.js`; 328 unit tests; main chunk 47 KB gzip, nothing imports `lib/` yet)

#### Phase 2 port map

| Arsenal Hub module                                                        | Here                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| errors, cache, validate, format, pitch, refresh, lazy, hero, availability | As is                                                                                                                                                                                                                          |
| diagnostics                                                               | Proxy/circuit/fallback counters removed; console helper is `plhDiagnostics()`                                                                                                                                                  |
| storage                                                                   | Guarded helpers + `usePersistentState` kept; `plh-` keys; new `useMyClub` (validated slug). Bookmarks, watchlist, predictions, recents, archive dropped                                                                        |
| parsers                                                                   | `parseEvent(e, teamId)` / `parseSchedules(jsons, teamId)`: `ars` → `team`; no team id = league-wide (team/opp/isHome/result null). `parseTeam` removed (rule 1). Friendlies detected generically                               |
| standings                                                                 | `tableGaps(rows, espnId)` for any club, plus `safety`/`inDrop` (relegation line, full 20-club table only)                                                                                                                      |
| net                                                                       | No CORS proxies (rule 2), so no circuit breaker or proxy-first; dedupe, 30 s memo, 502–504 retry, 429 backoff kept. Overall budget 8 s                                                                                         |
| sources                                                                   | `TIERS`, `outletForUrl` over `clubs.js` OUTLETS; league-wide reporters only. No rss2json, TEAM_ID or Arsenal feed list                                                                                                         |
| news                                                                      | Reads pipeline items (`parseNewsFile`); categories, credibility and story grouping kept; `scope` → `clubs`; filters/ranking take a club slug. Club words built from `clubs.js`                                                 |
| data                                                                      | Rewritten: per-club URL builders, keyed loaders (`schedule:<id>`, `roster:<id>`, `standings`, `scoreboard`, `summary:<id>`, `news`), keyed last-good-copy cache, generic `useSource(key)` hook, `refreshAll`, `useAutoRefresh` |
| feeds, history, playerstats, transfers, route                             | Not ported: feeds are parsed by the pipeline; history and player stats are out of v1; transfers is Phase 4; `route.js` here already covers v1                                                                                  |

Phase 2 decisions:

- **`useSource(key)` replaces `useHubData`.** One hook per data section, so each section has its own loading, empty,
  stale and error state plus `source` and `savedAt`. Requests for the same key are shared across components; a
  forced reload (`refreshAll`) wins over an older, slower response; a failed refresh keeps the last good copy, marked
  stale. Cache checks and max ages are looked up by key kind, so every club's schedule is sanitised.
- **Story grouping stays in the browser.** The pipeline only folds near-identical copies (`also`); grouping by event
  across outlets needs the categories. Stories tagged with disjoint clubs never merge.
- **ESPN scoreboard** (`eng.1/scoreboard`, for the home page gameweek) checked 2026-11-19: `Access-Control-Allow-Origin: *`.
- **`// @ts-check`** heads every `src/lib` file, but there is no type-check step; ported modules are only loosely
  typed (JSDoc on new and changed exports).

Tests dropped in the port, and why:

- Proxy fallback, proxy-first, circuit breaker, `skipDirect`/`proxy:false`, the shared 5 s proxy budget and the
  fallback log (`net.test.js`, `fetching.test.js`): the proxies are gone.
- RSS/rss2json/ESPN-news parsing (`news.test.js`, `validation.test.js`): feeds are parsed by the pipeline, whose
  parser has its own tests in `pipeline.test.js`. `fetchFeed`/`arsenalNews` loader tests: replaced by `data.test.js`.
- arsenal.com-as-official and `isArsenalRelevant`: no club site feeds; the pipeline tags clubs.
- `fanTalk`, bookmarks, followed players, transfer watchlist, predictions, recents, news archive: features not in v1.
- `parseTeam`, player statistics, club history, women's team separation, transfer stepper: modules not ported.
- The `useHubData` hook tests: rewritten against `loadSource`/`useSource` in `data.test.js` (same behaviours).

Phase 3 needs (from the Phase 2 review):

- Show `asOf`, not `savedAt`: for news it is the pipeline run (`generatedAt`), and news older than 10 h is `stale`
  even straight after a fetch (`STALE_AFTER_MS` in `data.js`).
- `useMyClub` keeps its own state per component, so a club picked in the picker won't re-theme the shell until reload.
  Back it with a shared store (the `refresh.js` `useSyncExternalStore` pattern) before the picker and theming land.
- `readCache()` parses the whole cache blob (up to 2 MB) on every `useSource` mount, and `writeCache` re-parses it on
  every load. Keep one parsed copy in module scope, updated on write, before a club page mounts 4+ sources.
- `npm audit` (see notes below): upgrade Vitest and Vite together, in a session of its own.

### Phase 3: pages and design

- [x] Visual direction with `frontend-design`; checks with `web-design-guidelines` and `vercel-react-best-practices`
- [x] League home, club pages, match centre, club picker + theming, search, lazy routes
- [x] Playwright (Chromium) with recorded fixtures; axe clean; 375 px + desktop; main chunk < ~150 KB gzip; deploy
      (16 e2e tests, desktop + 375 px, axe WCAG 2.1 AA clean, no horizontal overflow; main chunk 72 KB gzip;
      deployed by pipeline 3091150004, `test` 45 s + `pages` 29 s; live check: lazy chunks, fonts and data/*.json
      return 200, news not stale, a club route survives a refresh)

Phase 3 decisions:

- **Visual direction:** matchday programme meets stadium signage. Chalk surface (`#FAFBF8`), turf ink (`#14201B`),
  self-hosted Barlow for text and Barlow Condensed for scores, times and table numbers (tabular figures). The one loud
  element is the scoreboard strip with a kit stripe in the club's raw colours; the rest stays quiet and left-aligned.
  Sentence case throughout (the guidelines' "Title Case" rule was not applied, on purpose). Light theme only in v1.
- **Accent colours:** `lib/accent.js` darkens a club's primary colour towards the ink colour until it reaches 4.5:1 on
  the page _and_ on its own pale tint; tested for all 20 clubs. Raw club colours are decoration only (kit stripe,
  crest-grid bar). Club pages take their own club's colours; elsewhere the viewer's club (or the site default).
- **One `Section` component** renders every data section's loading, empty, stale and error (with Try again) states
  and the "Source · updated …" line, which shows `asOf` (the pipeline run for news).
- **Form** comes from each club's schedule (`lib/form.js`), so it is on club pages only; the home table has no form
  column (see Prompt corrections). The home fixtures list is ESPN's default scoreboard, labelled by date, never with
  an invented gameweek number.
- **Player search** loads all 20 rosters, but only on the search route (saved copies first); matching is by word start
  (`rice` finds Rice, not Price).
- **Match centre** reads teams and score from the summary header (`parseSummary` now returns `match`). Stat values
  are formatted in the component, because cached copies lose the parser's `fmt` functions.
- **Squad** shows ESPN's injured/doubtful/suspended entries and says "ESPN lists no injuries or suspensions. Its list
  can lag club news." when there are none; never "all fit". The news cross-check (rule 3) is Phase 4.
- **E2E** (`npm run e2e`, local only): `tests/e2e/mock.js` answers every request from `tests/e2e/fixtures` (bodies
  only, checked for IPs and tokens) and pins the clock to the recording time. Re-record with `npm run e2e:record`.
  Fixtures are in `.prettierignore` so they stay minified (1.2 MB).

Phase 4 needs:

- Player tagging can reuse `useAllPlayers` in `SearchPage.jsx` (20 rosters) or, better, do it in the pipeline.
- The squad list is where the rule 3 "reported injured · outlet · time" note goes.

### Phase 4: news intelligence

- [x] Player tagging across 20 squads with collision handling (full name, then surname + club context; never bare
      surname across clubs). First local run: 603 players from 20/20 rosters, 169 of 413 stories name a player
- [x] Injury cross-check (rule 3); simplified league-wide transfer feed (confirmed vs reported, outlet tier)
- [x] Tricky-headline tests; no false "all fit" in fixtures; deploy (425 unit tests, 16 e2e; main chunk 73 KB gzip;
      pipeline 3091213238, `test` 62 s + `pages` 34 s (was 29 s; the rosters add ~5 s, well inside the CI budget);
      live `meta.json`: 20/20 rosters, 603 players, 169 of 413 stories tagged)

Phase 4 decisions:

- **Player tagging runs in the pipeline** (`scripts/lib/players.mjs`), after de-duplication so the unioned club tags
  give surnames their context. `fetch-data.mjs` fetches the 20 `/eng.1/teams/<id>/roster` responses (never bare
  `/teams/<id>`); a failed roster leaves that club untagged and is listed under `rosters` in `meta.json`. Items carry
  ESPN player ids in `players`; the browser seeds `article.players` from them.
- **Collision rules:** a full name tags anywhere (unless two squads share it); a surname or one-word name needs the
  story to be tagged with that player's club, must be unique in that squad and not shared by another tagged club. Case
  is kept and accents folded. Full names are matched first and blanked out. A surname next to another capitalised
  word ("Lewis Jones", "Old Trafford", "James Savundra") is skipped unless that word is a possessive, a club word, all
  capitals or a sentence-start capital. Known misses: brothers in one story ("Pierce" and "Shea" Charles); a
  two-word name opening a sentence still tags its second word ("Roy Keane hails Everton" would tag an Everton
  Keane). Low impact: an injury note also needs injury wording next to the name.
- **Injury cross-check** (`src/lib/injuries.js`): a report needs the pipeline's tag, the player named in the headline,
  a reliable-or-better outlet and a date within 7 days. Wording is stricter than the news "injury" concept
  (injury-time, "no doubt", "absence" and past-injury stories don't count). With several players named, the wording
  goes to the nearest name within four words, plus names listed with it ("X and Y miss training"), so "Burn replaces
  injured Guehi" flags only Guehi. Returns ("returns to training", "fully fit", "on return from") are their own kind,
  but a fresh injury event in the same headline ("limps off on return from injury", "setback") wins over a return;
  the latest report per player wins. The squad shows "Reported injured · outlet · time" with the linked headline,
  and the summary line names players the news reports but ESPN doesn't list.
- **Transfer feed** (`src/lib/transfers.js`) is a home-page section, not a route. It includes contract renewals
  (labelled "Contract"), and leaves out manager appointments/sackings, finances, fan pieces and newsletters. With no
  official outlets, "Confirmed" means completion wording from a reliable outlet with no hedge; any hedge (set to,
  talks, verbally agrees, a question mark) makes it "Reported", and so does an agreement before an announcement.
- **E2E fixture:** `record-fixtures.mjs` adds one made-up BBC injury story about a squad player ESPN lists as fine, so
  the rule-3 note is always tested.

Phase 5 needs:

- README CI arithmetic is stale: the push `pages` job went from 29 s to 34 s with the 20 roster fetches; a scheduled
  run will grow by about the same. Re-measure one scheduled run and update the minutes sum (still well under 300).
- Screenshots should include the home "Transfers and contracts" section and a squad "Reported injured" note.
- `meta.json` now has `counts.rostersOk / players / itemsWithPlayers` and a `rosters` list; document it.
- Sky answered 57/57 feeds from this machine on 2026-11-19 (Phase 4 runs), so the Phase 1 "Sky 403s locally" note is
  out of date.
- Optional: a club-page transfer list (`transferFeed(stories, { club })` already supports it).

### Phase 5: polish

- [x] README with Playwright screenshots + architecture decisions; Open Graph image and tags; performance pass
- [x] Final review against the prompt checklist; open-issues list for later versions
      (deployed by pipeline 3091327199, `test` 62 s + `pages` 43 s; live check: `og.png` 200 `image/png`, OG and
      Twitter tags in the served `index.html`, every home crest served through the combiner with none broken, no
      error sections, news not stale; live `meta.json` 57/57 feeds, 20/20 rosters, 170 of 416 stories tagged)

Phase 5 decisions:

- **Screenshots and the OG image** come from `npm run screenshots` (`scripts/screenshots.mjs` runs
  `tests/e2e/screenshots.spec.js` with `SHOTS=1`; otherwise the spec skips, so `npm run e2e` is unchanged). Recorded
  fixtures, clock pinned, crests fetched live. Output: `docs/screenshots/*.png` and `public/og.png` (1200×630, the
  site name in Barlow Condensed and a strip of the 20 clubs' colours; no league logo or wordmark).
- **OG tags** in `index.html` use absolute URLs, which must follow `BASE`. Hash routes are invisible to crawlers, so
  every shared link shows the home card; per-route cards would need prerendered pages.
- **Performance pass:** crests were ESPN's 500 px PNGs (~36 KB each) drawn at 16–64 px. `src/lib/crest.js` asks
  ESPN's image combiner for the drawn size (1x `src`, 2x `srcset`): about 4 KB for a 48 px crest, so the home page's
  ~20 unique crests go from ~700 KB to under 100 KB. Main chunk 73 KB gzip (unchanged); fonts already load only the
  Latin subsets (unicode-range); routes already lazy. Inline SVG favicon added (no extra request).
- **Fixes found by the screenshots:** the global unlayered `:focus-visible` rule beat Tailwind's layered
  `outline-none`, so `<main>` (focused by the router on load) showed an accent frame round the whole page; now
  `main[tabindex="-1"]:focus { outline: none }`. The transfer feed listed Sky's "Transfer Centre LIVE! … Vote here!";
  live blogs and votes are now left out (test added).
- **CI re-measured** (Phase 4 need): push `test` 57 s + `pages` 39 s (pipeline 3091233441); the first natural
  scheduled run, 16:00 Toronto, `pages` 31 s (pipeline 3091321718, started ~5 min late). Still within the 1 min per
  scheduled run budgeted in the README; every 4 hours stays.

#### Final review against the build prompt (2026-11-19)

| Prompt item                                                                 | Status                                                                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Home: table with zones and GD, fixtures in viewer's timezone, stories, pick | Done. **Form is on club pages only** (ESPN standings carry none; see Prompt corrections)             |
| Club pages for all 20: next match + countdown, last result, position, form  | Done                                                                                                 |
| Club news with credibility; squad with availability; fixtures and results   | Done                                                                                                 |
| Match centre: line-ups, formation pitch, events, team stats                 | Done                                                                                                 |
| My club in `localStorage`, home leads with it, AA accent                    | Done (accent contrast tested for all 20 clubs)                                                       |
| Search across clubs, players and stories                                    | Done                                                                                                 |
| Footer disclaimer; no league logo or wordmark                               | Done                                                                                                 |
| React 18, Vite, Tailwind v4, lucide; JSDoc + `@ts-check`; hash routing      | Done (no type-check step runs, see open issues)                                                      |
| Reuse Arsenal Hub modules and tests; one club config                        | Done; enforced by `no-club-names.test.js`                                                            |
| Rules 1–6                                                                   | Done: no `/teams/:id`, no relays, rule-3 notes, lazy routes (73 KB), ESLint + Prettier, MIT + README |
| Pipeline: Node 22, no deps, `news.json` + `meta.json`                       | Done                                                                                                 |
| GitLab Pages, `BASE` constant, CI stages, `pages` job, no Playwright in CI  | Done                                                                                                 |
| CI budget < 300 min with arithmetic in README; schedule in America/Toronto  | Done (every 4 h)                                                                                     |
| Unit tests: club config, parsers, pipeline parsing and tagging, routing     | Done (431 tests)                                                                                     |
| Playwright with recorded fixtures, Chromium; axe; 44 px; focus; skip link   | Done at 1280, 768 (added in Phase 5) and 375 px                                                      |
| Loading, empty, stale, error states with source and time                    | Done (one `Section` component)                                                                       |

#### Open issues for later versions

1. ~~**Home table form column.**~~ Done in Phase 7 (from FPL fixtures via the pipeline). Was: needs 20 club schedules in the browser (40 requests). Better: have the pipeline write
   `data/form.json` from the schedules it could fetch alongside the rosters.
2. ~~**Gameweek labels.**~~ Done in Phase 7 (FPL gameweeks). Was: the default scoreboard has no `week`; fixtures are grouped by date.
3. **Dark theme** (light only in v1).
4. **Per-route link previews** (club and match OG cards) need prerendered HTML per route, which hash routing can't
   give; would mean moving to path routing with a Pages 404 fallback.
5. **Player-tagging misses:** brothers in one story (Pierce/Shea Charles); a two-word name opening a sentence tags its
   second word.
6. **Transfer feed** still lets some round-ups through as "Reported" (for example "Ipswich latest: What are the club
   targeting in January?"). A club-page transfer list (`transferFeed(stories, { club })`) was not added.
7. **Type checking:** ~~nothing runs `tsc`~~ done in Phase 6 (`npm run typecheck`, strictNullChecks); `noImplicitAny`
   is the next increment.
8. **Dependencies:** ~~`npm audit` advisories in Vitest 3's dev-only deps~~ fixed in Phase 6 (Vitest 5).
9. **Sky feeds** rate-limit bulk requests; if they start failing from GitLab's runners, `meta.json` will show it and
   BBC + Guardian still cover all 20 clubs.
10. **Out of v1 scope:** club history, women's teams, fan predictions, a full transfer tracker, accounts.

## Version 2 (Phases 6–13)

A second brief (2026-11-19) adds Phases 6–13: technical quality, league dashboard, player profiles, statistics, FPL,
match centre, personalisation, design. One phase per session, in order; Phase 7 does not start until Phase 6 is done,
tested and documented.

### Implementation assessment (2026-11-19, before Phase 6)

**Already built (extend, don't duplicate):**

| Area             | What exists                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home             | Table with zones and GD (no form), scoreboard for ESPN's current dates (grouped by date), top stories, transfers and contracts, club grid, my-club block                                                             |
| Club page        | Next match + countdown, last result, position + gaps + form (from the club's schedule), news, squad with availability and rule-3 injury notes, fixtures and results                                                  |
| Match centre     | Score header, key events, team stats table, line-ups on a formation pitch                                                                                                                                            |
| Search           | Clubs, players (20 rosters, loaded on the search route only) and stories                                                                                                                                             |
| Data layer       | `net.js` (shared in-flight requests, LRU memo with per-category TTL, 502–504 retry, 429 back-off, 8 s budget); `data.js` (keyed loaders, last-good copy in `localStorage`, one parsed copy of the blob, `useSource`) |
| Freshness        | Every section: loading, empty, stale, error + Try again, "Source · updated …"; news staleness from the pipeline's `generatedAt`; 10-minute auto-refresh while visible                                                |
| Pipeline         | 57 feeds + 20 rosters → `news.json` + `meta.json`; refuses to write if every feed fails                                                                                                                              |
| Tests            | 431 unit (Vitest 3), 24 e2e (Chromium at 1280, 768 and 375 px, axe WCAG 2.1 AA, overflow, skip link, failing-source test)                                                                                            |
| Personalisation  | One "my club" (`useMyClub`, shared store) that re-themes the UI                                                                                                                                                      |
| Route validation | `route.js` accepts only digit event ids and known club slugs before anything reaches ESPN                                                                                                                            |

**Technical debt and limits (feeds Phase 6):**

- **Typecheck:** `// @ts-check` heads every `src/lib` and `src/config` file, but no TypeScript is installed and nothing
  runs `tsc`, so the headers check nothing outside an editor.
- **Cache:** the "repeated parsing" item is mostly done (Phase 3 keeps one parsed copy). What remains: every
  `useSource` mount calls `readCache()`, which sanitises _every_ saved source to read one; the storage key is a fixed
  `plh-cache-v1` with no versioning of its contents; one 3-day max age for everything; expired entries stay stored
  until size eviction; no freshness window (a saved copy seconds old is still refetched and labelled stale); an empty
  but successful response (for example a bad standings payload) overwrites a good saved copy.
- **Pipeline:** a run where most feeds fail still deploys (only "all failed" stops it); `news.json` and `meta.json` are
  never validated before the build; raw error strings go into `meta.json` (Node's fetch errors can carry addresses).
- **Dependencies:** `npm audit`: 3 advisories (2 critical, 1 moderate), all in Vitest 3's dev-only `tinypool` and
  `@vitest/mocker`; fixed by Vitest 5.1.1, which supports Vite `^6.4` (we have 6.4.6). Nothing shipped to the site is
  affected. No dependency-update policy.
- **QA gaps:** no e2e assertion that the console is free of errors; route refresh is tested for search and one club
  page only.
- Product limits carried from v1: no gameweek numbers, no form on the home table (open issues 1 and 2).

**Data providers (checked 2026-11-19 with `Origin: https://mushahidur.gitlab.io`):**

| Endpoint                                                                                                            | CORS | What it gives                                                                                                                                                                        | Use                                      |
| ------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| ESPN `site.api…/eng.1/scoreboard` (+ `?dates=YYYYMMDD`)                                                             | Yes  | One day's matches; `leagues[0].calendar` lists match dates. **No week numbers**; `?week=5` returned 0 events                                                                         | Live scores (in use)                     |
| ESPN `site.web.api…/eng.1/statistics`                                                                               | Yes  | Goals leaders and assists leaders, 50 each (670 KB)                                                                                                                                  | Phase 7 top scorers/assists              |
| ESPN `site.web.api…/common/v3/…/eng.1/athletes/<id>`                                                                | Yes  | Bio: name, age, citizenship, position, shirt number (no headshot for the player checked)                                                                                             | Phase 8 profiles                         |
| ESPN `…/athletes/<id>/gamelog`                                                                                      | Yes  | Per-match log (labels, events, season types)                                                                                                                                         | Phase 8 recent performances              |
| ESPN `…/athletes/<id>/stats`                                                                                        | —    | **HTTP 404**                                                                                                                                                                         | Not usable                               |
| FPL `fantasy.premierleague.com/api/bootstrap-static/`                                                               | No   | 38 gameweeks (current/next, deadlines), 20 teams (short names), 672 players with `form`, `minutes`, `expected_goals`, `expected_assists`, `now_cost`, `selected_by_percent` (1.8 MB) | Pipeline only: Phases 7, 9, 10           |
| FPL `…/api/fixtures/` (`?event=N`)                                                                                  | No   | All 380 fixtures, each with `event` (gameweek), kickoff, team ids, scores when finished (100 finished today, none with a null gameweek), difficulty ratings                          | Pipeline only: gameweeks and league form |
| ESPN standings, schedule, roster, summary                                                                           | Yes  | As in v1                                                                                                                                                                             | In use                                   |
| Not checked: ESPN team statistics per season, head-to-head, play-by-play detail; FPL `element-summary`, rate limits |      |                                                                                                                                                                                      | Check in the phase that needs them       |

**Consequences for later phases:**

- **Gameweeks (Phase 7):** ESPN can't number gameweeks; FPL is the only source and has no CORS, so the pipeline must
  write a `data/gameweeks.json` (gameweek → fixtures with kickoff and ESPN team ids via a `fplShort` per club in
  `clubs.js`), and the browser fetches ESPN's scoreboard for that gameweek's dates for live scores. FPL's gameweek is
  the fantasy round: a postponed match moves to the round it is replayed in (and can have no round until rescheduled;
  none today). Label it "Gameweek N (FPL)" and show unscheduled matches separately; never infer a number.
- **League form (Phase 7):** the same FPL `fixtures/` response has every finished score, so the pipeline can derive
  each club's last five league results in one request, instead of 40 browser requests.
- **xG/xA (Phase 9) and FPL (Phase 10):** FPL carries expected goals/assists per player, but they are FPL's numbers;
  label them as such. ESPN has none in the endpoints above.
- **FPL reliability:** fetched only by the pipeline every 4 hours (12 requests a day), so rate limits are not a
  concern; a failed fetch must keep the previous file rather than deploy nothing.

### Phase 6: technical quality and performance

- [x] Assessment above
- [x] 6.4a Vitest 5 upgrade (fixes all audit findings; Vite stays 6.4): 431/431 tests in 24 files, `npm audit` 0
- [x] 6.1 `npm run typecheck` (TypeScript over the `// @ts-check` files), errors fixed, in CI: TypeScript 5.9 over 32
      files with `strictNullChecks` (13 errors fixed, no `@ts-expect-error`); `noImplicitAny` would add 196 (next
      increment); `ts-check-scope.test.js` keeps every `src/lib`, `src/config` and `scripts` file in scope; CI `test` job
- [x] 6.2 Cache: versioning, per-kind max age and freshness, pruning, cheaper mount reads, empty-overwrite guard
      (`plh-cache-v2`, older versions removed on write; max age scoreboard 1 d, standings and news 2 d, schedule 3 d,
      roster 7 d, match summary 14 d; fresh windows standings 5 min, news 15 min, roster 30 min, live kinds 0; expired
      copies pruned on write; a mount reads and checks only its own key; an empty table, squad or news answer keeps
      the last good copy and shows it stale; a league-only schedule fallback is never saved over a complete copy;
      20 new unit tests)
- [x] 6.3 Pipeline: validate output before writing, degraded-run floor, clearer and address-free failure reporting;
      form/gameweek generation investigated (above). `scripts/lib/validate-data.mjs` (pure, 20 tests): schema checks
      for both files, no IP addresses or credential-like text anywhere in `meta.json` or in story links; errors carry
      the cause code ("fetch failed (ECONNREFUSED)") with addresses removed; `meta.json` gains `status`
      (ok/degraded) and `problems`. Floor: under half the feeds or under 100 stories → exit 1, nothing written.
      Checked locally: normal run "status: ok; output valid"; total outage and a Guardian-only outage (21/57 feeds, 76
      stories) both exit 1 without touching the files. GitLab publishes Pages only when the `pages` job succeeds, so
      the live site keeps its data (GitLab's documented behaviour; not forced live). Consequence: a push during a
      feed outage doesn't deploy code either; re-run the job once feeds recover.
- [x] 6.4b Production-dependency audit gate in CI; dependency update policy; upgrades evaluated (`audit:prod` in the
      CI `test` job, `deps:check`, `.npmrc` with `engine-strict` and `save-exact`; policy in README; deferred
      majors under Decisions). External data review: route ids already digits-only; parsers validate ESPN shapes;
      news links, images and "also" links and the ESPN recap link now reach an `href`/`src` only if they are http(s)
      (the pipeline already dropped other links); crests are `img` sources only.
- [x] 6.5 QA: unit, e2e at 375/768/1280, axe, console errors, every route survives a refresh; deploy and live check.
      Local: lint 0, format clean, typecheck 0, `audit:prod` 0, 499 unit tests in 26 files, build (main chunk 74 KB
      gzip), 27 e2e (9 tests × 3 widths; axe WCAG 2.1 AA, no overflow; every test now fails on a console error or
      uncaught exception; new test reloads `#/`, a club, a match, a search and a not-found route and checks content
      and title). Deployed by pipeline 3091928771, `test` 53 s (typecheck and audit included) + `pages` 45 s; the
      `pages` log shows "status: ok; output valid"; live `meta.json` `status: ok`, 57/57 feeds, 20/20 squads. Live
      browser check: a planted `plh-cache-v1` was removed on load (`plh-cache-v2` only), home/club/search/match render
      with no error sections, a match page survives a reload with its title, no console errors.

Phase 6 outcome: done. Next recommended: **Phase 7 (league dashboard)**, starting with the pipeline's
`data/gameweeks.json` and league form from FPL `fixtures/` (see the assessment), then the gameweek selector, top
scorers and assists from ESPN `statistics`, and the table's form column. Carried forward: `noImplicitAny` (196 errors),
the deferred majors (Vite 8, React 19, ESLint 10, lucide 1.x), and v1 open issues 1–2 and 4–7.

### Phase 7: league dashboard

- [x] Pipeline `data/league.json` (named for what it holds, not `gameweeks.json` as the assessment guessed): FPL
      gameweeks and fixtures, league form, ESPN goals and assists leaders; per-part `asOf`, carry-over, validation
- [x] Functional gameweek selector (all 38, previous/next, opens on the current gameweek until it is finished, then
      the next) that loads the selected gameweek's fixtures, with ESPN live scores for its days
- [x] Matchday scoreboard with live / upcoming / completed filters and counts
- [x] League table with form indicators (all widths, including 375 px)
- [x] Top scorers and assists
- [x] Upcoming important fixtures ("Key fixtures", by a stated rule)
- [x] Improved My Club block (position, points, gaps, form, then next/live and last match)
- [x] Data freshness: every dashboard part names its source and age; live scores are labelled live
- [x] Deploy and live check: pipelines 3092042523 and 3092057358 (`test` 66 s + `pages` 46 s, inside the 2-minute
      budget); the `pages` log shows "league.json: missing [], carried over []" and "status: ok; output valid" (GitLab's
      runners reach FPL); live `league.json` 79 KB, 38 gameweeks, 380 fixtures. Browser, desktop and 375 px: Gameweek
      11 opens with 10 ESPN-linked matches, picking Gameweek 3 loads its 10 results (ESPN matched past days too), form
      for 20 clubs, leaders, key fixtures, no overflow, no error sections, no console errors. Local: 522 unit tests in
      27 files, 33 e2e (11 tests × 3 widths), lint/typecheck/audit clean, main chunk 79 KB gzip.
- [x] Review fixes: "live" scores label only while matches remain (postponed-safe); a failed league section still
      names its source; e2e for the ESPN-scoreboard fallback when league.json fails; carry-over checked for real
      against the live file (FPL stubbed to fail: gameweeks and form kept their 01:22Z date, leaders fresh, errors
      without addresses); CLAUDE.md data notes updated

Phase 7 decisions:

- **Gameweeks come from FPL** (`scripts/lib/league.mjs`). FPL teams are matched to clubs by FPL short name = our
  `abbr`, and all 20 must match or no gameweek data is published. A fixture is shown in the round FPL gives it; FPL
  moves a postponed match to its replay round, and one with no round yet is listed under "Awaiting a new date".
  Labels say "Fantasy Premier League"; no number is inferred.
- **Scores:** for the selected gameweek the browser fetches ESPN's scoreboard for each of its days (UTC dates of
  FPL's kick-offs; one request per day, new `scoreboards:<days>` source) and pairs matches by home and away club.
  A paired fixture shows ESPN's live score, clock and match-centre link; an unpaired one shows FPL's score or
  kick-off, without a link, and the section says how many. If ESPN fails, the section says so and shows FPL's data.
  Filters use the provider's state: a kick-off that has passed without a result is "upcoming", never "completed".
- **Fallback:** if league.json has no gameweeks (or can't load at all), the home page shows ESPN's default
  scoreboard as before.
- **Form** is derived from FPL's finished fixtures (provisional or confirmed full time), last five, oldest first. The
  club page keeps its ESPN-schedule form (it includes links to the match centre); the two can differ for up to a
  pipeline interval after a match, and each says where it comes from.
- **Leaders** are ESPN's (goals and assists, top ten plus everyone tied at the cut, capped at 20). "Apps" shows "–"
  when ESPN gives no match count; never 0.
- **Key fixtures:** upcoming in the next 14 days, both clubs in the top six or both in the bottom four of the current
  ESPN table (needs all 20 rows). The rule is printed above the list.
- **Freshness:** the dashboard sections drop the generic "Source" line (`Section sourceLine={false}`) for one line
  per source (`FreshnessLine`): FPL fixture list with its `asOf`, ESPN scores marked live, ESPN leaders, FPL form
  under the table.
- **Bug found by the e2e test:** FPL-only rows have no ESPN id, so they shared a React key; when ESPN's scores arrived
  React kept stale rows (10 matches rendered as 19). Rows are keyed by ESPN id, else FPL id; day groups by day.
- **Pipeline cost:** two FPL requests (1.8 MB + 0.1 MB) and one ESPN statistics request (0.7 MB) per run; league.json
  is ~80 KB (about 10 KB gzipped). Main chunk 79 KB gzipped (was 74 KB).

Phase 7 outcome: done. Next recommended: **Phase 8 (player profiles)**: `#/player/<id>` from ESPN's athlete bio and
gamelog endpoints (both CORS OK; `/stats` is 404, so season totals must come from the gamelog or be shown as
unavailable), plus FPL player data via the pipeline if minutes/cards are needed. Link leaders and squad rows to it.
Outstanding: `noImplicitAny` (196); deferred majors; v1 open issues 3–10; FPL rate limits not measured (12 requests
a day so far).

### Phase 8: player profiles

- [x] `#/player/<espn-id>`: name and photo (labelled placeholder when ESPN has none), club, position, shirt number,
      nationality, age; appearances, goals, assists, minutes, cards and more; recent performances; availability
- [x] Comparison tool `#/compare?a=&b=`: two players, same season and competition, unavailable distinct from zero
- [x] Linked from squad lists, leaders and player search; e2e and unit tests
- [x] Deploy and live check: pipelines 3092100701 and 3092106942 (`test` 59–67 s + `pages` 31 s); `pages` log
      "56 of 603 squad players have no FPL match (minutes unknown)", "status: ok; output valid"; live league.json has
      547 minutes entries. Browser: Haaland's profile (bio, 10 appearances, 889 FPL minutes, 0.91 goals per 90, ten
      matches), a goalkeeper (David Raya) reached from the Arsenal squad list (saves and conceded instead of attacking figures;
      900 FPL minutes, checked again after the cache fix: the first pass showed "–" for every player because of the
      stale saved copy below), Haaland v Isak comparison with 13 rows; no error sections, no
      console errors. Local: 541 unit tests in 28 files, 39 e2e (13 tests × 3 widths), lint/typecheck/audit clean.
- [x] Review fixes: the profile's injury note now reads headlines with the whole squad as candidates
      (`reportFor` in `injuries.js`; with a one-player list "Saka replaces injured Martinelli" was read as Saka
      injured; unit test added); date of birth from the roster's date, written out in UTC (`fmtBirthDate`), not
      ESPN's ambiguous day/month string; e2e asserts that a search result links to the profile.
      Deployed by pipeline 3092118306 (`test` 67 s + `pages` 38 s). Live: Emiliano Martínez's profile shows the same
      "Reported back from injury · Sky Sports" note as the Chelsea squad list; date of birth "September 2, 1992"; no
      console errors. Local: 543 unit tests, 39 e2e.
- [x] Found in the live check: a browser that had saved league.json 11 minutes before the deploy kept showing
      minutes as "–" (its copy was inside the 15-minute fresh window, so no request). `CACHE_VERSION` 2 → 3; CLAUDE.md
      now says to bump it whenever a pipeline file gains a field the UI reads.

Phase 8 decisions:

- **Sources.** Bio from ESPN's athlete endpoint (`site.web.api…/common/v3/sports/soccer/eng.1/athletes/<id>`, CORS OK),
  needed to find the player's club from a link. Season totals from the club's ESPN roster, which `parseRoster` already
  reads (appearances, sub appearances, goals, assists, shots, on target, fouls, offsides, cards, own goals; saves and
  conceded for goalkeepers), so every player, and both sides of a comparison, come from one source and season. The
  match log from ESPN's game log (league matches this season, per-match goals, assists, shots, cards; no minutes).
  ESPN's `/stats` is 404 and no ESPN endpoint checked has minutes.
- **Minutes from FPL** (`league.json` `minutes`, pipeline only): strict name matching inside each club, never fuzzy;
  547 of 603 matched; 56 without a match show "–". A spot check of 78 matched players found no wrong pairing. FPL
  minutes include all league minutes this season (also at a previous Premier League club).
- **Unavailable v zero.** Every figure is `null` when the source doesn't give it, shown as "–" (with "not available"
  for screen readers) and explained under the figures; 0 only when the source says 0. Per-90 is derived (ESPN goals or
  assists ÷ FPL minutes × 90), marked "*", and only from 90 minutes.
- **Comparison.** Pick from the 20 squads (the search route's `useAllPlayers`, now shared); the URL keeps both ids so
  a comparison can be shared and survives a reload. Better figure in bold, lower-is-better for fouls committed,
  offsides, cards and goals conceded; a warning if ESPN labels the two squads' seasons differently. An id not in any
  squad says so.
- **Photos.** ESPN has headshots for few players (2 of 31 in one squad); a guessed CDN URL returns 404, so none is
  built. The placeholder shows initials and "No photo from ESPN".
- **Caching.** `athlete:<id>` (7-day max age, 30-minute fresh window) and `gamelog:<id>` (3 days, 10 minutes).
  Profiles and comparison are lazy chunks (3.2 KB and 2.3 KB gzip); main chunk 82 KB gzip (was 79 KB).
- **E2E fixtures:** `athlete.json` and `gamelog.json` for one recorded squad player (only the fields the parsers
  read, no links); `recorded.json` gains `playerId` and `otherPlayerId`.

Phase 8 outcome: done. Next recommended: **Phase 9 (football analytics)**: a Statistics section. Checked so far: ESPN
squad statistics (per player, this season), ESPN game logs (per match), FPL fixtures (all results, so home/away,
goals for and against, clean sheets and points/position progression can be derived from scores), FPL
`expected_goals`/`expected_assists` per player (FPL's numbers; label them). Not yet checked: ESPN team statistics
per season (possession, shots per team) — verify an endpoint before promising possession. Outstanding: the 56
unmatched players' minutes; `noImplicitAny` (196); deferred majors; v1 open issues 3–10.

## Decisions

- **JavaScript + JSDoc + `// @ts-check`** in `src/lib` and `src/config`, not TypeScript. Arsenal Hub is JS, so Phase 2
  ports straight across with its tests, with no type-stripping step.
- **Dependency majors match Arsenal Hub** (React 18, Vite 6, plugin-react 4, Vitest 3, Tailwind 4) so ported code and
  tests behave the same. Scaffolded by hand because `npm create vite` now installs React 19.
  Phase 6 moved Vitest to 5 (security fixes; it supports Vite 6.4). Evaluated and deferred: Vite 8 and
  plugin-react 6 (new bundler, no advisory against Vite 6.4), React 19 (breaking, no need), ESLint 10 / react-hooks 7
  (new rules to adopt deliberately), lucide 1.x (icon renames), jsdom 31 (no need). Revisit one at a time.
- **Hash routing** (`src/lib/route.js`) so any route survives a refresh on GitLab Pages without a 404 fallback.
- **`BASE` constant** in `src/config/site.js`, imported by `vite.config.js`.
- **No dev CORS proxy.** Arsenal Hub's `devCorsProxy` allow-listed rss2json and feed hosts; dropped per rules 1 and 2.
- **`public/data/*.json` is generated in CI and git-ignored**, never committed.
- **Playwright deferred to Phase 3** (not installed yet) to keep Phase 0 small.
- **The build prompt file stays local**: `premier-league-hub-prompt.md` is git-ignored.

## Prompt corrections and notes

- `glab` was not installed at Phase 0. Installed with `winget install GLab.GLab`. The browser sign-in did not persist;
  `glab auth login --hostname gitlab.com --device` worked. glab lives at
  `%LOCALAPPDATA%\Programs\glab\glab.exe`, which is not on PATH in shells opened before the install.
- Arsenal Hub's file names differ slightly from the prompt: ESPN parsing is in `parsers.js` (feed parsing in
  `feeds.js`), and the fetch layer is split across `data.js` and `net.js`. It also has `route.js`, `storage.js`,
  `availability.js`, `refresh.js` and `lazy.js`, worth reviewing in Phase 2.
- Arsenal Hub's repo contains `h.txt`, which looks like an HTTP dump. Never copy it (it's git-ignored here).
- The UI skills (frontend-design, web-design-guidelines, vercel-react-best-practices) were installed at user level
  before Phase 0, not in Phase 3.
- A public GitHub mirror exists at https://github.com/mushahidur-lgtm/premier-league-hub (remote `github`, added after
  Phase 0 at the user's request). GitLab (`origin`) stays the main remote and the only host; push to both.
- (Fixed in Phase 6: Vitest 5.1.1 runs on Vite 6.4, so Vite did not need upgrading.) `npm audit` reported advisories in Vitest 3's dev-only dependencies (`@vitest/mocker`, `tinypool`); the fix is Vitest
  5 (breaking). They don't ship to the site. Revisit after the Phase 2 port by upgrading Vitest and Vite together.
- GitLab Pages on gitlab.com needed three fixes before the first deploy worked:
  1. New accounts must complete identity verification before any CI job runs.
  2. `pages_access_level` defaulted to `private` (visitors were redirected to a login); set to `enabled`.
  3. "Unique domain" was on, which serves the site at the root and breaks `BASE = "/premier-league-hub/"`; turned off, so
     the site is at https://mushahidur.gitlab.io/premier-league-hub/.
     First deploy: pipeline 3090889659, `test` 34 s + `pages` 36 s (about 1.2 CI minutes). Use this to size the Phase 1 schedule.
- A minimal `.gitlab-ci.yml` (test + pages, no data fetch, no schedule) was added ahead of Phase 1 at the user's request.
- Phase 2: the Phase 1 pipeline parser (`scripts/lib/feed-parser.mjs`) had dropped Arsenal Hub's rule that a zone-less
  `YYYY-MM-DD HH:mm:ss` date is UTC, so such dates depended on the runner's timezone. Restored; the ported timezone
  test now covers the pipeline parser.
- Phase 3: ESPN's standings carry no form, and the scoreboard rejects date ranges (`?dates=YYYYMMDD-YYYYMMDD` returned
  HTTP 400 on 2026-11-19), so league-wide form would need 20 club schedules (40 requests) on the home page. Dropped
  the form column from the home table; form is shown on club pages from that club's schedule.
- Phase 3: the default scoreboard has no `week` field, so home fixtures are grouped by date, not by gameweek.
- Phase 2: Testing Library can't register its automatic cleanup because Vitest runs without `globals`, so mounted
  hooks leaked between tests. `tests/unit/setup.js` now calls `cleanup()` after each test.

### Phase 9: football analytics

- [x] Sources checked and chosen (below); `data/stats.json` in the pipeline with validation and carry-over
- [x] Statistics section `#/stats`: team statistics, player statistics, home v away, goals scored and conceded, clean
      sheets, possession, shots and shots on target, xG (team: ESPN per match; player: FPL), xA (player: FPL; no
      source has team xA, so none is shown), league position and points progression
- [x] Filters: season (team statistics, and one player's two seasons), club, player, metric, per match / per 90; all
      in the query string and surviving a reload; competition stated as Premier League only (not a fake control)
- [x] Charts: bar chart (one metric across clubs) and line chart (up to four clubs), each with a text summary and
      a table view; unit and e2e tests
- [x] Deploy, CI timing and live check: pipeline 3092376652, `test` 64 s + `pages` 35 s (the 40 team-statistics
      requests add a few seconds; still inside the 2-minute push budget); `pages` log "stats.json: missing [], carried
      over []". Live: 20 clubs this season, 17 last season ("Not in the Premier League in 2025-26: Coventry, Hull,
      Ipswich"), Haaland's two seasons, progression ends 1st Arsenal 27 pts, 2nd Brighton, 3rd Man City, 4th Liverpool
      (matches ESPN's table); no error sections, no console errors. Local: 563 unit tests in 29 files, 48 e2e (16 tests
      × 3 widths), lint/typecheck/audit clean; main chunk 85 KB gzip, Statistics chunk 7 KB gzip.

Phase 9 decisions:

- **Team statistics from ESPN's core API**
  (`sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/<year>/types/1/teams/<id>/statistics`, CORS OK)
  via the pipeline, not the browser: 20 × ~24 KB per season would load on every visit; trimmed to 22 figures per club
  in `stats.json` (~160 KB with the players, loaded only on `#/stats`). Season years come from
  ESPN (`season.year`), not hard-coded. A 404 for a season = the club wasn't in the league ("absent"). A 0 where 0
  is impossible over a season (possession, passes, shots, corners, fouls, saves, tackles, interceptions, xG) is
  stored as null: ESPN reports 2024-25 possession as 0. xG/xGA are ESPN's averages per match, this season only.
- **One value per figure across the site:** this season's player figures use the same sources as the profile
  (ESPN squad statistics, FPL minutes); last season's player figures come from ESPN's core API on demand
  (`athleteSeason:<id>:<year>`, ESPN minutes), labelled so. A 404 there means no Premier League record that season.
- **Derived from FPL results (this season only):** home/away records and points/position after each gameweek.
  Order: points, goal difference, goals scored; clubs level on all three share a place (no further tie-break is
  guessed). A gameweek with some results missing is shown and marked in progress. Unit tests on the recorded
  fixtures: the derived table after the last gameweek equals ESPN's table, and FPL-derived clean sheets equal
  ESPN's, for all 20 clubs (also checked live on 2026-11-20).
- **Charts** (`src/components/charts.jsx`, plain SVG, no library): bars in one hue with the selected club in ink and
  bold (two cues); lines in the validated order blue, orange, aqua, yellow (`validate_palette.js` on #fafbf8: all
  checks pass; aqua and yellow are under 3:1, so every line has a direct end label, its own marker shape, a legend
  and a table view). Each chart has a text summary as its accessible name. Charts take their container's real width
  (ResizeObserver), so 12–13 px text stays that size on a phone.
- **Labels** are `<label for>` the control (not wrapping it), so each control's accessible name is exactly its label.
- **Not built:** previous-season player tables (600 requests) and previous-season progression (needs results per
  match for clubs no longer in the league); team xA (no source); other competitions (not in this data).

Phase 9 outcome: done. **Found in the live check (not fixed; affects the whole site):** GitLab Pages serves nothing
compressed: `index-*.js` arrives as 258 KB (85 KB gzipped), `news.json` 300 KB, `stats.json` 161 KB. Pages serves a
precompressed copy only when a `.gz` file exists beside the original. Fix: in the `pages` job, after `mv dist
public`, write `<file>.gz` for every .html/.js/.css/.json/.svg (`gzip -9 -c f > f.gz`; busybox gzip is in
node:22-alpine). That changes the deploy job, so it waits for the owner's go-ahead. **Done after the go-ahead:**
`scripts/precompress.mjs` (Node zlib, gzip and Brotli, text files over 1 KB) runs in the `pages` job; unit test checks
each copy decompresses to the original. Locally: 907 KB of text → 214 KB gzip, 178 KB Brotli.
Deployed by pipeline 3092390359 (`test` 70 s + `pages` 45 s). Live, by Accept-Encoding: main script 258 KB → 74 KB
Brotli / 85 KB gzip; news.json 300 KB → 58 KB / 73 KB; stats.json 161 KB → 15 KB / 20 KB; a client without
compression still gets the plain file. In the browser news.json transferred 57 KB; page and console clean.

Next recommended: **Phase 10 (Fantasy Premier League)**: FPL is already fetched by the pipeline (bootstrap-static
has prices, ownership, form, points, xG/xA; fixtures have difficulty). Check `element-summary` (per-player
fixtures and history) and rate limits before building the transfer assistant. Outstanding: compression (above),
`noImplicitAny` (196), deferred majors, the 56 players without FPL minutes, v1 open issues 3–10.

### Phase 10: Fantasy Premier League

- [x] Endpoints, reliability, rate limits and freshness checked (below), before building
- [x] `data/fpl.json` from the pipeline (separate from the ESPN files), validated, carried over on failure
- [x] FPL section `#/fpl`: players (price, ownership, points, form, upcoming fixtures and difficulty), filters
- [x] Transfer assistant: player out, budget calculator (bank + selling price by FPL's sell-on rule), alternatives
      by budget, form, fixtures and playing time; FPL player comparison
- [x] Rule 3 on the FPL page: `fpl.json` carries the ESPN name of each matched player, so the page runs the
      club pages' injury cross-check (`injuryReports`) over the news; a player FPL hasn't flagged but a recent
      reliable headline reports injured or a doubt shows "Reported injured · outlet · time", counts as doubtful (left
      out of the assistant unless doubtful players are included), and the comparison says "No flag", never "Available"
- [x] Assistant filter "Regular starters only" (60 %+ of the club's league minutes): on live data, players with
      10–40 % of the minutes reached the top 20 on form
- [x] Fixed site-wide: changing a filter or typing an amount moved focus to the main region and scrolled to the top
      (the "new page" effect ran on every address change). It now runs on `pageKey(route)`: page and view, not
      filters. Also fixes the Statistics filters and the compare pickers.
- [x] Unit and e2e tests; README (with a screenshot); CLAUDE.md route and data lists. Local: 589 unit tests in 31
      files (20 in `fpl.test.js`), 63 e2e (21 tests × 3 widths; 5 new FPL tests with axe and overflow checks, a
      key-by-key typing test that focus stays put, the rule-3 note, plus an FPL route in the reload test);
      lint/typecheck/format clean; main chunk 87 KB gzip (was 85: `parseFpl` sits with the data layer), FPL chunk
      7 KB gzip
- [x] Deploy and live check: pipeline 3092575834, `test` 71 s + `pages` 45 s (same as Phase 9: no new requests);
      `pages` log "fpl.json: 566 players"; meta.json `fpl` entry with no problems. Live fpl.json 178 KB → 23 KB
      Brotli / 30 KB gzip; 566 players, 546 with an ESPN name; next gameweek 11 (FPL). Live `#/fpl` and the
      assistant (out, bank, regular starters) load with no console errors.

Phase 10 outcome: done. Not built: a full 15-player squad builder (the site can't read anyone's FPL team, and a
hand-entered squad is Phase 12 territory, personalisation in `localStorage`); per-gameweek points history
(`element-summary`, one request per player). Outstanding: 20 of 566 FPL players have no ESPN match (no profile
link or injury cross-check for them); the FPL page's injury notes depend on news.json loading (without it the page
shows FPL's flags only); `noImplicitAny`, deferred majors and v1 open issues 3–10 as before.

Next recommended: **Phase 11 (match centre improvements)**: timeline, substitutions, cards, possession and shots
are in ESPN's summary already parsed for the match page; check what the summary gives for formation changes and
head-to-head before building.

FPL investigation (2026-11-20, from the pipeline's user agent):

| Endpoint                | Cache headers                               | Size   | Gives                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap-static/`     | `max-age=300, stale-if-error=3600`, CDN hit | 1.8 MB | 672 players: `now_cost`, `selected_by_percent`, `total_points`, `points_per_game`, `form`, `minutes`, `starts`, `status`, `chance_of_playing_next_round`, `news`, xG/xA, `ep_next`; gameweeks with deadlines; squad rules in `game_settings` (15 players, 3 per club, £100.0m, sell-on fee 0.5) |
| `fixtures/`             | `no-cache`, CDN hit                         | 346 KB | All 380 fixtures with gameweek and `team_h_difficulty` / `team_a_difficulty` (FPL's fixture difficulty, 1–5)                                                                                                                                                                                    |
| `element-summary/<id>/` | `no-cache`                                  | ~17 KB | One player's remaining fixtures and per-gameweek history                                                                                                                                                                                                                                        |
| `event-status/`         | `no-cache`                                  | 227 B  | Whether bonus points and the gameweek's points are final                                                                                                                                                                                                                                        |

- No CORS on any of them (as in v2's check): pipeline only. No rate-limit headers (`x-ratelimit`, `retry-after`)
  on any response; the API is unofficial and documents no limits. Responses come from a CDN cache (bootstrap up to
  5 minutes old), so FPL's own numbers lag by minutes, ours by up to the 4-hour pipeline interval: every FPL figure
  says when the pipeline collected it.
- **No new requests in Phase 10.** Upcoming fixtures and difficulty come from `fixtures/` and recent form from
  FPL's own `form` field (points per match over the last 30 days), both already fetched for `league.json`.
  `element-summary` for every player would be 672 requests per run (~4,000 a day) for per-gameweek history the
  assistant doesn't need: not used. CI minutes stay as they are.
- 106 of 672 players have `can_select: false` (all `status: "u"`, left the league or unavailable for the season):
  left out. `chance_of_playing_next_round: null` means no flag (fit), not 0 %.
- The site can't see anyone's FPL team (`entry/` needs sign-in and has no CORS), so the assistant asks for the
  money in the bank and, optionally, the price paid; it can't check the 3-per-club limit against a squad it can't
  see, and says so.

### Phase 11: match centre improvements

- [x] ESPN's match summary checked for what each item needs (below), before building
- [x] Timeline: ESPN's commentary (every shot, corner, foul, card, substitution, VAR decision), key events by default
- [x] Goals and assists, cards and substitutions by team
- [x] Possession, shots and shots on target compared visually (with the full stats table kept)
- [x] Formations: as ESPN publishes them, with the limit stated
- [x] Head-to-head: last meetings from ESPN, all competitions, competition named
- [x] Related news from this site's pipeline (stories tagged with both clubs, else either club around kick-off)
- [x] Live data told apart from periodically refreshed data: a match in play shows a "Live" badge and is fetched
      again every 60 s while the tab is visible (not 30 s: a forced reload reuses ESPN responses for 30 s, so 60 s is
      what really reaches the network); finished matches say "Final", unstarted ones say when updates begin;
      head-to-head says "past results, not live", related news shows its pipeline time
- [x] Unit and e2e tests; README; match screenshot. `CACHE_VERSION` 4 (summary shape changed). Local: 603 unit tests
      in 32 files (12 new in `match-centre.test.js`), 69 e2e (23 tests × 3 widths; 2 new: sections and toggles on a
      finished match, and a live match labelled and re-fetched after a minute); lint/typecheck/format clean; main
      chunk 88 KB gzip, match chunk 6 KB. One unreproduced e2e failure during development (page stuck on "Loading
      page…" under load); 54 repeated runs and the full suite passed afterwards
- [x] Deploy and live check: pipeline 3092631187, `test` 71 s + `pages` 46 s (no pipeline change). Live
      `#/match/401879240` (Man Utd 4–4 Aston Villa): Timeline with the key-events and full-commentary toggle, goals
      with assists by side, "Final" label, head-to-head "Man Utd 3 wins, 1 draw, Aston Villa 1 win" (equals ESPN's
      five listed meetings), related news, no console errors. The browser first showed the previous build until
      reloaded: the old index.html was still in its HTTP cache (see outstanding).

Phase 11 outcome: done. Not built: formation changes (ESPN publishes none; stated on the page); ESPN's
`lastFiveGames` (form is on club pages). Outstanding: after a deploy a returning visitor can be served the previous
index.html from the browser cache for a while (GitLab Pages' default caching; worth checking its headers in Phase 13);
the live poll was tested with a mocked in-play match only (no Premier League match was live during this session);
`noImplicitAny`, deferred majors and v1 open issues 3–10 as before.

Next recommended: **Phase 12 (personalisation)**: multiple followed clubs, favourite players, bookmarked news,
favourite matches, recently viewed, customisable home, theme, optional notifications; `localStorage` only.

ESPN summary check (2026-11-20, 6 finished matches, `site.api…/all/summary?event=<id>`, CORS OK, already used):

- `keyEvents`: goals (with `participants[1]` = the assister when ESPN names one, "Assisted by …" in the text),
  penalties, own goals, yellow and red cards, substitutions, period markers. Already parsed for "Key events".
- `commentary`: 80–120 entries per match with minute, text and a play type (`shot-on-target`, `shot-off-target`,
  `shot-blocked`, `shot-hit-woodwork`, `corner-awarded`, `offside`, `foul`, `handball`, `var---…`, cards,
  substitutions, goals, periods). The full timeline.
- `boxscore`: possession, shots, shots on target and 25 more team figures. Already in "Team stats".
- `rosters[].formation`: **one formation per team**, and no formation-change event in `keyEvents` or
  `commentary` in any match checked. Formation changes can't be shown without inventing them; the page shows the
  formation ESPN lists and says ESPN doesn't publish changes.
- `seasonseries` (type `head-to-head`): the clubs' last five meetings, any competition (`competitionName`), with
  scores and ESPN event ids (the match centre's `/all/summary` loads any of them).
- `news`: ESPN's general football headlines, not about the match: not used. Related news comes from this site's
  own tagged stories instead.
- `lastFiveGames`: each club's last five results (any competition). Not needed: form is already on club pages.

### Phase 13: design and user experience

Phase 12 (personalisation) is skipped for now at the owner's request (2026-11-20); its brief stays above.

Survey (2026-11-20):

- Colours are Tailwind tokens in `src/index.css` (`chalk`, `ink`, `muted`, `line`, `field`, `turf`, `win`, `loss`,
  `draw`, `warn`) plus 24 `bg-white` surfaces, 3 `bg-ink text-white` pills, a hard-coded yellow-card colour and the
  chart colours in `charts.jsx`. The club accent is computed against the light page only (`lib/accent.js`).
- `win`, `loss`, `warn` and `draw` are used both as text on the page and as fills under white text. No single
  colour can do both on a dark page (white text needs a dark fill; text on a dark page needs a light colour), so dark
  mode gives those fills their own value.
- GitLab Pages sends `Cache-Control: max-age=600` for every file and can't be configured (no custom headers), so
  for up to 10 minutes after a deploy a returning visitor can get the previous `index.html`. Fixed in the app: the
  build writes `version.json`; the app checks it uncached and offers a reload when a newer build is live.

- [ ] Dark mode: tokens for both themes, a System / Light / Dark control (stored in `localStorage`, applied before
      first paint), club accents and chart colours that pass AA on both, `color-scheme` for native controls
- [ ] Responsive navigation: current page marked (`aria-current`) and visible at 375 px with the theme control
- [ ] Skeleton loading in place of "Loading…" text, for sections and lazy pages
- [ ] Empty and error states: consistent, with an icon and a next step
- [ ] Search: "/" shortcut from anywhere, result count announced, clear button
- [ ] Mobile standings, match cards, player cards: checked at 375 px, fixed where they fall short
- [ ] New-version notice (the Pages caching above)
- [ ] Tests (axe in dark mode too), README, deploy and live check
