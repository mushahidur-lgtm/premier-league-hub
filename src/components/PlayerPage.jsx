import { useMemo } from "react";
import { GitCompareArrows } from "lucide-react";
import { clubByEspnId } from "../config/clubs.js";
import { useSource } from "../lib/data.js";
import { fmtBirthDate, fmtDay } from "../lib/format.js";
import { isAbsenceReport, reportFor } from "../lib/injuries.js";
import { playerClub, seasonStats } from "../lib/player.js";
import { toHash } from "../lib/route.js";
import { titleFor } from "../lib/titles.js";
import { ReportNote } from "./blocks.jsx";
import { btn, Crest, FreshnessLine, ResultChip, Section, useStories, useTitle } from "./ui.jsx";

const UNAVAILABLE = "Not listed by ESPN";

/** A value, or a visible "–" that says it is unavailable (never shown as 0). */
export function Stat({ value, title = "Not provided by the source" }) {
  return value == null ? (
    <span title={title}>
      <span aria-hidden="true">–</span>
      <span className="sr-only">not available</span>
    </span>
  ) : (
    <>{value}</>
  );
}

function Photo({ src, name }) {
  if (src)
    return <img src={src} alt={name} width={96} height={96} className="size-24 rounded-md bg-field object-cover" />;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  return (
    <div className="flex size-24 flex-col items-center justify-center rounded-md bg-field text-center">
      <span aria-hidden="true" className="font-display text-3xl font-bold text-muted">
        {initials}
      </span>
      <span className="px-1 text-[11px] leading-tight text-muted">No photo from ESPN</span>
    </div>
  );
}

function Facts({ a, club, player }) {
  const facts = [
    [
      "Club",
      club ? (
        <a
          href={toHash({ name: "club", slug: club.slug })}
          className="inline-flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline"
        >
          <Crest espnId={club.espnId} size={20} /> {club.name}
        </a>
      ) : (
        (a.teamName ?? UNAVAILABLE)
      ),
    ],
    ["Position", a.position ?? player?.position ?? UNAVAILABLE],
    ["Shirt number", a.jersey ?? (player?.jersey || UNAVAILABLE)],
    [
      "Nationality",
      a.nationality ? (
        <span className="inline-flex items-center gap-1.5">
          {a.flag && <img src={a.flag} alt="" width={20} height={20} className="size-5 object-contain" />}
          {a.nationality}
        </span>
      ) : (
        UNAVAILABLE
      ),
    ],
    // The roster's date of birth (a real date); ESPN's display string is day/month and easy to misread.
    ["Age", a.age != null ? `${a.age}${player?.dob ? ` (born ${fmtBirthDate(player.dob)})` : ""}` : UNAVAILABLE],
    ["Height", a.height ?? UNAVAILABLE],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
      {facts.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className={v === UNAVAILABLE ? "text-muted" : ""}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** ESPN's availability for the player, and any recent injury report from the news (rule 3). */
function Availability({ club, player, report }) {
  if (!club) return <p className="text-muted">Not at a Premier League club, so availability isn’t tracked here.</p>;
  if (!player) return <p className="text-muted">Not in ESPN’s current squad list for {club.name}.</p>;
  const a = player.availability;
  const flagged = a && a.key !== "clear" && a.key !== "unknown";
  return (
    <div className="space-y-1">
      {flagged ? (
        <p className="font-semibold text-warn">
          ESPN: {a.label}
          {a.detail ? `: ${a.detail}` : ""}
        </p>
      ) : a?.key === "unknown" ? (
        <p className="text-muted">ESPN’s injury record for this player is unreadable.</p>
      ) : (
        <p>
          ESPN lists no injury or suspension. <span className="text-muted">Its list can lag club news.</span>
        </p>
      )}
      {report && <ReportNote report={report} now={Date.now()} />}
      {report && isAbsenceReport(report) && !flagged && (
        <p className="text-sm text-muted">Recent news reports an injury ESPN doesn’t list yet.</p>
      )}
    </div>
  );
}

function SeasonStats({ player, minutes, league }) {
  const rows = seasonStats(player, minutes);
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((r) => (
          <div key={r.key} className="border-l-2 border-line pl-3">
            <dt className="text-sm text-muted">
              {r.label}
              {r.source === "FPL" && <sup> FPL</sup>}
              {r.source === "derived" && <sup>*</sup>}
            </dt>
            <dd className="num text-2xl font-bold">
              <Stat value={r.value} />
            </dd>
            {r.detail && <dd className="text-sm text-muted">{r.detail}</dd>}
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-muted">
        “–” means the source doesn’t provide that figure for this player; it is not a zero. *Per 90 minutes is ESPN’s
        total divided by FPL’s minutes, shown from 90 minutes played.
      </p>
      <FreshnessLine
        label={
          minutes
            ? "Minutes: Fantasy Premier League, via this site's pipeline"
            : "Minutes: no Fantasy Premier League match for this player, so not shown"
        }
        at={minutes ? league.data?.minutesAt : null}
      />
    </>
  );
}

function GameLog({ games }) {
  const recent = games.slice(0, 10);
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Recent league matches, newest first</caption>
        <thead>
          <tr className="border-b-2 border-ink text-sm text-muted">
            <th scope="col" className="py-2 pr-2 font-semibold">
              Date
            </th>
            <th scope="col" className="py-2 pr-2 font-semibold">
              Opponent
            </th>
            <th scope="col" className="py-2 pr-2 font-semibold">
              Result
            </th>
            <th scope="col" className="num px-1 py-2 text-right font-semibold">
              <abbr title="Goals">G</abbr>
            </th>
            <th scope="col" className="num px-1 py-2 text-right font-semibold">
              <abbr title="Assists">A</abbr>
            </th>
            <th scope="col" className="num px-1 py-2 text-right font-semibold">
              <abbr title="Shots (on target)">Sh</abbr>
            </th>
            <th scope="col" className="num py-2 pl-1 text-right font-semibold">
              <abbr title="Yellow / red cards">Cards</abbr>
            </th>
          </tr>
        </thead>
        <tbody>
          {recent.map((g) => {
            const opp = clubByEspnId(g.opponentId);
            const s = g.stats;
            const cards = [s.yellowCards ? `${s.yellowCards}Y` : "", s.redCards ? `${s.redCards}R` : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <tr key={g.eventId} className="border-b border-line">
                <td className="py-1.5 pr-2 whitespace-nowrap">{g.date ? fmtDay(g.date) : "–"}</td>
                <td className="py-1.5 pr-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-sm text-muted">{g.home == null ? "" : g.home ? "v" : "at"}</span>
                    {opp && <Crest espnId={opp.espnId} size={18} />}
                    <span className="truncate">{opp?.shortName ?? g.opponent ?? "–"}</span>
                  </span>
                </td>
                <td className="py-1.5 pr-2">
                  <a
                    href={toHash({ name: "match", eventId: g.eventId })}
                    className="inline-flex min-h-11 items-center gap-1.5 underline-offset-2 hover:underline sm:min-h-0"
                  >
                    {g.result && <ResultChip result={g.result} />}
                    <span className="num">
                      {g.teamScore != null && g.oppScore != null ? `${g.teamScore}–${g.oppScore}` : "–"}
                    </span>
                    <span className="sr-only">, match centre</span>
                  </a>
                </td>
                <td className="num px-1 py-1.5 text-right">
                  <Stat value={s.totalGoals} />
                </td>
                <td className="num px-1 py-1.5 text-right">
                  <Stat value={s.goalAssists} />
                </td>
                <td className="num px-1 py-1.5 text-right">
                  <Stat value={s.totalShots} />
                  {s.shotsOnTarget != null && <span className="text-muted"> ({s.shotsOnTarget})</span>}
                </td>
                <td className="num py-1.5 pl-1 text-right">{cards || <span className="text-muted">none</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PlayerPage({ playerId }) {
  const athlete = useSource(`athlete:${playerId}`);
  const a = athlete.data;
  const club = a ? playerClub(a.teamId) : null;
  const roster = useSource(club ? `roster:${club.espnId}` : null);
  const player = roster.data?.players?.find((p) => p.id === playerId) ?? null;
  const gamelog = useSource(`gamelog:${playerId}`);
  const league = useSource("league");
  const news = useSource("news");
  const stories = useStories(news.data);
  const squad = roster.data?.players ?? null;
  const report = useMemo(
    () => (player && squad ? reportFor(stories, squad, player.id) : null),
    [stories, player, squad],
  );
  useTitle(titleFor({ name: "player", playerId }, { playerName: a?.name }));
  const minutes = league.data?.minutes?.[playerId] ?? null;

  return (
    <div className="space-y-10">
      {!a && <h1 className="sr-only">Player profile</h1>}
      <Section
        id="player-heading"
        title={a ? "Profile" : "Player"}
        state={athlete}
        empty="ESPN has no profile for this player."
        action={
          <a href={toHash({ name: "compare", a: playerId, b: null })} className={btn}>
            <GitCompareArrows aria-hidden="true" className="size-4" /> Compare
          </a>
        }
      >
        {(data) => (
          <div className="flex flex-col gap-5 sm:flex-row">
            <Photo src={data.photo ?? player?.photo ?? null} name={data.name} />
            <div className="min-w-0 space-y-3">
              <h1 className="font-display text-4xl leading-tight font-bold">{data.name}</h1>
              <Facts a={data} club={club} player={player} />
            </div>
          </div>
        )}
      </Section>

      {a && (
        <Section id="availability-heading" title="Availability" state={club ? roster : athlete}>
          {() => <Availability club={club} player={player} report={report} />}
        </Section>
      )}

      {club && (
        <Section
          id="season-heading"
          title={player?.season ? `Season: ${player.season}` : "Season"}
          state={roster}
          empty="ESPN hasn’t published this squad yet."
        >
          {() =>
            player ? (
              <SeasonStats player={player} minutes={minutes} league={league} />
            ) : (
              <p className="rounded-md bg-field px-3 py-6 text-muted">
                Not in ESPN’s current squad list for {club.name}, so no season totals.
              </p>
            )
          }
        </Section>
      )}

      <Section
        id="recent-heading"
        title="Recent league matches"
        state={gamelog}
        empty="No league appearances this season."
      >
        {(data) =>
          data.games.length ? (
            <GameLog games={data.games} />
          ) : (
            <p className="rounded-md bg-field px-3 py-6 text-muted">No league appearances this season.</p>
          )
        }
      </Section>
    </div>
  );
}
