import { useId, useMemo, useState } from "react";
import { CLUBS, clubBySlug } from "../config/clubs.js";
import { useSource } from "../lib/data.js";
import { compareRows, seasonStats } from "../lib/player.js";
import { toHash } from "../lib/route.js";
import { search } from "../lib/search.js";
import { titleFor } from "../lib/titles.js";
import { Stat } from "./PlayerPage.jsx";
import { btn, Crest, FreshnessLine, useTitle } from "./ui.jsx";
import { useAllPlayers } from "./useAllPlayers.js";

/** Go to the comparison with these two players (replaces the entry, so Back leaves the tool). */
const go = (a, b) => window.location.replace(toHash({ name: "compare", a, b }));

/** Search box over every squad; picking a player selects them for this side. */
function Picker({ label, players, onPick }) {
  const id = useId();
  const [q, setQ] = useState("");
  const hits = useMemo(() => (q ? search(q, { clubs: CLUBS, players }, { limit: 8 }).players : []), [q, players]);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Type a player's name"
        autoComplete="off"
        className="min-h-11 w-full rounded-md border border-line bg-white px-3"
      />
      {hits.length > 0 && (
        <ul className="mt-1 divide-y divide-line rounded-md border border-line bg-white">
          {hits.map(({ player, clubSlug }) => {
            const club = clubBySlug(clubSlug);
            return (
              <li key={`${clubSlug}-${player.id}`}>
                <button
                  type="button"
                  onClick={() => onPick(player.id)}
                  className="flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-field"
                >
                  <Crest espnId={club?.espnId} size={20} />
                  <span className="font-semibold">{player.name}</span>
                  <span className="text-sm text-muted">
                    {club?.shortName} · {player.position || "Squad"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {q.length >= 2 && hits.length === 0 && <p className="mt-1 text-sm text-muted">No player matches “{q}”.</p>}
    </div>
  );
}

function Chosen({ entry, onClear }) {
  const club = clubBySlug(entry.clubSlug);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Crest espnId={club?.espnId} size={36} />
      <div className="min-w-0 flex-1">
        <a
          href={toHash({ name: "player", playerId: entry.player.id })}
          className="font-display text-2xl font-semibold underline-offset-2 hover:underline"
        >
          {entry.player.name}
        </a>
        <p className="text-sm text-muted">
          {club?.shortName} · {entry.player.position || "Squad"}
        </p>
      </div>
      <button type="button" className={btn} onClick={onClear}>
        Change
      </button>
    </div>
  );
}

export default function ComparePage({ a, b }) {
  const { players, loaded, failed } = useAllPlayers();
  const league = useSource("league");
  const find = (id) => (id ? (players.find((x) => x.player.id === id) ?? null) : null);
  const pa = find(a);
  const pb = find(b);
  const allLoaded = loaded + failed >= CLUBS.length;
  useTitle(
    titleFor({ name: "compare", a, b }, { compareNames: pa && pb ? [pa.player.name, pb.player.name] : undefined }),
  );

  const minutes = league.data?.minutes ?? null;
  const rows =
    pa && pb
      ? compareRows(seasonStats(pa.player, minutes?.[pa.player.id]), seasonStats(pb.player, minutes?.[pb.player.id]))
      : [];
  const seasonA = pa?.player.season ?? null;
  const seasonB = pb?.player.season ?? null;
  const sameSeason = seasonA && seasonA === seasonB;

  const side = (entry, id, label, onPick, onClear) =>
    entry ? (
      <Chosen entry={entry} onClear={onClear} />
    ) : id && allLoaded ? (
      <div>
        <p className="mb-2 text-warn">No player with id {id} in the current Premier League squads.</p>
        <Picker label={label} players={players} onPick={onPick} />
      </div>
    ) : (
      <Picker label={label} players={players} onPick={onPick} />
    );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-4xl font-bold">Compare players</h1>
        <p className="mt-1 text-muted">
          Two Premier League players, this season’s league figures side by side. Both come from the same source and
          season: ESPN’s squad statistics (minutes from Fantasy Premier League).
        </p>
      </div>

      {!allLoaded && (
        <p role="status" className="text-sm text-muted">
          Loading squads ({loaded} of {CLUBS.length})…
        </p>
      )}
      {failed > 0 && (
        <p className="text-sm text-warn">
          {failed} {failed === 1 ? "squad" : "squads"} couldn’t load; their players can’t be picked right now.
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {side(
          pa,
          a,
          "First player",
          (id) => go(id, b),
          () => go(null, b),
        )}
        {side(
          pb,
          b,
          "Second player",
          (id) => go(a, id),
          () => go(a, null),
        )}
      </div>

      {pa && pb && (
        <section aria-labelledby="compare-heading">
          <h2 id="compare-heading" className="mb-1 font-display text-2xl font-semibold">
            {sameSeason ? seasonA : "Season figures"}
          </h2>
          {!sameSeason && (
            <p className="mb-2 font-semibold text-warn">
              ESPN labels these two squads’ seasons differently ({seasonA ?? "none"} and {seasonB ?? "none"}), so the
              figures may not cover the same season.
            </p>
          )}
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                {pa.player.name} and {pb.player.name}, season figures; the better figure is in bold
              </caption>
              <thead>
                <tr className="border-b-2 border-ink text-sm text-muted">
                  <th scope="col" className="py-2 pr-2 font-semibold">
                    Statistic
                  </th>
                  <th scope="col" className="py-2 px-2 text-right font-semibold">
                    {pa.player.name}
                  </th>
                  <th scope="col" className="py-2 pl-2 text-right font-semibold">
                    {pb.player.name}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-line">
                    <th scope="row" className="py-1.5 pr-2 font-normal">
                      {r.label}
                      {r.source === "FPL" && <sup className="text-muted"> FPL</sup>}
                      {r.source === "derived" && <sup className="text-muted">*</sup>}
                    </th>
                    {["a", "b"].map((s) => (
                      <td
                        key={s}
                        className={`num py-1.5 text-right text-lg ${s === "a" ? "px-2" : "pl-2"} ${
                          r.better === s ? "font-bold" : "text-muted"
                        }`}
                      >
                        <Stat value={r[s]} />
                        {r.better === s && <span className="sr-only"> (better)</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">
            Bold marks the better figure (lower is better for fouls committed, offsides, cards and goals conceded). “–”
            means the source doesn’t provide that figure; it is not a zero. *Per 90 minutes uses FPL minutes and is
            shown from 90 minutes played. Source: ESPN squad statistics.
          </p>
          <FreshnessLine
            label="Minutes: Fantasy Premier League, via this site's pipeline"
            at={league.data?.minutesAt}
          />
        </section>
      )}
    </div>
  );
}
