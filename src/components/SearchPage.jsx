import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { CLUBS, clubBySlug } from "../config/clubs.js";
import { loadSource, readCache, useSource } from "../lib/data.js";
import { toHash } from "../lib/route.js";
import { search } from "../lib/search.js";
import { StoryList } from "./blocks.jsx";
import { Crest, SourceLine, useStories } from "./ui.jsx";

/**
 * Every club's squad, for player search. Loaded only on this page: saved copies show at once, then the
 * 20 rosters load in the background (each shared with any club page that wants the same one).
 */
function useAllPlayers() {
  const [rosters, setRosters] = useState(() => {
    const cache = readCache();
    return Object.fromEntries(CLUBS.map((c) => [c.slug, cache[`roster:${c.espnId}`]?.data ?? null]));
  });
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.allSettled(
      CLUBS.map((c) =>
        loadSource(`roster:${c.espnId}`).then((r) => {
          if (live) setRosters((prev) => ({ ...prev, [c.slug]: r.data }));
        }),
      ),
    ).then((all) => live && setFailed(all.filter((r) => r.status === "rejected").length));
    return () => {
      live = false;
    };
  }, []);
  const players = useMemo(
    () =>
      Object.entries(rosters).flatMap(([clubSlug, data]) =>
        (data?.players ?? []).map((player) => ({ player, clubSlug })),
      ),
    [rosters],
  );
  const loaded = Object.values(rosters).filter(Boolean).length;
  return { players, loaded, failed };
}

export default function SearchPage({ query }) {
  const [q, setQ] = useState(query);
  const news = useSource("news");
  const stories = useStories(news.data);
  const { players, loaded, failed } = useAllPlayers();
  const results = useMemo(() => search(q, { clubs: CLUBS, players, stories }), [q, players, stories]);
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
            placeholder="e.g. a player’s surname"
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
            ? `${total} result${total === 1 ? "" : "s"} for “${q.trim()}”`
            : `No results for “${q.trim()}”. Try a surname or a club name.`
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
                    <span className="font-semibold">{player.name}</span>
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
