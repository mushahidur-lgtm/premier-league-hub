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

- [ ] `src/config/clubs.js` for all 20 clubs (ESPN ids from the `eng.1` teams list; crest URL; colours)
- [ ] Check every candidate feed URL (BBC, Guardian, Sky, league-wide); keep working ones, record results in `clubs.js`
- [ ] `scripts/fetch-data.mjs` (no deps; RSS/Atom parser; de-dupe; club tagging; `news.json` + `meta.json`) + tests
- [ ] `.gitlab-ci.yml` (test → deploy, `pages` job, node_modules cache on lockfile, no Playwright)
- [ ] Placeholder page reads `data/meta.json`; first deploy (**ask first**)
- [ ] Measure pipeline duration; compute schedule interval for < ~300 min/month; write the arithmetic in README
- [ ] Create pipeline schedule, America/Toronto (**ask first**)
- [ ] Verify Pages URL loads, routes survive refresh, `data/news.json` is served

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
- `npm audit` reports advisories in Vitest 3's dev-only dependencies (`@vitest/mocker`, `tinypool`); the fix is Vitest
  5 (breaking). They don't ship to the site. Revisit after the Phase 2 port by upgrading Vitest and Vite together.
