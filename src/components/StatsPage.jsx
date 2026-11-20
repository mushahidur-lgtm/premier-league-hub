import { cloneElement, useId, useMemo } from "react";
import { CLUBS, clubBySlug } from "../config/clubs.js";
import { useSource } from "../lib/data.js";
import { ordinal } from "../lib/format.js";
import { toHash } from "../lib/route.js";
import {
  homeAway,
  metricBy,
  PLAYER_METRICS,
  playerValue,
  progression,
  rankBy,
  TEAM_METRICS,
  teamValue,
} from "../lib/stats.js";
import { titleFor } from "../lib/titles.js";
import { BarChart, LineChart, SeriesKey } from "./charts.jsx";
import { Stat } from "./PlayerPage.jsx";
import { Crest, FreshnessLine, Section, useTitle } from "./ui.jsx";

const VIEWS = [
  ["teams", "Teams"],
  ["players", "Players"],
  ["progression", "Points and position"],
];

const control = "min-h-11 rounded-md border border-line bg-white px-2";

/** A number for display: the metric's decimals, its unit, "–" when unknown. */
const show = (v, metric, per) => {
  if (v == null) return null;
  const d = per && metric.kind === "count" ? 2 : (metric.decimals ?? 0);
  return `${v.toFixed(d)}${metric.unit ?? ""}`;
};

/** A labelled control: the label names the control by id, so its accessible name is exactly the label. */
function Field({ label, children }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {cloneElement(children, { id })}
    </div>
  );
}

function ClubSelect({ value, onChange, label = "Club", allLabel = "All clubs" }) {
  return (
    <Field label={label}>
      <select className={control} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{allLabel}</option>
        {CLUBS.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ───────────────────────── Teams ───────────────────────── */

function ClubDetail({ slug, season, league, isCurrent }) {
  const club = clubBySlug(slug);
  const entry = season.teams[slug];
  if (!club) return null;
  if (!entry || entry.status !== "ok")
    return (
      <p className="rounded-md bg-field px-3 py-4 text-muted">
        {entry?.status === "absent"
          ? `${club.name} weren’t in the Premier League in ${season.label}.`
          : `ESPN’s ${season.label} figures for ${club.name} are unavailable right now.`}
      </p>
    );
  const ok = Object.entries(season.teams).filter(([, t]) => t.status === "ok");
  const ha = isCurrent ? homeAway(league.data?.fixtures ?? null, slug) : null;
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 font-display text-xl font-semibold">
        <Crest espnId={club.espnId} size={24} /> {club.name}, {season.label}
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        {TEAM_METRICS.map((m) => {
          const ranked = rankBy(ok, ([, t]) => teamValue(t, m, false), m.lowerIsBetter);
          const r = ranked.find((x) => x.item[0] === slug);
          return (
            <div key={m.key} className="border-l-2 border-line pl-3">
              <dt className="text-sm text-muted">{m.label}</dt>
              <dd className="num text-2xl font-bold">
                <Stat value={show(r?.value ?? null, m, false)} />
              </dd>
              {r?.rank != null && (
                <dd className="text-sm text-muted">
                  {ordinal(r.rank)} of {ranked.filter((x) => x.value != null).length}
                  {m.lowerIsBetter ? " (fewest first)" : ""}
                </dd>
              )}
            </div>
          );
        })}
      </dl>
      {ha && (
        <div>
          <h4 className="mb-1 font-semibold">Home and away, {season.label}</h4>
          <table className="w-full max-w-xl border-collapse text-left">
            <caption className="sr-only">
              {club.name} home and away records, from Fantasy Premier League’s results
            </caption>
            <thead>
              <tr className="border-b-2 border-ink text-sm text-muted">
                <th scope="col" className="py-1 pr-2 font-semibold">
                  Venue
                </th>
                {["P", "W", "D", "L", "GF", "GA", "CS", "Pts"].map((h) => (
                  <th key={h} scope="col" className="num px-1 py-1 text-right font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Home", ha.home],
                ["Away", ha.away],
              ].map(([k, r]) => (
                <tr key={k} className="border-b border-line">
                  <th scope="row" className="py-1.5 pr-2 font-normal">
                    {k}
                  </th>
                  {[r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.cleanSheets, r.points].map(
                    (v, i) => (
                      <td key={i} className="num px-1 py-1.5 text-right">
                        {v}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <FreshnessLine
            label="Home and away: from Fantasy Premier League's results, via this site's pipeline (this season only)"
            at={league.data?.gameweeksAt}
          />
        </div>
      )}
    </div>
  );
}

function TeamsView({ data, league, route, go }) {
  const season = data.seasons.find((s) => s.year === route.season) ?? data.seasons[0];
  const isCurrent = season === data.seasons[0];
  const metric = metricBy(TEAM_METRICS, route.metric);
  const per = route.per && metric.kind === "count";
  const selected = route.clubs[0] ?? null;
  const ok = Object.entries(season.teams).filter(([, t]) => t.status === "ok");
  const ranked = rankBy(ok, ([, t]) => teamValue(t, metric, per), metric.lowerIsBetter);
  const known = ranked.filter((r) => r.value != null);
  const unknown = ranked.filter((r) => r.value == null).map((r) => clubBySlug(r.item[0])?.shortName);
  const absent = Object.entries(season.teams)
    .filter(([, t]) => t.status === "absent")
    .map(([s]) => clubBySlug(s)?.shortName);
  const leader = known[0];
  const rows = known.map(({ item: [slug], value }) => ({
    key: slug,
    label: clubBySlug(slug)?.shortName ?? slug,
    value: /** @type {number} */ (value),
    display: show(value, metric, per)?.replace(metric.unit ?? "", "") ?? "",
    highlight: slug === selected,
  }));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Season">
          <select className={control} value={season.year} onChange={(e) => go({ season: Number(e.target.value) })}>
            {data.seasons.map((s) => (
              <option key={s.year} value={s.year}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Statistic">
          <select className={control} value={metric.key} onChange={(e) => go({ metric: e.target.value })}>
            {TEAM_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <ClubSelect value={selected} onChange={(c) => go({ clubs: c ? [c] : [] })} />
        {metric.kind === "count" && (
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-5" checked={per} onChange={(e) => go({ per: e.target.checked })} />
            Per match
          </label>
        )}
      </div>

      <figure>
        <figcaption className="mb-2">
          <span className="font-display text-xl font-semibold">
            {metric.label}
            {per ? " per match" : ""}, {season.label}
          </span>
          <span className="block text-sm text-muted">
            {metric.lowerIsBetter ? "Fewest first." : "Most first."}
            {metric.kind === "rate" && metric.key.endsWith("PerMatch") ? " ESPN’s average per match." : ""}
            {!per && metric.kind === "count" ? " Clubs may have played different numbers of matches." : ""}
          </span>
        </figcaption>
        {rows.length ? (
          <BarChart
            rows={rows}
            unit={metric.unit ?? ""}
            summary={`Bar chart: ${metric.label}${per ? " per match" : ""}, ${season.label}, ${rows.length} clubs. ${
              leader
                ? `${metric.lowerIsBetter ? "Lowest" : "Highest"}: ${clubBySlug(leader.item[0])?.name}, ${show(leader.value, metric, per)}.`
                : ""
            }`}
          />
        ) : (
          <p className="rounded-md bg-field px-3 py-6 text-muted">
            ESPN has no {metric.label.toLowerCase()} figures for {season.label}.
          </p>
        )}
        {(unknown.length > 0 || absent.length > 0) && (
          <p className="mt-2 text-sm text-muted">
            {unknown.length > 0 && <>No figure from ESPN: {unknown.join(", ")}. </>}
            {absent.length > 0 && (
              <>
                Not in the Premier League in {season.label}: {absent.join(", ")}.
              </>
            )}
          </p>
        )}
        {rows.length > 0 && (
          <details className="mt-2">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
              Show as a table
            </summary>
            <table className="w-full max-w-md border-collapse text-left">
              <caption className="sr-only">
                {metric.label}, {season.label}, ranked
              </caption>
              <thead>
                <tr className="border-b-2 border-ink text-sm text-muted">
                  <th scope="col" className="py-1 pr-2 font-semibold">
                    #
                  </th>
                  <th scope="col" className="py-1 font-semibold">
                    Club
                  </th>
                  <th scope="col" className="num py-1 text-right font-semibold">
                    {metric.short}
                    {per ? " per match" : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {known.map((r, i) => (
                  <tr key={r.item[0]} className="border-b border-line">
                    <td className="num py-1 pr-2">{i > 0 && r.rank === known[i - 1].rank ? "=" : r.rank}</td>
                    <td className="py-1">{clubBySlug(r.item[0])?.name}</td>
                    <td className="num py-1 text-right">{show(r.value, metric, per)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </figure>
      <FreshnessLine label={`Team statistics: ESPN, ${season.label}, via this site's pipeline`} at={season.asOf} />

      {selected && <ClubDetail slug={selected} season={season} league={league} isCurrent={isCurrent} />}
    </div>
  );
}

/* ───────────────────────── Players ───────────────────────── */

function PlayerPanel({ player, data }) {
  const club = clubBySlug(player.club);
  const previous = data.seasons[1];
  const prev = useSource(previous ? `athleteSeason:${player.id}:${previous.year}` : null);
  const cols = [
    ["Appearances", "apps"],
    ["Minutes", "minutes"],
    ["Goals", "goals"],
    ["Assists", "assists"],
    ["Shots", "shots"],
    ["Shots on target", "shotsOnTarget"],
    ["Yellow cards", "yellowCards"],
  ];
  return (
    <div className="space-y-2 rounded-md border border-line bg-white p-4">
      <h3 className="flex flex-wrap items-center gap-2 font-display text-xl font-semibold">
        <Crest espnId={club?.espnId} size={24} />
        <a href={toHash({ name: "player", playerId: player.id })} className="underline-offset-2 hover:underline">
          {player.name}
        </a>
        <span className="text-base font-normal text-muted">{club?.shortName}</span>
      </h3>
      <table className="w-full max-w-xl border-collapse text-left">
        <caption className="sr-only">{player.name}, this season and last</caption>
        <thead>
          <tr className="border-b-2 border-ink text-sm text-muted">
            <th scope="col" className="py-1 pr-2 font-semibold">
              Statistic
            </th>
            <th scope="col" className="num px-2 py-1 text-right font-semibold">
              {data.seasons[0]?.label}
            </th>
            {previous && (
              <th scope="col" className="num py-1 pl-2 text-right font-semibold">
                {previous.label}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {cols.map(([label, key]) => (
            <tr key={key} className="border-b border-line">
              <th scope="row" className="py-1 pr-2 font-normal">
                {label}
              </th>
              <td className="num px-2 py-1 text-right">
                <Stat value={player[key] ?? null} />
              </td>
              {previous && (
                <td className="num py-1 pl-2 text-right">
                  {prev.status === "loading" ? "…" : <Stat value={prev.data?.[key] ?? null} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-muted">
        This season: ESPN squad statistics, minutes from Fantasy Premier League (as on the profile).{" "}
        {previous &&
          (prev.status === "error"
            ? `${previous.label}: ESPN unavailable (${prev.error}).`
            : prev.data === null && prev.status !== "loading"
              ? `${previous.label}: ESPN has no Premier League figures for this player that season.`
              : `${previous.label}: ESPN season statistics, ESPN minutes.`)}{" "}
        “–” means not provided, not zero.
      </p>
      <p>
        <a
          href={toHash({ name: "compare", a: player.id, b: null })}
          className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-2"
        >
          Compare with another player
        </a>
      </p>
    </div>
  );
}

function PlayersView({ data, route, go }) {
  const metric = metricBy(PLAYER_METRICS, route.metric);
  const per = route.per && metric.kind === "count";
  const club = route.clubs[0] ?? null;
  const pool = (data.players ?? []).filter((p) => !club || p.club === club);
  const ranked = rankBy(pool, (p) => playerValue(p, metric, per), metric.lowerIsBetter)
    .filter((r) => r.value != null && (r.value > 0 || metric.lowerIsBetter))
    .slice(0, 25);
  const squad = club ? [...pool].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const selected = route.player ? (data.players ?? []).find((p) => p.id === route.player) : null;
  if (!data.players)
    return <p className="rounded-md bg-field px-3 py-6 text-muted">Player figures are unavailable right now.</p>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Statistic">
          <select className={control} value={metric.key} onChange={(e) => go({ metric: e.target.value })}>
            {PLAYER_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <ClubSelect value={club} onChange={(c) => go({ clubs: c ? [c] : [], player: null })} />
        {club && (
          <Field label="Player">
            <select
              className={control}
              value={route.player ?? ""}
              onChange={(e) => go({ player: e.target.value || null })}
            >
              <option value="">Choose a player</option>
              {squad.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {metric.kind === "count" && (
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-5" checked={per} onChange={(e) => go({ per: e.target.checked })} />
            Per 90 minutes
          </label>
        )}
      </div>
      {!club && <p className="text-sm text-muted">Choose a club to pick one player and see last season too.</p>}
      {selected && <PlayerPanel player={selected} data={data} />}

      <div>
        <h2 className="font-display text-xl font-semibold">
          {metric.label}
          {per ? " per 90 minutes" : ""}, {data.seasons[0]?.label}
          {club ? `, ${clubBySlug(club)?.name}` : ""}
        </h2>
        <p className="mb-2 text-sm text-muted">
          This season only: player tables come from the current squads.{" "}
          {per ? "Per 90 uses FPL minutes and needs at least 90 played. " : ""}
          {metric.source === "FPL" ? "Expected goals and assists are Fantasy Premier League’s figures. " : ""}
          Top 25{metric.lowerIsBetter ? "" : " above zero"}.
        </p>
        {ranked.length ? (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                {metric.label}, ranked{club ? ` within ${clubBySlug(club)?.name}` : ""}
              </caption>
              <thead>
                <tr className="border-b-2 border-ink text-sm text-muted">
                  <th scope="col" className="w-8 py-1 pr-1 text-right font-semibold">
                    #
                  </th>
                  <th scope="col" className="py-1 pl-2 font-semibold">
                    Player
                  </th>
                  <th scope="col" className="num px-1 py-1 text-right font-semibold">
                    {metric.short}
                  </th>
                  <th scope="col" className="num px-1 py-1 text-right font-semibold">
                    <abbr title="Appearances">Apps</abbr>
                  </th>
                  <th scope="col" className="num py-1 pl-1 text-right font-semibold">
                    <abbr title="Minutes (Fantasy Premier League)">Min</abbr>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => {
                  const p = r.item;
                  const c = clubBySlug(p.club);
                  const mine = p.id === route.player;
                  return (
                    <tr key={p.id} className={`border-b border-line ${mine ? "bg-accent-soft font-semibold" : ""}`}>
                      <td className="num py-1.5 pr-1 text-right">
                        {i > 0 && r.rank === ranked[i - 1].rank ? "=" : r.rank}
                      </td>
                      <td className="py-1.5 pl-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <Crest espnId={c?.espnId} size={18} />
                          <a
                            href={toHash({ name: "player", playerId: p.id })}
                            className="inline-flex min-h-11 min-w-0 items-center truncate underline-offset-2 hover:underline sm:min-h-0"
                          >
                            {p.name}
                          </a>
                          <span className="text-sm text-muted">{c?.abbr}</span>
                        </span>
                      </td>
                      <td className="num px-1 py-1.5 text-right text-lg font-bold">{show(r.value, metric, per)}</td>
                      <td className="num px-1 py-1.5 text-right">
                        <Stat value={p.apps ?? null} />
                      </td>
                      <td className="num py-1.5 pl-1 text-right text-muted">
                        <Stat value={p.minutes ?? null} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-md bg-field px-3 py-6 text-muted">No player has a figure for this yet.</p>
        )}
      </div>
      <FreshnessLine
        label="Players: ESPN squad statistics with Fantasy Premier League minutes, xG and xA, via this site's pipeline"
        at={data.playersAt}
      />
    </div>
  );
}

/* ───────────────────────── Progression ───────────────────────── */

function ProgressionView({ league, route, go, myClub }) {
  const prog = useMemo(() => progression(league.data?.fixtures ?? null), [league.data]);
  const rounds = prog?.rounds ?? [];
  const last = rounds.at(-1);
  const byPoints = route.metric === "points";
  const latestOrder = last ? Object.entries(last.table).sort((a, b) => a[1].position - b[1].position) : [];
  const chosen = route.clubs.length
    ? route.clubs
    : [...new Set([myClub?.slug, ...latestOrder.map(([s]) => s)].filter(Boolean))].slice(0, 4);
  if (!league.data?.fixtures)
    return <p className="rounded-md bg-field px-3 py-6 text-muted">Results are unavailable right now.</p>;
  if (!rounds.length)
    return <p className="rounded-md bg-field px-3 py-6 text-muted">No gameweek has been played yet.</p>;
  const series = chosen.map((slug) => {
    const c = clubBySlug(slug);
    return {
      key: slug,
      label: c?.name ?? slug,
      short: c?.abbr ?? slug,
      points: rounds.map((r) => {
        const t = r.table[slug];
        return {
          x: r.gameweek,
          y: byPoints ? t.points : t.position,
          text: byPoints ? `${t.points} pts` : `${t.tied ? "=" : ""}${ordinal(t.position)}, ${t.points} pts`,
        };
      }),
    };
  });
  const xs = rounds.map((r) => r.gameweek);
  const maxPts = Math.max(3, ...series.flatMap((s) => s.points.map((p) => p.y)));
  const yTicks = byPoints ? Array.from({ length: Math.floor(maxPts / 5) + 1 }, (_, i) => i * 5) : [1, 5, 10, 15, 20];
  const remove = (slug) => go({ clubs: chosen.filter((s) => s !== slug) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Show">
          <select
            className={control}
            value={byPoints ? "points" : "position"}
            onChange={(e) => go({ metric: e.target.value })}
          >
            <option value="position">League position</option>
            <option value="points">Points</option>
          </select>
        </Field>
        {chosen.length < 4 && (
          <ClubSelect
            label="Add a club"
            allLabel="Choose a club"
            value={null}
            onChange={(c) => c && !chosen.includes(c) && go({ clubs: [...chosen, c] })}
          />
        )}
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Clubs shown">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2 rounded-md border border-line bg-white py-1 pr-1 pl-2">
            <SeriesKey i={i} />
            <span className="font-semibold">{s.label}</span>
            {chosen.length > 1 && (
              <button
                type="button"
                onClick={() => remove(s.key)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-field"
                aria-label={`Remove ${s.label}`}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <figure>
        <LineChart
          series={series}
          xs={xs}
          yMin={byPoints ? 0 : 1}
          yMax={byPoints ? maxPts : 20}
          invert={!byPoints}
          yTicks={yTicks}
          yLabel={byPoints ? "Points" : "Position"}
          summary={`Line chart: ${byPoints ? "points" : "league position"} after each gameweek, ${series
            .map((s) => `${s.label} ${s.points.at(-1)?.text}`)
            .join("; ")}.`}
        />
        <figcaption className="mt-2 text-sm text-muted">
          After each gameweek of this season, from Fantasy Premier League’s results (gameweeks as FPL numbers them).
          Position is by points, then goal difference, then goals scored; clubs level on all three share a place (=).
          {last && !last.complete ? ` Gameweek ${last.gameweek} is still in progress.` : ""} This season only.
        </figcaption>
      </figure>
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Show as a table</summary>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{byPoints ? "Points" : "Position"} after each gameweek</caption>
            <thead>
              <tr className="border-b-2 border-ink text-sm text-muted">
                <th scope="col" className="py-1 pr-2 font-semibold">
                  Gameweek
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="num px-2 py-1 text-right font-semibold">
                    {s.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((r, i) => (
                <tr key={r.gameweek} className="border-b border-line">
                  <th scope="row" className="py-1 pr-2 font-normal">
                    {r.gameweek}
                    {r.complete ? "" : " (in progress)"}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="num px-2 py-1 text-right">
                      {s.points[i].text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <FreshnessLine label="Results: Fantasy Premier League, via this site's pipeline" at={league.data?.gameweeksAt} />
    </div>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export default function StatsPage({ route, myClub }) {
  const stats = useSource("stats");
  const league = useSource("league");
  useTitle(titleFor(route));
  /** Filters live in the address; changing one replaces the entry so Back leaves the page. */
  const go = (patch) => window.location.replace(toHash({ ...route, ...patch }));
  const viewHref = (view) => toHash({ ...route, view, metric: null, per: false, player: null });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-bold">Statistics</h1>
        <p className="mt-1 text-muted">Competition: Premier League. Cups and European matches aren’t in this data.</p>
      </div>
      <nav aria-label="Statistics views" className="flex flex-wrap gap-1 border-b border-line">
        {VIEWS.map(([key, label]) => (
          <a
            key={key}
            href={viewHref(key)}
            aria-current={route.view === key ? "page" : undefined}
            className={`inline-flex min-h-11 items-center border-b-2 px-3 font-semibold ${
              route.view === key ? "border-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </a>
        ))}
      </nav>
      {route.view === "progression" ? (
        <Section id="progression-heading" title="Points and position" state={league} sourceLine={false}>
          {() => <ProgressionView league={league} route={route} go={go} myClub={myClub} />}
        </Section>
      ) : (
        <Section
          id={`${route.view}-heading`}
          title={route.view === "players" ? "Players" : "Teams"}
          state={stats}
          sourceLine={false}
          empty="No statistics published yet."
        >
          {(data) =>
            route.view === "players" ? (
              <PlayersView data={data} route={route} go={go} />
            ) : data.seasons.length ? (
              <TeamsView data={data} league={league} route={route} go={go} />
            ) : (
              <p className="rounded-md bg-field px-3 py-6 text-muted">Team statistics are unavailable right now.</p>
            )
          }
        </Section>
      )}
    </div>
  );
}
