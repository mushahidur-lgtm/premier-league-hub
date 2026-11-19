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
- [ ] Create pipeline schedule, America/Toronto (**ask first**)
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

- [ ] Port team-agnostic `lib/` modules + tests from Arsenal Hub, parameterised by club
- [ ] Nothing in `src/` mentions Arsenal except `clubs.js`; ported tests pass

### Phase 3: pages and design

- [ ] Visual direction with `frontend-design`; checks with `web-design-guidelines` and `vercel-react-best-practices`
- [ ] League home, club pages, match centre, club picker + theming, search, lazy routes
- [ ] Playwright (Chromium) with recorded fixtures; axe clean; 375 px + desktop; main chunk < ~150 KB gzip; deploy

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
