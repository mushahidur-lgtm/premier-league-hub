import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { clubBySlug } from "../config/clubs.js";
import { useSource } from "../lib/data.js";
import { fmtLongDay, tzShort } from "../lib/format.js";
import {
  defaultGameweek,
  filterCounts,
  filterMatches,
  fixtureAsMatch,
  gameweekMatches,
  keyFixtures,
  scoreboardDates,
} from "../lib/league.js";
import { toHash } from "../lib/route.js";
import { MatchesByDay, MatchRow } from "./blocks.jsx";
import { btn, Crest, FreshnessLine, Section } from "./ui.jsx";

const FPL_LIST = "Gameweeks and fixture list: Fantasy Premier League, via this site's pipeline";

const FILTERS = [
  ["all", "All"],
  ["live", "Live"],
  ["upcoming", "Upcoming"],
  ["completed", "Completed"],
];

/** Previous / select / next. Buttons are 44 px; the select is the accessible "Gameweek" control. */
function GameweekPicker({ gameweeks, value, onChange }) {
  const i = gameweeks.findIndex((g) => g.id === value);
  const step = (d) => onChange(gameweeks[i + d].id);
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={btn} onClick={() => step(-1)} disabled={i <= 0} aria-label="Previous gameweek">
        <ChevronLeft aria-hidden="true" className="size-5" />
      </button>
      <label className="sr-only" htmlFor="gameweek-select">
        Gameweek
      </label>
      <select
        id="gameweek-select"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-11 rounded-md border border-line bg-white px-2 font-semibold"
      >
        {gameweeks.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
            {g.current ? " (current)" : g.next ? " (next)" : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={btn}
        onClick={() => step(1)}
        disabled={i < 0 || i >= gameweeks.length - 1}
        aria-label="Next gameweek"
      >
        <ChevronRight aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}

function FilterButtons({ value, onChange, counts }) {
  return (
    <div role="group" aria-label="Show matches" className="flex flex-wrap gap-1">
      {FILTERS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`min-h-11 rounded-md border px-3 text-sm font-semibold ${
            value === key ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink"
          }`}
        >
          {label} <span className="num">{counts[key]}</span>
        </button>
      ))}
    </div>
  );
}

/** The selected gameweek's matches: FPL's fixture list, with ESPN's live scores for the days it covers. */
function GameweekMatches({ league, gameweek }) {
  const [filter, setFilter] = useState("all");
  const days = useMemo(() => scoreboardDates(league.fixtures, gameweek), [league.fixtures, gameweek]);
  const scores = useSource(days.length ? `scoreboards:${days.join(",")}` : null);
  const espn = useMemo(() => (scores.data ? [...scores.data.results, ...scores.data.fixtures] : []), [scores.data]);
  const { dated, undated } = useMemo(
    () => gameweekMatches(league.fixtures, gameweek, espn),
    [league.fixtures, gameweek, espn],
  );
  const now = Date.now();
  const counts = filterCounts(dated, now);
  const shown = filterMatches(dated, filter, now);
  const name = league.gameweeks.find((g) => g.id === gameweek)?.name ?? `Gameweek ${gameweek}`;
  const fromFpl = dated.filter((m) => m.source === "fpl").length;

  return (
    <div className="space-y-3">
      <FilterButtons value={filter} onChange={setFilter} counts={counts} />
      {scores.status === "loading" && (
        <p role="status" className="text-sm text-muted">
          Loading live scores…
        </p>
      )}
      {shown.length ? (
        <MatchesByDay matches={shown} now={now} />
      ) : (
        <p className="rounded-md bg-field px-3 py-6 text-muted">
          {dated.length
            ? `No ${filter} matches in ${name}${filter === "live" ? " right now" : ""}.`
            : `No dated fixtures in ${name}.`}
        </p>
      )}
      {undated.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted">Awaiting a new date</h3>
          <ul>
            {undated.map((m) => (
              <MatchRow key={m.fplId} m={m} now={now} />
            ))}
          </ul>
        </div>
      )}
      <div>
        <FreshnessLine label={FPL_LIST} at={league.gameweeksAt} />
        <FreshnessLine
          label={
            scores.status === "error"
              ? `Live scores: ESPN unavailable (${scores.error}); results shown from Fantasy Premier League`
              : "Scores: ESPN"
          }
          live={scores.status !== "error" && days.length > 0 && counts.completed < counts.all}
          at={scores.status === "error" ? null : scores.asOf}
        />
        {fromFpl > 0 && scores.status !== "error" && (
          <p className="mt-1 text-sm text-muted">
            {fromFpl} {fromFpl === 1 ? "match isn’t" : "matches aren’t"} on ESPN’s scoreboard; shown from Fantasy
            Premier League’s fixture list, without a match centre.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Fixtures and results by gameweek. The gameweek numbers are FPL's (ESPN has none); a postponed match sits
 * in the round FPL has moved it to, or under "Awaiting a new date".
 */
export function GameweekSection({ league }) {
  const [picked, setPicked] = useState(null);
  const gameweek = picked ?? defaultGameweek(league.data?.gameweeks ?? null);
  return (
    <Section
      id="fixtures-heading"
      title="Fixtures and results"
      state={league}
      empty="No gameweeks published yet."
      sourceLine={false}
    >
      {(data) =>
        data.gameweeks?.length && gameweek != null ? (
          <div className="space-y-3">
            <GameweekPicker gameweeks={data.gameweeks} value={gameweek} onChange={setPicked} />
            <GameweekMatches key={gameweek} league={data} gameweek={gameweek} />
          </div>
        ) : (
          <p className="rounded-md bg-field px-3 py-6 text-muted">Gameweeks are unavailable right now.</p>
        )
      }
    </Section>
  );
}

/** Ties share a rank: 1, 2, 2, 4. */
const ranks = (list) => list.map((x) => 1 + list.filter((y) => y.value > x.value).length);

function LeaderTable({ title, unit, list }) {
  const r = ranks(list);
  return (
    <div className="min-w-0">
      <h3 className="mb-1 font-display text-lg font-semibold">{title}</h3>
      {list.length ? (
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b-2 border-ink text-sm text-muted">
              <th scope="col" className="w-8 py-1 pr-1 text-right font-semibold">
                <abbr title="Rank">#</abbr>
              </th>
              <th scope="col" className="py-1 pl-2 font-semibold">
                Player
              </th>
              <th scope="col" className="num px-1 py-1 text-right font-semibold">
                {unit}
              </th>
              <th scope="col" className="num py-1 pl-1 text-right font-semibold">
                <abbr title="League matches played (as ESPN reports it; – when not given)">Apps</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((p, i) => {
              const club = p.club ? clubBySlug(p.club) : null;
              return (
                <tr key={p.id} className="border-b border-line">
                  <td className="num py-1.5 pr-1 text-right">{i > 0 && r[i] === r[i - 1] ? "=" : r[i]}</td>
                  <td className="py-1.5 pl-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {club && <Crest espnId={club.espnId} size={18} />}
                      <span className="min-w-0 truncate">{p.name}</span>
                      {club && (
                        <a
                          href={toHash({ name: "club", slug: club.slug })}
                          className="inline-flex min-h-11 items-center text-sm text-muted underline-offset-2 hover:underline sm:min-h-0"
                        >
                          {club.abbr}
                        </a>
                      )}
                    </span>
                  </td>
                  <td className="num px-1 py-1.5 text-right text-lg font-bold">{p.value}</td>
                  <td className="num py-1.5 pr-1 pl-1 text-right text-muted">{p.matches ?? "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="rounded-md bg-field px-3 py-4 text-muted">None listed yet.</p>
      )}
    </div>
  );
}

/** Goals and assists leaders (ESPN, top ten each, collected by the pipeline). */
export function LeadersSection({ league }) {
  return (
    <Section id="leaders-heading" title="Top scorers and assists" state={league} sourceLine={false}>
      {(data) =>
        data.leaders ? (
          <>
            <div className="grid gap-6 sm:grid-cols-2">
              <LeaderTable title="Goals" unit="G" list={data.leaders.goals} />
              <LeaderTable title="Assists" unit="A" list={data.leaders.assists} />
            </div>
            <FreshnessLine
              label={`Leaders: ESPN${data.season ? `, ${data.season}` : ""}, via this site's pipeline (top ten and ties)`}
              at={data.leadersAt}
            />
          </>
        ) : (
          <p className="rounded-md bg-field px-3 py-6 text-muted">Scoring leaders are unavailable right now.</p>
        )
      }
    </Section>
  );
}

/** Upcoming top-six and bottom-four meetings, by the current table. */
export function KeyFixturesSection({ league, standings }) {
  const rows = standings.data?.rows ?? null;
  return (
    <Section id="key-fixtures-heading" title="Key fixtures" state={league} sourceLine={false}>
      {(data) => {
        if (!data.fixtures) return <p className="rounded-md bg-field px-3 py-6 text-muted">Fixtures unavailable.</p>;
        if (!rows) return <p className="text-muted">Waiting for the table…</p>;
        const list = keyFixtures(data.fixtures, rows);
        return (
          <>
            <p className="mb-2 text-sm text-muted">
              The next two weeks’ meetings between two top-six clubs or two bottom-four clubs, by the current table.
            </p>
            {list.length ? (
              <ul>
                {list.map(({ fixture, reason }) => (
                  <li key={fixture.id} className="border-b border-line py-1 last:border-0">
                    <p className="text-sm font-semibold text-accent">
                      {reason} · {fmtLongDay(fixture.kickoff)}
                    </p>
                    <ul>
                      <MatchRow m={fixtureAsMatch(fixture)} />
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md bg-field px-3 py-6 text-muted">
                No top-six or bottom-four meetings in the next two weeks.
              </p>
            )}
            <p className="mt-1 text-sm text-muted">Times in your timezone ({tzShort()}).</p>
            <FreshnessLine label={FPL_LIST} at={data.gameweeksAt} />
          </>
        );
      }}
    </Section>
  );
}
