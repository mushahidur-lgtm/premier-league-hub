import { clubByEspnId } from "../config/clubs.js";
import { readableOn } from "../lib/accent.js";
import { useSource } from "../lib/data.js";
import { fmtKick } from "../lib/format.js";
import { layoutLineup, pitchPoints } from "../lib/pitch.js";
import { titleFor } from "../lib/titles.js";
import { MatchStrip } from "./blocks.jsx";
import { Section, useTitle } from "./ui.jsx";

const EVENT_LABEL = {
  goal: "Goal",
  penalty: "Penalty goal",
  "own-goal": "Own goal",
  yellow: "Yellow card",
  red: "Red card",
  sub: "Substitution",
};
const EVENT_MARK = { goal: "●", penalty: "●", "own-goal": "●", yellow: "▮", red: "▮", sub: "⇄" };
const EVENT_CLS = { yellow: "text-[#9a6b00]", red: "text-loss", sub: "text-muted" };

/** Stat values; formatted here because cached copies lose parser-attached functions. */
const fmtStat = (key, v) =>
  v == null ? "–" : key === "possessionPct" ? `${v}%` : key === "passPct" ? `${Math.round(v * 100)}%` : String(v);

/** Formation pitch: starters placed by lib/pitch.js, attack at the top. */
function Pitch({ lineup }) {
  // Shirt colour from the club's own colours, darkened until white numbers on it pass AA.
  const shirt = readableOn(clubByEspnId(lineup.teamId)?.colors.primary ?? "#14201B", 4.5, "#FFFFFF");
  const layout = layoutLineup(lineup);
  const pts = pitchPoints(layout);
  return (
    <figure>
      <figcaption className="mb-1 font-semibold">
        {lineup.team}
        {lineup.formation && <span className="num ml-2 text-muted">{lineup.formation}</span>}
        {!layout.exact && <span className="block text-sm text-muted">Positions approximate</span>}
      </figcaption>
      <svg
        viewBox="0 0 100 120"
        className="w-full max-w-sm rounded-md bg-turf"
        role="img"
        aria-label={`${lineup.team} line-up on the pitch`}
      >
        <g fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="0.5">
          <rect x="3" y="3" width="94" height="114" />
          <line x1="3" y1="3" x2="97" y2="3" />
          <rect x="25" y="100" width="50" height="17" />
          <rect x="25" y="3" width="50" height="17" />
          <circle cx="50" cy="3" r="9" />
        </g>
        {pts.map(({ p, x, y }) => (
          <g key={p.id ?? p.name} transform={`translate(${x} ${y * 1.15})`}>
            <circle r="4.2" fill={shirt} stroke="#ffffff" strokeWidth="0.6" />
            <text y="1.4" textAnchor="middle" fontSize="3.6" fontWeight="700" fill="#ffffff" className="num">
              {p.jersey}
            </text>
            <text y="8.4" textAnchor="middle" fontSize="3.4" fill="#ffffff">
              {(p.name ?? "").split(" ").slice(-1)[0]}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

function Lineups({ lineups }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {lineups.map((l) => (
        <div key={l.teamId} className="space-y-3">
          <Pitch lineup={l} />
          <div>
            <h3 className="font-semibold">Starting XI</h3>
            <ul className="text-sm">
              {l.starters.map((p) => (
                <li key={p.id ?? p.name}>
                  <span className="num inline-block w-6 text-right text-muted">{p.jersey}</span> {p.name}
                  {p.subbedOut && <span className="text-muted"> (off)</span>}
                </li>
              ))}
            </ul>
            {l.subs.length > 0 && (
              <>
                <h3 className="mt-2 font-semibold">Substitutes</h3>
                <ul className="text-sm text-muted">
                  {l.subs.map((p) => (
                    <li key={p.id ?? p.name}>
                      <span className="num inline-block w-6 text-right">{p.jersey}</span> {p.name}
                      {p.subbedIn && <span> (on)</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Events({ events, match }) {
  if (!events.length) return <p className="text-muted">No goals, cards or substitutions recorded yet.</p>;
  return (
    <ol className="divide-y divide-line">
      {events.map((e) => {
        const home = e.teamId === match?.home?.id;
        return (
          <li key={e.id ?? `${e.minute}-${e.primary}`} className="flex items-baseline gap-3 py-1.5">
            <span className="num w-12 shrink-0 text-right text-lg font-semibold">{e.minute}</span>
            <span aria-hidden="true" className={`w-4 shrink-0 text-center ${EVENT_CLS[e.kind] ?? "text-ink"}`}>
              {EVENT_MARK[e.kind]}
            </span>
            <span className="min-w-0">
              <span className="font-semibold">{EVENT_LABEL[e.kind]}</span>
              {e.primary && `: ${e.primary}`}
              {e.secondary && e.kind === "sub" && <span className="text-muted"> for {e.secondary}</span>}
              {e.secondary && e.kind !== "sub" && <span className="text-muted"> (assist {e.secondary})</span>}
              {match && <span className="text-sm text-muted"> · {home ? match.home.short : match.away.short}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Stats({ stats, match }) {
  return (
    <table className="w-full text-left">
      <caption className="sr-only">Team statistics</caption>
      <thead>
        <tr className="border-b-2 border-ink text-sm text-muted">
          <th scope="col" className="py-1 text-right font-semibold">
            {match?.home?.short ?? "Home"}
          </th>
          <th scope="col" className="py-1 text-center font-semibold">
            Stat
          </th>
          <th scope="col" className="py-1 font-semibold">
            {match?.away?.short ?? "Away"}
          </th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr key={s.key} className="border-b border-line">
            <td className="num py-1.5 text-right text-lg">{fmtStat(s.key, s.home)}</td>
            <th scope="row" className="py-1.5 text-center font-normal text-muted">
              {s.label}
            </th>
            <td className="num py-1.5 text-lg">{fmtStat(s.key, s.away)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function MatchPage({ eventId }) {
  const summary = useSource(`summary:${eventId}`);
  const match = summary.data?.match ?? null;
  const name = match ? `${match.home.short} v ${match.away.short}` : null;
  // The match page owns its title (App skips this route), so a cached summary on a second visit keeps it.
  useTitle(titleFor({ name: "match", eventId }, { matchName: name }));

  return (
    <div className="space-y-10">
      <h1 className="font-display text-4xl font-bold">{name ?? "Match centre"}</h1>
      <Section id="match-heading" title="Score" state={summary} empty="ESPN has no details for this match.">
        {(data) => (
          <div className="space-y-2">
            {data.match ? (
              <MatchStrip m={data.match} label={match.date ? fmtKick(match.date) : "Match"} />
            ) : (
              <p className="text-muted">Teams not published yet.</p>
            )}
            {(data.venue || data.referee || data.attendance) && (
              <p className="text-sm text-muted">
                {[
                  data.venue,
                  data.referee && `Referee ${data.referee}`,
                  data.attendance && `Attendance ${Number(data.attendance).toLocaleString()}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {data.recap && (
              <p className="pt-2">
                {data.recap.link ? (
                  <a
                    href={data.recap.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline"
                  >
                    {data.recap.headline}
                    <span className="sr-only"> (opens ESPN in a new tab)</span>
                  </a>
                ) : (
                  <span className="font-semibold">{data.recap.headline}</span>
                )}
                <span className="block text-muted">{data.recap.description}</span>
              </p>
            )}
          </div>
        )}
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section id="events-heading" title="Key events" state={summary}>
          {(data) => <Events events={data.events} match={data.match} />}
        </Section>
        <Section id="stats-heading" title="Team stats" state={summary}>
          {(data) =>
            data.stats.length ? (
              <Stats stats={data.stats} match={data.match} />
            ) : (
              <p className="text-muted">Stats appear once the match starts.</p>
            )
          }
        </Section>
      </div>

      <Section id="lineups-heading" title="Line-ups" state={summary}>
        {(data) =>
          data.lineups.length ? (
            <Lineups lineups={data.lineups} />
          ) : (
            <p className="text-muted">Line-ups are usually published about an hour before kick-off.</p>
          )
        }
      </Section>
    </div>
  );
}
