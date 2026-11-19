import { clubByEspnId } from "../config/clubs.js";
import { fmtDay, fmtKick, fmtLongDay, fmtTime, relDay, timeAgo, tzShort } from "../lib/format.js";
import { toHash } from "../lib/route.js";
import { TIERS } from "../lib/sources.js";
import { matchPhase } from "../lib/hero.js";
import { CATEGORY_SHORT } from "../lib/news.js";
import { Countdown, Crest, ResultChip, TeamLink } from "./ui.jsx";

const matchHref = (m) => toHash({ name: "match", eventId: m.id });

/** The score or kick-off time in the middle of a fixture row. */
function Middle({ m, now }) {
  const phase = matchPhase(m, now);
  if (phase === "postponed") return <span className="text-sm font-semibold text-warn">Postponed</span>;
  if (m.home.score != null && m.away.score != null && (phase === "live" || phase === "completed")) {
    return (
      <span className="num text-xl font-bold">
        {m.home.score}–{m.away.score}
      </span>
    );
  }
  if (phase === "unconfirmed") return <span className="text-sm text-muted">Result not confirmed</span>;
  return (
    <time dateTime={m.date.toISOString()} className="num text-lg font-semibold">
      {fmtTime(m.date)}
    </time>
  );
}

/** One fixture or result, linked to its match centre. */
export function MatchRow({ m, now = Date.now(), showDate = false }) {
  const phase = matchPhase(m, now);
  return (
    <li className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-line py-2 last:border-0">
      <span className="flex min-w-0 items-center justify-end gap-2 text-right">
        <TeamLink side={m.home} className="truncate font-semibold" />
        <Crest src={m.home.logo} />
      </span>
      <a
        href={matchHref(m)}
        className="flex min-h-11 min-w-20 flex-col items-center justify-center rounded-md px-2 hover:bg-field"
      >
        <span className="sr-only">
          {m.home.name} v {m.away.name}, {fmtKick(m.date)}, match centre:{" "}
        </span>
        <Middle m={m} now={now} />
        <span className="text-xs text-muted">
          {phase === "live" ? (
            <span className="font-semibold text-loss">Live {m.clock}</span>
          ) : phase === "completed" ? (
            showDate ? (
              `FT, ${fmtDay(m.date)}`
            ) : (
              "Full time"
            )
          ) : showDate ? (
            fmtDay(m.date)
          ) : m.compShort === "Match" ? (
            ""
          ) : (
            m.compShort
          )}
        </span>
      </a>
      <span className="flex min-w-0 items-center gap-2">
        <Crest src={m.away.logo} />
        <TeamLink side={m.away} className="truncate font-semibold" />
      </span>
    </li>
  );
}

/** Matches grouped by day, in the viewer's timezone. */
export function MatchesByDay({ matches, now = Date.now() }) {
  const days = new Map();
  for (const m of matches) {
    const k = m.date.toDateString();
    days.set(k, [...(days.get(k) ?? []), m]);
  }
  return (
    <div className="space-y-4">
      {[...days.values()].map((list) => (
        <div key={list[0].id}>
          <h3 className="text-sm font-semibold text-muted">{fmtLongDay(list[0].date)}</h3>
          <ul>
            {list.map((m) => (
              <MatchRow key={m.id} m={m} now={now} />
            ))}
          </ul>
        </div>
      ))}
      <p className="text-sm text-muted">Times in your timezone ({tzShort()}).</p>
    </div>
  );
}

/** Zone notes ESPN attaches to table rows ("Champions League", "Relegation"). */
function zoneLegend(rows) {
  const seen = new Map();
  for (const r of rows) if (r.note?.label && !seen.has(r.note.label)) seen.set(r.note.label, r.note.color);
  return [...seen.entries()];
}

/** The league table. `highlight` is an ESPN id (the viewer's club or the page's club). */
export function LeagueTable({ rows, highlight = null, compact = false }) {
  const legend = zoneLegend(rows);
  return (
    <div>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Premier League table</caption>
          <thead>
            <tr className="border-b-2 border-ink text-sm text-muted">
              <th scope="col" className="w-8 py-2 pr-1 text-right font-semibold">
                <abbr title="Position">Pos</abbr>
              </th>
              <th scope="col" className="py-2 pl-3 font-semibold">
                Club
              </th>
              <th scope="col" className="num px-1 py-2 text-right font-semibold">
                <abbr title="Played">P</abbr>
              </th>
              {!compact && (
                <>
                  <th scope="col" className="num hidden px-1 py-2 text-right font-semibold sm:table-cell">
                    <abbr title="Won">W</abbr>
                  </th>
                  <th scope="col" className="num hidden px-1 py-2 text-right font-semibold sm:table-cell">
                    <abbr title="Drawn">D</abbr>
                  </th>
                  <th scope="col" className="num hidden px-1 py-2 text-right font-semibold sm:table-cell">
                    <abbr title="Lost">L</abbr>
                  </th>
                </>
              )}
              <th scope="col" className="num px-1 py-2 text-right font-semibold">
                <abbr title="Goal difference">GD</abbr>
              </th>
              <th scope="col" className="num py-2 pl-1 text-right font-semibold">
                <abbr title="Points">Pts</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const club = clubByEspnId(r.id);
              const mine = r.id === highlight;
              return (
                <tr
                  key={r.id}
                  className={`border-b border-line ${mine ? "bg-accent-soft font-semibold" : ""}`}
                  aria-current={mine ? "true" : undefined}
                >
                  <td className="num relative py-1.5 pr-1 text-right text-lg">
                    {r.note?.color && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1 left-0 w-1 rounded-sm"
                        style={{ background: r.note.color }}
                      />
                    )}
                    {r.rank ?? "–"}
                    {r.note?.label && <span className="sr-only">, {r.note.label}</span>}
                  </td>
                  <td className="py-1.5 pl-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <Crest src={r.logo} espnId={r.id} size={22} />
                      {club ? (
                        <a
                          href={toHash({ name: "club", slug: club.slug })}
                          className="inline-flex min-h-11 items-center underline-offset-2 hover:underline sm:min-h-0"
                        >
                          <span className="sm:hidden">{club.abbr}</span>
                          <span className="hidden sm:inline">{club.shortName}</span>
                        </a>
                      ) : (
                        <span>{r.short ?? r.name}</span>
                      )}
                    </span>
                  </td>
                  <td className="num px-1 py-1.5 text-right text-lg">{r.gp ?? "–"}</td>
                  {!compact && (
                    <>
                      <td className="num hidden px-1 py-1.5 text-right text-lg sm:table-cell">{r.w ?? "–"}</td>
                      <td className="num hidden px-1 py-1.5 text-right text-lg sm:table-cell">{r.d ?? "–"}</td>
                      <td className="num hidden px-1 py-1.5 text-right text-lg sm:table-cell">{r.l ?? "–"}</td>
                    </>
                  )}
                  <td className="num px-1 py-1.5 text-right text-lg">
                    {r.gd == null ? "–" : r.gd > 0 ? `+${r.gd}` : r.gd}
                  </td>
                  <td className="num py-1.5 pl-1 text-right text-lg font-bold">{r.pts ?? "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {legend.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {legend.map(([label, color]) => (
            <li key={label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-3 w-1 rounded-sm" style={{ background: color }} />
              {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Last results as W/D/L chips, oldest to newest. */
export function FormStrip({ form }) {
  if (!form.length) return <p className="text-muted">No league results yet this season.</p>;
  return (
    <ol className="flex gap-1" aria-label="League form, oldest to newest">
      {form.map(({ result, match }) => (
        <li key={match.id}>
          <a href={matchHref(match)} className="inline-flex min-h-11 items-center">
            <ResultChip
              result={result}
              title={`${match.home.short} ${match.home.score}–${match.away.score} ${match.away.short}, ${fmtDay(match.date)}`}
            />
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * The scoreboard strip: the page's one loud element. A kit stripe in the club's own colours, then the
 * fixture in big condensed type, with a countdown before kick-off.
 */
export function MatchStrip({ m, label, now = Date.now() }) {
  const phase = matchPhase(m, now);
  const scored = m.home.score != null && m.away.score != null && (phase === "live" || phase === "completed");
  return (
    <article className="relative overflow-hidden rounded-lg border border-line bg-white">
      <div aria-hidden="true" className="kit-stripe absolute inset-y-0 left-0 w-2" />
      <div className="py-4 pr-4 pl-6">
        <p className="text-sm font-semibold text-accent">
          {label} · {m.competition}
        </p>
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex min-w-0 flex-col items-center gap-1 text-center">
            <Crest src={m.home.logo} size={48} />
            <TeamLink side={m.home} className="font-display text-xl leading-tight font-semibold" />
          </div>
          <a href={matchHref(m)} className="flex min-h-11 flex-col items-center rounded-md px-2 hover:bg-field">
            {scored ? (
              <span className="num text-5xl leading-none font-bold">
                {m.home.score}
                <span className="px-1 text-muted">–</span>
                {m.away.score}
              </span>
            ) : (
              <time dateTime={m.date.toISOString()} className="num text-4xl leading-none font-bold">
                {fmtTime(m.date)}
              </time>
            )}
            <span className="mt-1 text-sm text-muted">
              {phase === "live" ? (
                <span className="font-semibold text-loss">Live {m.clock}</span>
              ) : phase === "completed" ? (
                "Full time"
              ) : (
                relDay(m.date, new Date(now))
              )}
            </span>
            <span className="sr-only">Open the match centre</span>
          </a>
          <div className="flex min-w-0 flex-col items-center gap-1 text-center">
            <Crest src={m.away.logo} size={48} />
            <TeamLink side={m.away} className="font-display text-xl leading-tight font-semibold" />
          </div>
        </div>
        {phase === "upcoming" && (
          <p className="mt-3 text-center">
            <Countdown to={m.date} />
          </p>
        )}
        {m.venue && <p className="mt-2 text-center text-sm text-muted">{m.venue}</p>}
      </div>
    </article>
  );
}

/** News stories with outlet, credibility tier and age. Links go to the original outlet. */
export function StoryList({ stories, now = Date.now() }) {
  return (
    <ul className="divide-y divide-line">
      {stories.map((s) => {
        const tier = TIERS[s.tier];
        const others = s.outlets.filter((o) => o !== s.lead.source);
        return (
          <li key={s.id} className="py-3">
            <a
              href={s.lead.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg leading-snug font-semibold underline-offset-2 hover:underline"
            >
              {s.lead.title}
              <span className="sr-only"> (opens {s.lead.source} in a new tab)</span>
            </a>
            {s.summary && <p className="mt-1 line-clamp-2 text-muted">{s.summary}</p>}
            <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
              <span className="font-semibold text-ink">{s.lead.source}</span>
              {tier && <span title={tier.label}>{tier.short} outlet</span>}
              {CATEGORY_SHORT[s.primary] && <span>{CATEGORY_SHORT[s.primary]}</span>}
              {s.date && <time dateTime={s.date.toISOString()}>{timeAgo(s.date, now)}</time>}
              {others.length > 0 && <span>Also: {others.join(", ")}</span>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_STYLE = {
  confirmed: { label: "Confirmed", className: "bg-ink text-white" },
  reported: { label: "Reported", className: "border border-line text-ink" },
};

/** Transfer feed rows (lib/transfers.js): status, headline, outlet and tier, time. */
export function TransferList({ items, now = Date.now() }) {
  return (
    <ul className="divide-y divide-line">
      {items.map(({ story: s, status, kind }) => {
        const tier = TIERS[s.tier];
        const st = STATUS_STYLE[status];
        return (
          <li key={s.id} className="flex items-start gap-3 py-3">
            <span
              className={`mt-0.5 w-20 shrink-0 rounded-sm px-1.5 py-0.5 text-center text-xs font-semibold tracking-wide uppercase ${st.className}`}
            >
              {st.label}
            </span>
            <span className="min-w-0 flex-1">
              <a
                href={s.lead.link}
                target="_blank"
                rel="noopener noreferrer"
                className="leading-snug font-semibold underline-offset-2 hover:underline"
              >
                {s.lead.title}
                <span className="sr-only"> (opens {s.lead.source} in a new tab)</span>
              </a>
              <span className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
                <span>{kind}</span>
                <span className="font-semibold text-ink">{s.lead.source}</span>
                {tier && <span title={tier.label}>{tier.short} outlet</span>}
                {s.date && <time dateTime={s.date.toISOString()}>{timeAgo(s.date, now)}</time>}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Crest grid of every club: the "pick your club" entry point. */
export function ClubGrid({ clubs }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      {clubs.map((c) => (
        <li key={c.slug}>
          <a
            href={toHash({ name: "club", slug: c.slug })}
            className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-white px-2 py-2 font-semibold hover:border-ink"
          >
            <span aria-hidden="true" className="h-6 w-1 shrink-0 rounded-sm" style={{ background: c.colors.primary }} />
            <Crest espnId={c.espnId} size={28} />
            <span className="truncate">{c.shortName}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
