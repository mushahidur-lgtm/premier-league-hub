# Premier League Hub

An unofficial fan site for all 20 Premier League clubs: live table, fixtures and results in your timezone, club pages,
match centre, news with source credibility, and a "my club" theme. Successor to
[Arsenal Hub](https://github.com/mushahidur-lgtm/arsenal-hub).

Live: **https://mushahidur.gitlab.io/premier-league-hub/**

> Status: Phase 1 (data pipeline live, placeholder page). See [PLAN.md](PLAN.md). Screenshots come in Phase 5.

## Commands

| Command                       | What it does                              |
| ----------------------------- | ----------------------------------------- |
| `npm run dev`                 | Dev server                                |
| `npm run build`               | Production build to `dist/`               |
| `npm run preview`             | Serve the build at `/premier-league-hub/` |
| `npm test`                    | Vitest unit tests                         |
| `npm run lint`                | ESLint (including React hooks rules)      |
| `npm run format:check`        | Prettier check (`npm run format` to fix)  |
| `node scripts/fetch-data.mjs` | Fetch news feeds into `public/data/`      |

## Data pipeline

`scripts/fetch-data.mjs` (Node 22, no dependencies) fetches each club's BBC Sport, Guardian and Sky Sports feeds plus
three league-wide feeds (57 in all), de-duplicates the stories, tags them with clubs, and writes `public/data/news.json`
and `public/data/meta.json` (generated time and per-feed status). The site reads them same-origin, so no CORS relays
are involved. The GitLab `pages` job runs it before every build, on push and on a schedule.

## CI minutes budget

GitLab Free gives 400 compute minutes a month. The target is under 300, leaving headroom.

Measured on 2026-11-19 (pipeline 3090953378):

| Pipeline                       | Jobs           | Measured    | Budgeted as |
| ------------------------------ | -------------- | ----------- | ----------- |
| Push to `main`                 | `test`+`pages` | 26 s + 27 s | 2 min       |
| Scheduled refresh (pages only) | `pages`        | 27 s        | 1 min       |

The budget rounds up generously for cache misses, slow runners and feeds that hit the 15 s timeout.

| Schedule          | Runs a month (× 30.4 days) | Scheduled minutes | Left for pushes (of 300) | Pushes that allows |
| ----------------- | -------------------------- | ----------------- | ------------------------ | ------------------ |
| Every 2 hours     | 12 × 30.4 = 365            | 365               | none                     | over budget        |
| Every 3 hours     | 8 × 30.4 = 243             | 243               | 57                       | ~28                |
| **Every 4 hours** | **6 × 30.4 = 183**         | **183**           | **117**                  | **~58**            |
| Every 6 hours     | 4 × 30.4 = 122             | 122               | 178                      | ~89                |

**Choice: every 4 hours** (cron `0 */4 * * *`, America/Toronto: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00). It keeps
news under four hours old and leaves room for about 58 pushes a month while the remaining phases are built. At the
measured times (not the rounded budget) the same schedule uses about 82 minutes a month.

## Architecture decisions

See the "Decisions" section of [PLAN.md](PLAN.md). The full write-up lands here in Phase 5.

## Disclaimer

Unofficial fan site, not affiliated with the Premier League or any club. Data from ESPN; news links to the original
outlets. MIT licensed (see [LICENSE](LICENSE)).
