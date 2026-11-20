import { useMemo } from "react";
import { Star } from "lucide-react";
import { useSource } from "../lib/data.js";
import { AVAILABILITY, isReportedAbsent, summarizeAvailability } from "../lib/availability.js";
import { recentForm } from "../lib/form.js";
import { ordinal } from "../lib/format.js";
import { injuryReports, isAbsenceReport } from "../lib/injuries.js";
import { pickNextMatch } from "../lib/hero.js";
import { forClub, relevance } from "../lib/news.js";
import { gapsLine, tableGaps } from "../lib/standings.js";
import { toHash } from "../lib/route.js";
import { useMyClub } from "../lib/storage.js";
import { FormStrip, LeagueTable, MatchRow, MatchStrip, ReportNote, StoryList } from "./blocks.jsx";
import { btn, btnAccent, Crest, Section, useStories } from "./ui.jsx";

function Standing({ club, standings, schedule }) {
  return (
    <Section id="standing-heading" title="League position" state={standings} empty="The table isn’t published yet.">
      {(data) => {
        const g = tableGaps(data.rows, club.espnId);
        const i = data.rows.findIndex((r) => r.id === club.espnId);
        const nearby =
          i < 0 ? [] : data.rows.slice(Math.max(0, Math.min(i - 2, data.rows.length - 5)), Math.max(5, i + 3));
        return (
          <div className="space-y-4">
            {g.rank != null ? (
              <p>
                <span className="num text-5xl leading-none font-bold">{ordinal(g.rank)}</span>
                <span className="mt-1 block text-muted">{gapsLine(g)}</span>
              </p>
            ) : (
              <p className="text-muted">Not in the current table.</p>
            )}
            <div>
              <h3 className="mb-1 text-sm font-semibold text-muted">Form, last five league games</h3>
              {schedule.data ? (
                <FormStrip form={recentForm(schedule.data)} />
              ) : (
                <p className="text-muted">{schedule.status === "error" ? "Form unavailable." : "Loading form…"}</p>
              )}
            </div>
            {nearby.length > 0 && <LeagueTable rows={nearby} highlight={club.espnId} compact />}
          </div>
        );
      }}
    </Section>
  );
}

function Squad({ club }) {
  const roster = useSource(`roster:${club.espnId}`);
  // News only adds notes: the squad renders whether or not news has loaded.
  const news = useSource("news");
  const stories = useStories(news.data);
  const players = roster.data?.players;
  const now = Date.now();
  const reports = useMemo(() => (players ? injuryReports(stories, players) : new Map()), [stories, players]);
  return (
    <Section id="squad-heading" title="Squad" state={roster} empty="ESPN hasn’t published this squad yet.">
      {(data) => {
        const { counts, absent } = summarizeAvailability(data.players);
        // Players recent news reports as injured or doubtful whom ESPN doesn't list.
        const newsOnly = data.players.filter((p) => isAbsenceReport(reports.get(p.id)) && !isReportedAbsent(p));
        const groups = ["Goalkeepers", "Defenders", "Midfielders", "Forwards", "Other"]
          .map((g) => [g, data.players.filter((p) => p.group === g)])
          .filter(([, list]) => list.length);
        return (
          <>
            <p className="mb-3">
              {absent.length ? (
                <>
                  ESPN lists{" "}
                  {[
                    counts.injured && `${counts.injured} injured`,
                    counts.doubtful && `${counts.doubtful} doubtful`,
                    counts.suspended && `${counts.suspended} suspended`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  .
                </>
              ) : (
                "ESPN lists no injuries or suspensions."
              )}{" "}
              {newsOnly.length > 0 && (
                <>
                  Recent news reports {newsOnly.length === 1 ? "a player" : `${newsOnly.length} players`} ESPN doesn’t
                  list as injured or doubtful: {newsOnly.map((p) => p.name).join(", ")}.{" "}
                </>
              )}
              <span className="text-muted">Its list can lag club news.</span>
            </p>
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {groups.map(([g, list]) => (
                <div key={g}>
                  <h3 className="mb-1 font-display text-lg font-semibold">{g}</h3>
                  <ul className="divide-y divide-line">
                    {list.map((p) => {
                      const a = p.availability;
                      const flagged = a && a.key !== "clear" && a.key !== "unknown";
                      const report = reports.get(p.id);
                      return (
                        <li key={p.id} className="flex items-baseline gap-3 py-1.5">
                          <span className="num w-7 shrink-0 text-right text-lg text-muted">{p.jersey}</span>
                          <span className="min-w-0 flex-1">
                            <a
                              href={toHash({ name: "player", playerId: p.id })}
                              className="font-semibold underline-offset-2 hover:underline"
                            >
                              {p.name}
                            </a>
                            {p.position && <span className="text-sm text-muted"> · {p.position}</span>}
                            {report && <ReportNote report={report} now={now} />}
                          </span>
                          {flagged && (
                            <span className="shrink-0 text-sm font-semibold text-warn" title={a.source}>
                              {a.label}
                              {a.detail ? `: ${a.detail}` : ""}
                            </span>
                          )}
                          {a?.key === "unknown" && (
                            <span className="shrink-0 text-sm text-muted" title={a.source}>
                              {AVAILABILITY.unknown.label}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </>
        );
      }}
    </Section>
  );
}

function ClubNews({ club }) {
  const news = useSource("news");
  const stories = useStories(news.data);
  const mine = useMemo(() => {
    const now = Date.now();
    return forClub(stories, club.slug)
      .sort((a, b) => relevance(b, now, club.slug) - relevance(a, now, club.slug))
      .slice(0, 10);
  }, [stories, club.slug]);
  return (
    <Section id="club-news-heading" title="News" state={news}>
      {() =>
        mine.length ? (
          <StoryList stories={mine} />
        ) : (
          <p className="rounded-md bg-field px-3 py-6 text-muted">
            No stories about {club.shortName} in the last two weeks.
          </p>
        )
      }
    </Section>
  );
}

export default function ClubPage({ club }) {
  const schedule = useSource(`schedule:${club.espnId}`);
  const standings = useSource("standings");
  const { slug, setSlug } = useMyClub();
  const isMine = slug === club.slug;

  return (
    <div className="space-y-10">
      <header className="relative overflow-hidden rounded-lg border border-line bg-surface">
        <div aria-hidden="true" className="kit-stripe h-2" />
        <div className="flex flex-wrap items-center gap-4 p-4">
          <Crest espnId={club.espnId} size={64} />
          <h1 className="mr-auto font-display text-4xl leading-none font-bold sm:text-5xl">{club.name}</h1>
          <button
            type="button"
            aria-pressed={isMine}
            onClick={() => setSlug(isMine ? null : club.slug)}
            className={isMine ? btnAccent : btn}
          >
            <Star aria-hidden="true" className="size-4" fill={isMine ? "currentColor" : "none"} />
            {isMine ? "My club" : "Make this my club"}
          </button>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Section id="next-heading" title="Matches" state={schedule} empty="No fixtures or results published yet.">
          {(data) => {
            const { next, last, stale } = pickNextMatch(data);
            return (
              <div className="space-y-3">
                {next && <MatchStrip m={next} label={next.state === "in" ? "Live now" : "Next match"} />}
                {last && <MatchStrip m={last} label="Last result" />}
                {stale.length > 0 && (
                  <p className="text-sm text-warn">
                    ESPN hasn’t confirmed the result of {stale.length === 1 ? "one match" : `${stale.length} matches`}{" "}
                    that should have finished.
                  </p>
                )}
              </div>
            );
          }}
        </Section>
        <Standing club={club} standings={standings} schedule={schedule} />
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <ClubNews club={club} />
        <Section id="fixtures-heading" title="Fixtures and results" state={schedule} empty="No matches published yet.">
          {(data) => (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Coming up</h3>
                {data.fixtures.length ? (
                  <ul>
                    {data.fixtures.slice(0, 8).map((m) => (
                      <MatchRow key={m.id} m={m} showDate />
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">No fixtures published yet.</p>
                )}
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold">Results</h3>
                {data.results.length ? (
                  <ul>
                    {data.results.slice(0, 8).map((m) => (
                      <MatchRow key={m.id} m={m} showDate />
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">No results yet this season.</p>
                )}
              </div>
            </div>
          )}
        </Section>
      </div>

      <Squad club={club} />
    </div>
  );
}
