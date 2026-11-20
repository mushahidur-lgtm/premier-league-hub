import { useState } from "react";
import { clubByEspnId } from "../config/clubs.js";
import { readableOn } from "../lib/accent.js";
import { useLivePoll, useSource } from "../lib/data.js";
import { fmtDate, fmtKick } from "../lib/format.js";
import { bySide, headToHeadRecord, isLive, LIVE_POLL_MS, relatedStories, settledOnPenalties } from "../lib/match.js";
import { KEY_KINDS } from "../lib/parsers.js";
import { layoutLineup, pitchPoints } from "../lib/pitch.js";
import { toHash } from "../lib/route.js";
import { titleFor } from "../lib/titles.js";
import { MatchStrip, StoryList } from "./blocks.jsx";
import { FreshnessLine, Section, useStories, useTitle } from "./ui.jsx";

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

/** Timeline marks: a symbol plus a word for each kind, so the symbol is never the only cue. */
const PLAY = {
  goal: ["●", "Goal", "text-ink"],
  penalty: ["●", "Penalty goal", "text-ink"],
  "own-goal": ["●", "Own goal", "text-ink"],
  "penalty-missed": ["○", "Penalty missed", "text-muted"],
  yellow: ["▮", "Yellow card", "text-[#9a6b00]"],
  red: ["▮", "Red card", "text-loss"],
  sub: ["⇄", "Substitution", "text-muted"],
  var: ["▣", "VAR", "text-ink"],
  period: ["│", "", "text-muted"],
  "shot-on": ["◎", "Shot on target", "text-muted"],
  "shot-off": ["◌", "Shot off target", "text-muted"],
  "shot-blocked": ["◌", "Shot blocked", "text-muted"],
  woodwork: ["◎", "Hit the woodwork", "text-muted"],
  corner: ["◺", "Corner", "text-muted"],
  offside: ["⚑", "Offside", "text-muted"],
  foul: ["✕", "Foul", "text-muted"],
  other: ["·", "", "text-muted"],
  info: ["·", "", "text-muted"],
};

/** Stat values; formatted here because cached copies lose parser-attached functions. */
const fmtStat = (key, v) =>
  v == null ? "–" : key === "possessionPct" ? `${v}%` : key === "passPct" ? `${Math.round(v * 100)}%` : String(v);

const toggle = (on) =>
  `inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold ${
    on ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-field"
  }`;

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
        {lineup.formation && (
          <span className="num ml-2 text-muted">
            {lineup.formation} <span className="font-normal">(as listed by ESPN)</span>
          </span>
        )}
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
    <>
      <p className="mb-4 text-sm text-muted">
        ESPN publishes one formation per team and no changes during a match, so formation changes aren’t shown.
      </p>
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
    </>
  );
}

/** Key events from ESPN's keyEvents: used when a summary has no commentary. */
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
              {match && (
                <span className="text-sm text-muted">
                  {" "}
                  · {e.kind === "own-goal" ? "for " : ""}
                  {home ? match.home.short : match.away.short}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** ESPN's commentary as a timeline: key moments by default, every play on request. */
function Timeline({ timeline, events, match }) {
  const [all, setAll] = useState(false);
  if (!timeline.length) return <Events events={events} match={match} />;
  const shown = all ? timeline : timeline.filter((t) => KEY_KINDS.has(t.kind));
  const side = (id) => (id === match?.home?.id ? match.home.short : id === match?.away?.id ? match.away.short : null);
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Timeline detail" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!all} className={toggle(!all)} onClick={() => setAll(false)}>
          Key events
        </button>
        <button type="button" aria-pressed={all} className={toggle(all)} onClick={() => setAll(true)}>
          Full commentary ({timeline.length})
        </button>
      </div>
      <ol aria-label={all ? "Full commentary" : "Key events"} className="divide-y divide-line">
        {shown.map((t) => {
          const [mark, label, cls] = PLAY[t.kind] ?? PLAY.other;
          const key = KEY_KINDS.has(t.kind) && t.kind !== "period";
          return (
            <li key={t.seq} className={`flex items-baseline gap-3 py-1.5 ${t.kind === "period" ? "bg-field" : ""}`}>
              <span className="num w-12 shrink-0 text-right font-semibold">{t.minute}</span>
              <span aria-hidden="true" className={`w-4 shrink-0 text-center ${cls}`}>
                {mark}
              </span>
              <span className={`min-w-0 ${key ? "" : "text-sm"}`}>
                {label && <span className={key ? "font-semibold" : "sr-only"}>{label}: </span>}
                {t.text}
                {key && side(t.teamId) && <span className="text-sm text-muted"> · {side(t.teamId)}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EventList({ items, empty = "None", render }) {
  if (!items.length) return <dd>{empty}</dd>;
  return (
    <dd>
      <ul>
        {items.map((e, i) => (
          <li key={e.id ?? i}>
            <span className="num inline-block w-12">{e.minute}</span> {render(e)}
          </li>
        ))}
      </ul>
    </dd>
  );
}

/** Goals (with assists), cards and substitutions, one column per side. */
function ByTeam({ events, match }) {
  const sides = bySide(events, [match.home.id, match.away.id]);
  const teams = [match.home, match.away];
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {sides.map((s, i) => (
        <div key={s.teamId}>
          <h3 className="font-display text-xl font-semibold">{teams[i].name ?? teams[i].short}</h3>
          <dl className="mt-1 space-y-2 text-sm">
            <div>
              <dt className="font-semibold text-muted">Goals</dt>
              <EventList
                items={s.goals}
                render={(g) => (
                  <>
                    {g.primary ?? "Unknown"}
                    {g.kind === "penalty" ? " (pen)" : g.kind === "own-goal" ? " (own goal)" : ""}
                    {g.secondary && g.kind !== "own-goal" && (
                      <span className="text-muted"> · assist {g.secondary}</span>
                    )}
                  </>
                )}
              />
            </div>
            <div>
              <dt className="font-semibold text-muted">Cards</dt>
              <EventList
                items={s.cards}
                render={(c) => (
                  <>
                    <span aria-hidden="true" className={c.kind === "red" ? "text-loss" : "text-[#9a6b00]"}>
                      ▮{" "}
                    </span>
                    {c.primary} <span className="text-muted">({c.kind === "red" ? "red" : "yellow"})</span>
                  </>
                )}
              />
            </div>
            <div>
              <dt className="font-semibold text-muted">Substitutions</dt>
              <EventList
                items={s.subs}
                render={(x) => (
                  <>
                    {x.primary}
                    {x.secondary && <span className="text-muted"> on for {x.secondary}</span>}
                  </>
                )}
              />
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

/** Possession, shots and shots on target as split bars; the numbers are in the text and the table below. */
const BAR_KEYS = ["possessionPct", "totalShots", "shotsOnTarget"];
function StatBars({ stats, match }) {
  const rows = BAR_KEYS.map((k) => stats.find((s) => s.key === k)).filter(Boolean);
  if (!rows.length) return null;
  return (
    <ul className="mb-4 space-y-3">
      {rows.map((s) => {
        const total = (s.home ?? 0) + (s.away ?? 0);
        const share = total ? ((s.home ?? 0) / total) * 100 : 50;
        return (
          <li key={s.key}>
            <div className="flex justify-between gap-2 text-sm">
              <span className="num font-semibold" aria-hidden="true">
                {fmtStat(s.key, s.home)}
              </span>
              <span className="text-muted">
                {s.label}
                <span className="sr-only">
                  : {match?.home?.short} {fmtStat(s.key, s.home)}, {match?.away?.short} {fmtStat(s.key, s.away)}
                </span>
              </span>
              <span className="num font-semibold" aria-hidden="true">
                {fmtStat(s.key, s.away)}
              </span>
            </div>
            <div aria-hidden="true" className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full">
              <div className="bg-ink" style={{ width: `${share}%` }} />
              <div className="flex-1 bg-accent" />
            </div>
          </li>
        );
      })}
    </ul>
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

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Earlier meetings (any competition), with the record from this match's home side. */
function HeadToHead({ meetings, match }) {
  if (!meetings.length) return <p className="text-muted">ESPN lists no earlier meetings between these clubs.</p>;
  const rec = headToHeadRecord(meetings, match.home.id);
  return (
    <div className="space-y-3">
      <p>
        Last {plural(rec.played, "meeting")}: {match.home.short} {plural(rec.wins, "win")}, {plural(rec.draws, "draw")},{" "}
        {match.away.short} {plural(rec.losses, "win")}
        {rec.shootouts ? ` (${plural(rec.shootouts, "draw")} settled on penalties)` : ""}.
      </p>
      <ul className="divide-y divide-line">
        {meetings.map((m) => {
          const line = (
            <span className="num">
              {m.home.abbr ?? m.home.name} {m.home.score}–{m.away.score} {m.away.abbr ?? m.away.name}
            </span>
          );
          return (
            <li key={m.id ?? m.date?.toISOString()} className="flex flex-wrap items-baseline gap-x-3 py-1">
              <span className="w-28 shrink-0 text-sm text-muted">
                {m.date ? fmtDate(m.date, { day: "numeric", month: "short", year: "numeric" }) : ""}
              </span>
              {m.id ? (
                <a
                  href={toHash({ name: "match", eventId: m.id })}
                  className="inline-flex min-h-11 items-center font-semibold underline-offset-2 hover:underline"
                >
                  {line}
                </a>
              ) : (
                <span className="font-semibold">{line}</span>
              )}
              {settledOnPenalties(m) && (
                <span className="text-sm text-muted">{m.home.winner ? m.home.abbr : m.away.abbr} won on penalties</span>
              )}
              <span className="text-sm text-muted">{m.competition}</span>
            </li>
          );
        })}
      </ul>
      <FreshnessLine label="Source: ESPN, earlier meetings in any competition (past results, not live)" />
    </div>
  );
}

/** This site's stories about the match (both clubs), or about either club around kick-off. */
function RelatedNews({ stories, match }) {
  const slugs = [clubByEspnId(match.home.id)?.slug ?? null, clubByEspnId(match.away.id)?.slug ?? null];
  const { about, around } = relatedStories(stories, slugs, match.date ?? null);
  if (about.length) return <StoryList stories={about} />;
  if (around.length)
    return (
      <>
        <p className="text-sm text-muted">
          No story names both clubs. News about either club from three days either side of kick-off:
        </p>
        <StoryList stories={around} />
      </>
    );
  return <p className="text-muted">No stories about these clubs around this match. The news feed keeps 14 days.</p>;
}

function LiveBadge() {
  return (
    <span
      title="Live data from ESPN"
      className="inline-flex items-center gap-1.5 rounded-full bg-loss px-2.5 py-1 text-sm font-semibold text-white"
    >
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-white" />
      Live
    </span>
  );
}

export default function MatchPage({ eventId }) {
  const summary = useSource(`summary:${eventId}`);
  const match = summary.data?.match ?? null;
  const status = summary.data?.status;
  const live = isLive(status);
  // Live data: while the match is in play the summary is fetched again every minute (tab visible).
  useLivePoll(summary.reload, live, LIVE_POLL_MS);
  const news = useSource(match ? "news" : null);
  const stories = useStories(news.data);
  const name = match ? `${match.home.short} v ${match.away.short}` : null;
  // The match page owns its title (App skips this route), so a cached summary on a second visit keeps it.
  useTitle(titleFor({ name: "match", eventId }, { matchName: name }));
  const statusNote = !summary.data
    ? null
    : live
      ? "Live: score, timeline, stats and line-ups are fetched from ESPN again every minute while the match is in play."
      : status?.completed
        ? "Final: ESPN’s record of the finished match."
        : "Not started: this page updates every minute once the match is in play.";

  return (
    <div className="space-y-10">
      <h1 className="font-display text-4xl font-bold">{name ?? "Match centre"}</h1>
      <Section
        id="match-heading"
        title="Score"
        state={summary}
        empty="ESPN has no details for this match."
        action={live ? <LiveBadge /> : null}
        note={statusNote && <p className="mt-1 text-sm text-muted">{statusNote}</p>}
      >
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

      <Section id="goals-heading" title="Goals, cards and substitutions" state={summary} sourceLine={false}>
        {(data) =>
          data.match ? (
            <ByTeam events={data.events ?? []} match={data.match} />
          ) : (
            <p className="text-muted">Teams not published yet.</p>
          )
        }
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section id="events-heading" title="Timeline" state={summary} sourceLine={false}>
          {(data) => <Timeline timeline={data.timeline ?? []} events={data.events ?? []} match={data.match} />}
        </Section>
        <Section id="stats-heading" title="Team stats" state={summary} sourceLine={false}>
          {(data) =>
            data.stats.length ? (
              <>
                <StatBars stats={data.stats} match={data.match} />
                <Stats stats={data.stats} match={data.match} />
              </>
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

      {match && (
        <div className="grid gap-10 lg:grid-cols-2">
          <Section id="h2h-heading" title="Head-to-head" state={summary} sourceLine={false}>
            {(data) => <HeadToHead meetings={data.h2h ?? []} match={data.match ?? match} />}
          </Section>
          <Section id="news-heading" title="Related news" state={news} empty="No news published yet.">
            {() => <RelatedNews stories={stories} match={match} />}
          </Section>
        </div>
      )}
    </div>
  );
}
