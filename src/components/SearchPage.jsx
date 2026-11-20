import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { CLUBS, clubBySlug } from "../config/clubs.js";
import { useSource } from "../lib/data.js";
import { useAllPlayers } from "./useAllPlayers.js";
import { toHash } from "../lib/route.js";
import { search } from "../lib/search.js";
import { StoryList } from "./blocks.jsx";
import { Crest, SourceLine, useStories } from "./ui.jsx";

export default function SearchPage({ query }) {
  const [q, setQ] = useState(query);
  const news = useSource("news");
  const stories = useStories(news.data);
  const { players, loaded, failed } = useAllPlayers();
  // Typing stays responsive: the search over ~700 players and the stories runs on the deferred value.
  const deferred = useDeferredValue(q);
  const results = useMemo(() => search(deferred, { clubs: CLUBS, players, stories }), [deferred, players, stories]);
  const searched = results.words.length > 0;
  const total = results.clubs.length + results.players.length + results.stories.length;

  const update = (value) => {
    setQ(value);
    // Keep the address shareable without adding a history entry per keystroke.
    window.history.replaceState(null, "", toHash({ name: "search", query: value.trim() }));
  };

  return (
    <div className="space-y-8">
      <h1 className="font-display text-4xl font-bold">Search</h1>
      <form role="search" onSubmit={(e) => e.preventDefault()} className="max-w-xl">
        <label htmlFor="q" className="mb-1 block font-semibold">
          Clubs, players and stories
        </label>
        <div className="flex items-center gap-2 rounded-md border border-ink bg-white px-3 focus-within:outline-3 focus-within:outline-accent">
          <Search aria-hidden="true" className="size-5 text-muted" />
          <input
            id="q"
            type="search"
            value={q}
            onChange={(e) => update(e.target.value)}
            autoComplete="off"
            spellCheck="false"
            className="min-h-11 w-full bg-transparent text-lg outline-none"
            placeholder="Surname, club or topic…"
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          {loaded < CLUBS.length
            ? `Loading squads: ${loaded} of ${CLUBS.length} clubs so far.`
            : `Searching all ${CLUBS.length} squads.`}
          {failed > 0 && ` ${failed} couldn’t be loaded.`}
        </p>
      </form>

      <p role="status" className="font-semibold">
        {searched
          ? total
            ? `${total} result${total === 1 ? "" : "s"} for “${deferred.trim()}”`
            : `No results for “${deferred.trim()}”. Try a surname or a club name.`
          : "Type at least two letters."}
      </p>

      {results.clubs.length > 0 && (
        <section aria-labelledby="r-clubs">
          <h2 id="r-clubs" className="mb-2 font-display text-2xl font-semibold">
            Clubs
          </h2>
          <ul className="flex flex-wrap gap-2">
            {results.clubs.map((c) => (
              <li key={c.slug}>
                <a
                  href={toHash({ name: "club", slug: c.slug })}
                  className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-white px-3 font-semibold hover:border-ink"
                >
                  <Crest espnId={c.espnId} size={24} /> {c.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results.players.length > 0 && (
        <section aria-labelledby="r-players">
          <h2 id="r-players" className="mb-2 font-display text-2xl font-semibold">
            Players
          </h2>
          <ul className="divide-y divide-line">
            {results.players.map(({ player, clubSlug }) => {
              const club = clubBySlug(clubSlug);
              return (
                <li key={`${clubSlug}-${player.id}`} className="flex items-center gap-3 py-1.5">
                  <Crest espnId={club?.espnId} size={22} />
                  <span className="min-w-0 flex-1">
                    <a
                      href={toHash({ name: "player", playerId: player.id })}
                      className="font-semibold underline-offset-2 hover:underline"
                    >
                      {player.name}
                    </a>
                    <span className="text-sm text-muted"> · {player.position || "Squad"}</span>
                  </span>
                  <a
                    href={toHash({ name: "club", slug: clubSlug })}
                    className="inline-flex min-h-11 items-center text-accent underline underline-offset-2"
                  >
                    {club?.shortName}
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-sm text-muted">Source: ESPN squads.</p>
        </section>
      )}

      {results.stories.length > 0 && (
        <section aria-labelledby="r-stories">
          <h2 id="r-stories" className="mb-2 font-display text-2xl font-semibold">
            Stories
          </h2>
          <StoryList stories={results.stories} />
          <SourceLine state={news} />
        </section>
      )}
    </div>
  );
}
