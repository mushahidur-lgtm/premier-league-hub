# CLAUDE.md

Premier League Hub: unofficial fan site for all 20 Premier League clubs. Successor to Arsenal Hub
(https://github.com/mushahidur-lgtm/arsenal-hub). Hosted on GitLab Pages at
`https://<username>.gitlab.io/premier-league-hub/`.

## Working rules

- **One phase per session.** Start by reading this file and `PLAN.md`; do only the requested phase; tick items in
  `PLAN.md` as you go; stop, commit and summarise (what was done, what the next phase needs).
- Usage-limited plan: read only the files the phase needs; don't re-read the whole repo; don't run expensive things the
  phase doesn't need.
- Small, meaningful commits. Push at the end of each phase to **both** remotes: `git push origin main` (GitLab, the
  main remote and the only one that deploys) and `git push github main` (GitHub mirror, no CI or hosting).
  `glab` is at `%LOCALAPPDATA%\Programs\glab\glab.exe`; `gh` is on PATH.
- **Ask first** before: creating the GitLab project, the first push, creating the pipeline schedule.
- If the plan or prompt is wrong (endpoint without CORS, dead feed, GitLab works differently), don't work around it
  silently: note it under "Prompt corrections" in `PLAN.md`, pick the simplest fix within the rules, and say so in the
  summary.
- Running out of room: stop at the last passing commit and write where you got to in `PLAN.md`.

## Stack

React 18 · Vite 6 · Tailwind v4 (`@tailwindcss/vite`) · lucide-react · Vitest 5 (jsdom) · ESLint 9 flat config
(react-hooks) · Prettier 3 · Playwright (Phase 3, local only, Chromium while building). Node 22.

JavaScript with JSDoc types; every file in `src/lib` and `src/config` starts with `// @ts-check`.

## Commands

```
npm run dev | build | preview
npm test                      # vitest run (tests/unit)
npm run lint                  # eslint .
npm run format                # prettier --write .  (format:check verifies)
node scripts/fetch-data.mjs   # Phase 1: writes public/data/news.json + meta.json
```

Before every commit: `npm run lint && npm test && npm run build`.

## Conventions

- Hash routing (`#/`, `#/club/<slug>`, `#/match/<event-id>`, `#/search?q=`), parsed in `src/lib/route.js`.
- Vite `base` comes from `BASE` in `src/config/site.js` (change it if the project is renamed).
- Everything club-specific lives in `src/config/clubs.js` (ESPN id, slug, short name, colours, feeds). Nothing else in
  `src/` may mention a specific club.
- Pure logic in `src/lib` (unit-tested); components in `src/components`; routes lazy-loaded except home.
- Every data section has loading, empty, stale and error states, and shows its source and fetch time.
- Accessibility: WCAG AA contrast (also for club accent colours), 44 px touch targets, visible focus, skip link, correct
  `lang` and per-route titles. Mobile first at 375 px, no horizontal overflow.
- Reuse Arsenal Hub code: clone it to a temp folder **outside** this repo and copy team-agnostic modules and their
  tests. Never copy its `h.txt` or its dev CORS proxy.
- No Premier League logo or wordmark. ESPN CDN club crests are fine.

## Rules from the Arsenal Hub review (apply all)

1. Don't call ESPN's `/teams/:id` endpoint (no CORS; its data is already in schedule + standings).
2. No public CORS relays (allorigins, codetabs) and no rss2json in production. News comes from the data pipeline
   (`scripts/fetch-data.mjs` → `public/data/*.json`, same-origin).
3. Injury consistency: when a recent injury story from a reliable outlet names a player, show a "reported injured ·
   outlet · time" note on that player rather than an "all fit" message that contradicts the headlines.
4. Lazy-load every route except home; keep the main JS chunk under ~150 KB gzipped.
5. ESLint (with React hooks rules) and Prettier from day one, plus a `lint` script.
6. MIT `LICENSE`, README with screenshots and an architecture-decisions section. Never commit scratch files, HTTP dumps
   or anything with IPs or tokens (see `.gitignore`).

## Data

- Browser, live: ESPN `site.api.espn.com` schedule, standings, roster, match summary (CORS OK). Keep Arsenal Hub's
  shared in-flight requests, short memo and last-good-copy cache.
- Pipeline: `scripts/fetch-data.mjs`, Node 22, **no npm dependencies**. Fetches feeds, de-duplicates, tags clubs and
  players, writes `public/data/news.json` + `public/data/meta.json` (generated time, per-feed status).
- `public/data/*.json` is generated in CI and git-ignored.

## CI (GitLab)

`node:22-alpine`; stages `test` → `deploy`; `pages` job = fetch-data → build → `mv dist public`; runs on the default
branch and on schedules. Lint + unit tests on MRs and the default branch. **No Playwright in CI.** Budget: under ~300 of
the 400 free CI minutes a month, including pushes; schedule timezone America/Toronto.
