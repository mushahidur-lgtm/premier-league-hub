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

1. **Home table form column.** Needs 20 club schedules in the browser (40 requests). Better: have the pipeline write
   `data/form.json` from the schedules it could fetch alongside the rosters.
2. **Gameweek labels.** The default scoreboard has no `week`; fixtures are grouped by date.
3. **Dark theme** (light only in v1).
4. **Per-route link previews** (club and match OG cards) need prerendered HTML per route, which hash routing can't
   give; would mean moving to path routing with a Pages 404 fallback.
5. **Player-tagging misses:** brothers in one story (Pierce/Shea Charles); a two-word name opening a sentence tags its
   second word.
6. **Transfer feed** still lets some round-ups through as "Reported" (for example "Ipswich latest: What are the club
   targeting in January?"). A club-page transfer list (`transferFeed(stories, { club })`) was not added.
7. **Type checking:** files carry `// @ts-check` but nothing runs `tsc --noEmit`; adding it would surface loose JSDoc
   in the ported modules.
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
- [ ] 6.5 QA: unit, e2e at 375/768/1280, axe, console errors, every route survives a refresh; deploy and live check

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
