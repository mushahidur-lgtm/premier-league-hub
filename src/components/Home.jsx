import { useMemo } from "react";
import { CLUBS } from "../config/clubs.js";
import { useSource } from "../lib/data.js";
import { ordinal } from "../lib/format.js";
import { pickNextMatch } from "../lib/hero.js";
import { pickBriefing } from "../lib/news.js";
import { toHash } from "../lib/route.js";
import { gapsLine, tableGaps } from "../lib/standings.js";
import { transferFeed } from "../lib/transfers.js";
import { ClubGrid, LeagueTable, MatchesByDay, MatchStrip, StoryList, TransferList } from "./blocks.jsx";
import { FormMini, FreshnessLine, Section, useStories } from "./ui.jsx";
import { GameweekSection, KeyFixturesSection, LeadersSection } from "./league.jsx";

/** Position, gaps and form for the viewer's club, from the table and the league form. */
function MyClubGlance({ club, standings, league }) {
  const rows = standings.data?.rows;
  const g = rows ? tableGaps(rows, club.espnId) : null;
  const row = rows?.find((r) => r.id === club.espnId);
  const form = league.data?.form?.[club.slug];
  if (!g?.rank && !form) return null;
  return (
    <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
      {g?.rank != null && (
        <p>
          <span className="num text-3xl leading-none font-bold">{ordinal(g.rank)}</span>
          {row?.pts != null && <span className="num ml-2 text-lg font-semibold">{row.pts} pts</span>}
          <span className="block text-sm text-muted">{gapsLine(g)}</span>
        </p>
      )}
      {form?.length > 0 && (
        <div>
          <p className="text-sm text-muted">Form, last five league games</p>
          <FormMini entries={form} />
        </div>
      )}
    </div>
  );
}

/** The viewer's club leads the home page: where it stands, its form, and its live, next or last match. */
function MyClubLead({ club, standings, league }) {
  const schedule = useSource(`schedule:${club.espnId}`);
  return (
    <Section
      id="my-club-heading"
      title={club.name}
      state={schedule}
      empty="No fixtures or results published for this club yet."
      action={
        <a
          href={toHash({ name: "club", slug: club.slug })}
          className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-2"
        >
          Club page
        </a>
      }
    >
      {(data) => {
        const { next, last } = pickNextMatch(data);
        return (
          <>
            <MyClubGlance club={club} standings={standings} league={league} />
            <div className="grid gap-3 md:grid-cols-2">
              {next && <MatchStrip m={next} label={next.state === "in" ? "Live now" : "Next match"} />}
              {last && <MatchStrip m={last} label="Last result" />}
            </div>
          </>
        );
      }}
    </Section>
  );
}

export default function Home({ myClub }) {
  const standings = useSource("standings");
  const league = useSource("league");
  // ESPN's default scoreboard stays as the fixtures section whenever FPL's gameweeks are unavailable.
  const gameweeksUp = league.data?.gameweeks?.length > 0 || (league.data == null && league.status !== "error");
  const scoreboard = useSource(gameweeksUp ? null : "scoreboard");
  const news = useSource("news");
  const stories = useStories(news.data);
  const top = useMemo(() => pickBriefing(stories, Date.now(), 8), [stories]);
  const transfers = useMemo(() => transferFeed(stories, { limit: 8 }), [stories]);

  return (
    <div className="space-y-10">
      <h1 className="sr-only">Premier League table, fixtures and news</h1>
      {myClub && <MyClubLead club={myClub} standings={standings} league={league} />}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Section id="table-heading" title="Table" state={standings} empty="The table isn’t published yet.">
          {(data) => (
            <>
              {data.season && <p className="mb-2 text-sm text-muted">{data.season}</p>}
              <LeagueTable rows={data.rows} highlight={myClub?.espnId ?? null} form={league.data?.form ?? null} />
              {league.data?.form && (
                <FreshnessLine
                  label="Form: last five league results from Fantasy Premier League's fixture list, via this site's pipeline"
                  at={league.data.formAt}
                />
              )}
            </>
          )}
        </Section>

        {gameweeksUp ? (
          <GameweekSection league={league} />
        ) : (
          <Section
            id="fixtures-heading"
            title="Fixtures and results"
            state={scoreboard}
            empty="No league matches scheduled around today."
          >
            {(data) => {
              const all = [...data.results, ...data.fixtures].sort((a, b) => a.date - b.date);
              return <MatchesByDay matches={all} />;
            }}
          </Section>
        )}
      </div>

      <LeadersSection league={league} />
      <KeyFixturesSection league={league} standings={standings} />

      <Section id="news-heading" title="Top stories" state={news} empty="No stories in the last week.">
        {() =>
          top.length ? (
            <StoryList stories={top} />
          ) : (
            <p className="rounded-md bg-field px-3 py-6 text-muted">No stories in the last week.</p>
          )
        }
      </Section>

      <Section id="transfers-heading" title="Transfers and contracts" state={news}>
        {() => (
          <>
            <p className="mb-2 text-sm text-muted">
              Confirmed: the outlet reports the move or contract as done. Reported: talks, interest or a deal not yet
              announced.
            </p>
            {transfers.length ? (
              <TransferList items={transfers} />
            ) : (
              <p className="rounded-md bg-field px-3 py-6 text-muted">
                No transfer or contract stories in the last two weeks.
              </p>
            )}
          </>
        )}
      </Section>

      <section aria-labelledby="clubs-heading">
        <h2 id="clubs-heading" className="mb-1 font-display text-2xl font-semibold">
          {myClub ? "All clubs" : "Pick your club"}
        </h2>
        {!myClub && (
          <p className="mb-3 text-muted">
            Open a club, or choose one under “Pick your club” at the top so this page leads with it.
          </p>
        )}
        <ClubGrid clubs={CLUBS} />
      </section>
    </div>
  );
}
