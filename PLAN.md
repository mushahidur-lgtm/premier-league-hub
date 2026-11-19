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
from GitLab's runners. Never scan feed ids in bulk again. The pipeline fetches 57 feeds, 6 at a time, with a 15 s
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

- [ ] Player tagging across 20 squads with collision handling (full name, then surname + club context; never bare
      surname across clubs)
- [ ] Injury cross-check (rule 3); simplified league-wide transfer feed (confirmed vs reported, outlet tier)
- [ ] Tricky-headline tests; no false "all fit" in fixtures; deploy

### Phase 5: polish

- [ ] README with Playwright screenshots + architecture decisions; Open Graph image and tags; performance pass
- [ ] Final review against the prompt checklist; open-issues list for later versions

## Decisions

- **JavaScript + JSDoc + `// @ts-check`** in `src/lib` and `src/config`, not TypeScript. Arsenal Hub is JS, so Phase 2
  ports straight across with its tests, with no type-stripping step.
- **Dependency majors match Arsenal Hub** (React 18, Vite 6, plugin-react 4, Vitest 3, Tailwind 4) so ported code and
  tests behave the same. Scaffolded by hand because `npm create vite` now installs React 19.
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
- `npm audit` reports advisories in Vitest 3's dev-only dependencies (`@vitest/mocker`, `tinypool`); the fix is Vitest
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
