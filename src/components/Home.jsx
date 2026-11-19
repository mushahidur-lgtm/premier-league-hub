import { useMemo } from "react";
import { CLUBS } from "../config/clubs.js";
import { useSource } from "../lib/data.js";
import { pickNextMatch } from "../lib/hero.js";
import { pickBriefing } from "../lib/news.js";
import { toHash } from "../lib/route.js";
import { ClubGrid, LeagueTable, MatchesByDay, MatchStrip, StoryList } from "./blocks.jsx";
import { Section, useStories } from "./ui.jsx";

/** The viewer's club leads the home page: its live, next or last match. */
function MyClubLead({ club }) {
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
          <div className="grid gap-3 md:grid-cols-2">
            {next && <MatchStrip m={next} label={next.state === "in" ? "Live now" : "Next match"} />}
            {last && <MatchStrip m={last} label="Last result" />}
          </div>
        );
      }}
    </Section>
  );
}

export default function Home({ myClub }) {
  const standings = useSource("standings");
  const scoreboard = useSource("scoreboard");
  const news = useSource("news");
  const stories = useStories(news.data);
  const top = useMemo(() => pickBriefing(stories, Date.now(), 8), [stories]);

  return (
    <div className="space-y-10">
      <h1 className="sr-only">Premier League table, fixtures and news</h1>
      {myClub && <MyClubLead club={myClub} />}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Section id="table-heading" title="Table" state={standings} empty="The table isn’t published yet.">
          {(data) => (
            <>
              {data.season && <p className="mb-2 text-sm text-muted">{data.season}</p>}
              <LeagueTable rows={data.rows} highlight={myClub?.espnId ?? null} />
            </>
          )}
        </Section>

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
      </div>

      <Section id="news-heading" title="Top stories" state={news} empty="No stories in the last week.">
        {() =>
          top.length ? (
            <StoryList stories={top} />
          ) : (
            <p className="rounded-md bg-field px-3 py-6 text-muted">No stories in the last week.</p>
          )
        }
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
