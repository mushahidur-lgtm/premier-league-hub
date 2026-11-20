import { cloneElement, createContext, useContext, useId, useMemo, useState } from "react";
import { ArrowLeftRight, Repeat } from "lucide-react";
import { CLUBS, clubBySlug } from "../config/clubs.js";
import { useSource } from "../lib/data.js";
import { fmtDay, fmtFull, timeAgo } from "../lib/format.js";
import { injuryReports, isAbsenceReport } from "../lib/injuries.js";
import {
  espnSquads,
  findPlayers,
  fixtureRun,
  fmtPrice,
  fromGameweek,
  minutesShare,
  parsePrice,
  POSITION_NAMES,
  POSITIONS,
  replacements,
  rows,
  sortKey,
  sortRows,
  SORTS,
  STATUS_NAMES,
  transferBudget,
} from "../lib/fpl.js";
import { toHash } from "../lib/route.js";
import { titleFor } from "../lib/titles.js";
import { Stat } from "./PlayerPage.jsx";
import { Crest, FreshnessLine, Section, useStories, useTitle } from "./ui.jsx";

/**
 * Rule 3: recent reliable headlines reporting an FPL player injured or a doubt, by ESPN id. FPL's flags can
 * lag club news, so the page shows the report and never calls such a player available.
 * @type {import("react").Context<Map<string, import("../lib/injuries.js").InjuryReport>>}
 */
const Reports = createContext(new Map());
/** ESPN ids with a report that he is injured or a doubt. */
const useReported = () => {
  const reports = useContext(Reports);
  return useMemo(() => new Set([...reports].filter(([, r]) => isAbsenceReport(r)).map(([id]) => id)), [reports]);
};

const VIEWS = [
  ["players", "Players"],
  ["assistant", "Transfer assistant"],
  ["compare", "Compare"],
];
const control = "min-h-11 rounded-md border border-line bg-surface px-2";
const PRICE_CAPS = [45, 50, 55, 60, 65, 70, 80, 90, 100, 120];
const GAMEWEEK_CHOICES = [1, 3, 5];
const LIST_LIMIT = 50;
/** "Regular starters": at least this share of the club's league minutes this season. */
const REGULAR_SHARE = 0.6;

/** A labelled control: the label names the control by id, so its accessible name is exactly the label. */
function Field({ label, hint = null, children }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {cloneElement(children, { id, "aria-describedby": hint ? hintId : undefined })}
      {hint && (
        <span id={hintId} className="text-sm text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}

const pct = (v) => (v == null ? null : `${Math.round(v * 100)}%`);
const one = (v) => (v == null ? null : v.toFixed(1));

/** FPL fixture difficulty 1–5 as a chip: the number is always shown, so colour is never the only cue. */
const FDR_STYLE = {
  1: "bg-[#0b3f22] text-white",
  2: "bg-win text-white",
  3: "bg-field text-ink border border-line",
  4: "bg-loss text-white",
  5: "bg-[#6e1510] text-white",
};

function FixtureChip({ f }) {
  const opp = clubBySlug(f.opp);
  const label = `${f.home ? "home to" : "away at"} ${opp?.shortName ?? f.opp}, difficulty ${f.fdr ?? "not rated"}${
    f.kickoff ? `, ${fmtDay(f.kickoff)}` : ""
  }`;
  return (
    <span
      title={label}
      className={`num inline-flex items-center gap-1 rounded-sm px-1 text-xs leading-5 font-semibold whitespace-nowrap ${
        FDR_STYLE[f.fdr] ?? "border border-line bg-surface text-ink"
      }`}
    >
      <span aria-hidden="true">
        {opp?.abbr ?? f.opp} ({f.home ? "H" : "A"}) {f.fdr ?? "–"}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** One chip per fixture in the next gameweeks; a blank gameweek says so, a double shows both. */
function FixtureRun({ run }) {
  return (
    <span className="flex flex-wrap gap-1">
      {run.weeks.map((w) =>
        w.fixtures.length ? (
          w.fixtures.map((f, i) => <FixtureChip key={`${w.gw}-${i}`} f={f} />)
        ) : (
          <span
            key={w.gw}
            title={`No fixture in Gameweek ${w.gw} (FPL)`}
            className="inline-flex rounded-sm border border-dashed border-line px-1 text-xs leading-5 text-muted"
          >
            <span aria-hidden="true">GW{w.gw} blank</span>
            <span className="sr-only">No fixture in Gameweek {w.gw}</span>
          </span>
        ),
      )}
    </span>
  );
}

/** A news report on the player (rule 3): what, where, when, linked to the story. */
function ReportFlag({ report }) {
  return (
    <a
      href={report.link}
      target="_blank"
      rel="noopener noreferrer"
      title={report.title}
      className="inline-flex min-h-11 items-center text-xs font-semibold text-warn underline-offset-2 hover:underline sm:min-h-0"
    >
      {report.label} · {report.source} · {timeAgo(report.date)}
      <span className="sr-only"> (opens {report.source} in a new tab)</span>
    </a>
  );
}

/** Availability, worded as FPL flags it, plus any news report; nothing when neither says anything. */
function Flag({ player }) {
  const report = useContext(Reports).get(player.espn ?? "");
  const note = report && isAbsenceReport(report) ? <ReportFlag report={report} /> : null;
  if (player.status === "a" && (player.chance == null || player.chance >= 100)) return note;
  const word = player.status === "a" ? "Flagged" : STATUS_NAMES[player.status];
  const text = player.chance != null ? `${word}, ${player.chance}% to play` : word;
  const out = player.chance != null ? player.chance < 50 : player.status !== "d";
  const flag = (
    <span
      title={player.news || text}
      className={`inline-flex rounded-sm px-1 text-xs leading-5 font-semibold ${out ? "bg-loss text-white" : "bg-warn text-white"}`}
    >
      {text}
    </span>
  );
  return note ? (
    <>
      {flag}
      {note}
    </>
  ) : (
    flag
  );
}

function PlayerName({ player, link = true }) {
  const club = clubBySlug(player.club);
  const name =
    link && player.espn ? (
      <a
        href={toHash({ name: "player", playerId: player.espn })}
        className="inline-flex min-h-11 items-center underline-offset-2 hover:underline sm:min-h-0"
      >
        {player.name}
      </a>
    ) : (
      <span>{player.name}</span>
    );
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <Crest espnId={club?.espnId} size={18} />
      <span className="font-semibold">{name}</span>
      <span className="text-sm text-muted">
        {club?.abbr} · {player.pos}
      </span>
      <Flag player={player} />
    </span>
  );
}

/** Pick an FPL player by typing part of the name; results are buttons. */
function PlayerPicker({ label, players, onPick, exclude = null }) {
  const [q, setQ] = useState("");
  const found = findPlayers(players, q).filter((p) => p.id !== exclude);
  const id = useId();
  return (
    <div className="flex max-w-md flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        type="search"
        autoComplete="off"
        className={control}
        placeholder="Type at least 2 letters"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q.trim().length >= 2 && (
        <ul
          aria-label={`Players matching ${q.trim()}`}
          className="divide-y divide-line rounded-md border border-line bg-surface"
        >
          {found.length ? (
            found.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(p);
                    setQ("");
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-2 text-left hover:bg-field"
                >
                  <span>
                    {p.fullName}{" "}
                    <span className="text-sm text-muted">
                      {clubBySlug(p.club)?.abbr} · {p.pos}
                    </span>
                  </span>
                  <span className="num text-sm">{fmtPrice(p.price)}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-2 py-3 text-muted">No player with that name.</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** A price field typed in £m, committed to the address once it reads as a price. */
function PriceInput({ label, value, onCommit, hint, placeholder = "0.0" }) {
  const [text, setText] = useState(value == null ? "" : (value / 10).toFixed(1));
  const parsed = text.trim() === "" ? null : parsePrice(text);
  const invalid = text.trim() !== "" && parsed == null;
  return (
    <Field label={label} hint={invalid ? "Enter an amount such as 1.5" : hint}>
      <input
        type="text"
        inputMode="decimal"
        className={`${control} w-32`}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim() === "" ? null : parsePrice(e.target.value);
          if (e.target.value.trim() === "" || v != null) onCommit(v);
        }}
      />
    </Field>
  );
}

function GameweeksSelect({ value, onChange }) {
  return (
    <Field label="Fixtures over">
      <select className={control} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {GAMEWEEK_CHOICES.map((n) => (
          <option key={n} value={n}>
            {n === 1 ? "Next gameweek" : `Next ${n} gameweeks`}
          </option>
        ))}
      </select>
    </Field>
  );
}

function SortSelect({ value, onChange }) {
  return (
    <Field label="Sort by">
      <select className={control} value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(SORTS).map(([k, s]) => (
          <option key={k} value={k}>
            {s.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** The table of players shared by the list and the assistant. */
function PlayerTable({ list, caption, n, action }) {
  return (
    <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-ink text-sm text-muted">
            <th scope="col" className="py-1 pr-2 font-semibold">
              Player
            </th>
            <th scope="col" className="num px-1 py-1 text-right font-semibold">
              Price
            </th>
            <th scope="col" className="num px-1 py-1 text-right font-semibold">
              Form
            </th>
            <th scope="col" className="num px-1 py-1 text-right font-semibold">
              <abbr title="Total points">Pts</abbr>
            </th>
            <th scope="col" className="num px-1 py-1 text-right font-semibold">
              <abbr title="Share of his club's league minutes this season">Min %</abbr>
            </th>
            <th scope="col" className="num px-1 py-1 text-right font-semibold">
              <abbr title="Selected by, % of FPL teams">Own</abbr>
            </th>
            <th scope="col" className="px-1 py-1 font-semibold">
              {n === 1 ? "Next fixture" : `Next ${n} gameweeks`} <span className="font-normal">(difficulty)</span>
            </th>
            {action && (
              <th scope="col" className="py-1 pl-1 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.player.id} className="border-b border-line align-top">
              <th scope="row" className="min-w-44 py-1.5 pr-2 font-normal">
                <PlayerName player={r.player} />
              </th>
              <td className="num px-1 py-1.5 text-right font-semibold">{fmtPrice(r.player.price)}</td>
              <td className="num px-1 py-1.5 text-right">
                <Stat value={one(r.player.form)} />
              </td>
              <td className="num px-1 py-1.5 text-right">
                <Stat value={r.player.points} />
              </td>
              <td className="num px-1 py-1.5 text-right">
                <Stat value={pct(r.share)} />
              </td>
              <td className="num px-1 py-1.5 text-right text-muted">
                <Stat value={r.player.owned == null ? null : `${one(r.player.owned)}%`} />
              </td>
              <td className="min-w-40 px-1 py-1.5">
                <FixtureRun run={r.run} />
                {r.run.difficulty != null && n > 1 && (
                  <span className="mt-0.5 block text-xs text-muted">Average {r.run.difficulty.toFixed(1)}</span>
                )}
              </td>
              {action && <td className="py-1 pl-1">{action(r.player)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const actionLink =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-sm font-semibold whitespace-nowrap hover:bg-field";

function PlayersView({ fpl, route, go }) {
  const n = route.gws ?? 3;
  const sort = sortKey(route.sort);
  const pool = fpl.players.filter(
    (p) =>
      (!route.pos || p.pos === route.pos) &&
      (!route.club || p.club === route.club) &&
      (route.max == null || p.price <= route.max),
  );
  const reported = useReported();
  const list = sortRows(rows(fpl, pool, n, reported), sort).slice(0, LIST_LIMIT);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Position">
          <select className={control} value={route.pos ?? ""} onChange={(e) => go({ pos: e.target.value || null })}>
            <option value="">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {POSITION_NAMES[p]}s
              </option>
            ))}
          </select>
        </Field>
        <Field label="Club">
          <select className={control} value={route.club ?? ""} onChange={(e) => go({ club: e.target.value || null })}>
            <option value="">All clubs</option>
            {CLUBS.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price up to">
          <select
            className={control}
            value={route.max ?? ""}
            onChange={(e) => go({ max: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Any price</option>
            {PRICE_CAPS.map((v) => (
              <option key={v} value={v}>
                {fmtPrice(v)}
              </option>
            ))}
          </select>
        </Field>
        <SortSelect value={sort} onChange={(v) => go({ sort: v })} />
        <GameweeksSelect value={n} onChange={(v) => go({ gws: v })} />
      </div>
      <p className="text-sm text-muted">
        {pool.length} players{pool.length > LIST_LIMIT ? `; top ${LIST_LIMIT} shown` : ""}. Form is FPL’s average points
        per match over the last 30 days. Difficulty is FPL’s rating, 1 (easiest) to 5.
      </p>
      {list.length ? (
        <PlayerTable
          list={list}
          n={n}
          caption={`FPL players sorted by “${SORTS[sort].label}”`}
          action={(p) => (
            <a
              href={toHash({ ...route, view: "assistant", out: String(p.id), a: null, b: null })}
              className={actionLink}
            >
              <Repeat aria-hidden="true" className="size-4" />
              <span>
                Replace<span className="sr-only"> {p.name}</span>
              </span>
            </a>
          )}
        />
      ) : (
        <p className="rounded-md bg-field px-3 py-6 text-muted">No player matches these filters.</p>
      )}
    </div>
  );
}

function OutSummary({ fpl, out, n }) {
  const run = fixtureRun(fpl.clubs[out.club], fromGameweek(fpl), n);
  const share = minutesShare(out, fpl.clubs[out.club]);
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <p className="text-sm font-semibold text-muted">Player out</p>
      <PlayerName player={out} />
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {[
          ["Price", fmtPrice(out.price)],
          ["Form", one(out.form)],
          ["Total points", out.points],
          ["Share of minutes", pct(share)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="num font-semibold">
              <Stat value={v} />
            </dd>
          </div>
        ))}
      </dl>
      {out.news && <p className="mt-2 text-sm">FPL news: {out.news}</p>}
      <div className="mt-2">
        <FixtureRun run={run} />
      </div>
    </div>
  );
}

function AssistantView({ fpl, route, go }) {
  const n = route.gws ?? 3;
  const sort = sortKey(route.sort);
  const out = route.out ? fpl.players.find((p) => String(p.id) === route.out) : null;
  const fee = fpl.rules.sellOnFee ?? 0.5;
  const budget = out ? transferBudget({ out, bank: route.bank ?? 0, paid: route.paid, fee }) : null;
  const reported = useReported();
  const result =
    out && budget
      ? replacements(fpl, out, {
          budget: budget.total,
          sort,
          n,
          includeDoubtful: route.doubtful,
          reported,
          minShare: route.regular ? REGULAR_SHARE : null,
        })
      : null;
  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-muted">
        Choose a player to sell. The assistant lists players in the same position you can afford, who FPL expects to be
        available and no recent report says are injured, with their form, playing time and next fixtures. It can’t see
        your FPL team, so check you’d still have at most {fpl.rules.perClub ?? 3} players from one club.
      </p>
      <PlayerPicker
        label={out ? "Change the player out" : "Player out"}
        players={fpl.players}
        onPick={(p) => go({ out: String(p.id) })}
      />
      {route.out && !out && (
        <p className="rounded-md bg-field px-3 py-3 text-muted">That player isn’t in FPL’s current player list.</p>
      )}
      {out && budget && (
        <>
          <OutSummary fpl={fpl} out={out} n={n} />
          <fieldset className="space-y-3 rounded-md border border-line p-3">
            <legend className="px-1 font-display text-xl font-semibold">Budget</legend>
            <div className="flex flex-wrap items-start gap-3">
              <PriceInput
                key={`bank-${route.out}`}
                label="Money in the bank (£m)"
                value={route.bank}
                onCommit={(v) => go({ bank: v })}
                hint="Shown in FPL’s transfers screen"
              />
              <PriceInput
                key={`paid-${route.out}`}
                label="Price you paid (£m, optional)"
                value={route.paid}
                placeholder={(out.price / 10).toFixed(1)}
                onCommit={(v) => go({ paid: v })}
                hint="For FPL’s selling price"
              />
            </div>
            <p aria-live="polite" className="num">
              Selling price <strong>{fmtPrice(budget.sell)}</strong> + bank <strong>{fmtPrice(budget.bank)}</strong> ={" "}
              <strong className="text-lg">{fmtPrice(budget.total)}</strong> to spend
            </p>
            <p className="text-sm text-muted">
              {budget.assumedPrice
                ? "Using his current price as the selling price. If his price has risen since you bought him, FPL pays you less: enter what you paid."
                : `FPL pays the price you paid plus ${Math.round(fee * 100)}% of any rise (rounded down to £0.1m), or the current price if it has fallen.`}
            </p>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3">
            <SortSelect value={sort} onChange={(v) => go({ sort: v })} />
            <GameweeksSelect value={n} onChange={(v) => go({ gws: v })} />
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="size-5"
                checked={route.doubtful}
                onChange={(e) => go({ doubtful: e.target.checked })}
              />
              Include doubtful players
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="size-5"
                checked={route.regular}
                onChange={(e) => go({ regular: e.target.checked })}
              />
              Regular starters only ({Math.round(REGULAR_SHARE * 100)}%+ of minutes)
            </label>
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold">
              {POSITION_NAMES[out.pos]}s up to {fmtPrice(budget.total)}
            </h2>
            <p className="mb-2 text-sm text-muted">
              {result.total} {result.total === 1 ? "player" : "players"}
              {result.total > result.rows.length ? `; top ${result.rows.length} shown` : ""}, sorted by “
              {SORTS[sort].label}”. Not listed: players FPL rules out
              {route.doubtful ? "" : ", or flags as doubtful, or the news reports injured"}
              {route.regular
                ? `, or who have played under ${Math.round(REGULAR_SHARE * 100)}% of their club’s minutes`
                : ""}
              .
            </p>
            {result.rows.length ? (
              <PlayerTable
                list={result.rows}
                n={n}
                caption={`Possible replacements for ${out.name}`}
                action={(p) => (
                  <a
                    href={toHash({ ...route, view: "compare", a: String(out.id), b: String(p.id) })}
                    className={actionLink}
                  >
                    <ArrowLeftRight aria-hidden="true" className="size-4" />
                    <span>
                      Compare
                      <span className="sr-only">
                        {" "}
                        {p.name} with {out.name}
                      </span>
                    </span>
                  </a>
                )}
              />
            ) : (
              <p className="rounded-md bg-field px-3 py-6 text-muted">
                No available {POSITION_NAMES[out.pos].toLowerCase()} costs {fmtPrice(budget.total)} or less.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CompareView({ fpl, route, go }) {
  const n = route.gws ?? 3;
  const pick = (id) => (id ? (fpl.players.find((p) => String(p.id) === id) ?? null) : null);
  const a = pick(route.a);
  const b = pick(route.b);
  const both = [a, b];
  const from = fromGameweek(fpl);
  const runs = both.map((p) => (p ? fixtureRun(fpl.clubs[p.club], from, n) : null));
  const lines = [
    ["Price", (p) => fmtPrice(p.price)],
    ["Total points", (p) => p.points],
    ["Points per match", (p) => one(p.ppg)],
    ["Form", (p) => one(p.form)],
    ["Minutes", (p) => p.minutes],
    ["Starts", (p) => p.starts],
    ["Share of minutes", (p) => pct(minutesShare(p, fpl.clubs[p.club]))],
    ["Expected goals (xG)", (p) => (p.xg == null ? null : p.xg.toFixed(2))],
    ["Expected assists (xA)", (p) => (p.xa == null ? null : p.xa.toFixed(2))],
    ["FPL’s projected points, next gameweek", (p) => one(p.ep)],
    ["Selected by", (p) => (p.owned == null ? null : `${one(p.owned)}%`)],
    [
      "FPL availability flag",
      (p) =>
        p.chance != null
          ? `${STATUS_NAMES[p.status]}, ${p.chance}% to play`
          : p.status === "a"
            ? "No flag"
            : STATUS_NAMES[p.status],
    ],
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <PlayerPicker
          label={a ? "Change player 1" : "Player 1"}
          players={fpl.players}
          exclude={b?.id}
          onPick={(p) => go({ a: String(p.id) })}
        />
        <PlayerPicker
          label={b ? "Change player 2" : "Player 2"}
          players={fpl.players}
          exclude={a?.id}
          onPick={(p) => go({ b: String(p.id) })}
        />
      </div>
      <GameweeksSelect value={n} onChange={(v) => go({ gws: v })} />
      {a || b ? (
        <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full max-w-3xl border-collapse text-left">
            <caption className="sr-only">
              {a?.name ?? "Player 1"} compared with {b?.name ?? "Player 2"}, Fantasy Premier League figures
            </caption>
            <thead>
              <tr className="border-b-2 border-ink">
                <td />
                {both.map((p, i) => (
                  <th key={i} scope="col" className="w-2/5 px-2 py-2 align-bottom font-normal">
                    {p ? <PlayerName player={p} /> : <span className="text-muted">Choose player {i + 1}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map(([label, get]) => (
                <tr key={label} className="border-b border-line">
                  <th scope="row" className="py-1.5 pr-2 text-sm font-semibold text-muted">
                    {label}
                  </th>
                  {both.map((p, i) => (
                    <td key={i} className="num px-2 py-1.5">
                      {p ? <Stat value={get(p)} /> : null}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b border-line align-top">
                <th scope="row" className="py-1.5 pr-2 text-sm font-semibold text-muted">
                  {n === 1 ? "Next fixture" : `Next ${n} gameweeks`}
                </th>
                {runs.map((run, i) => (
                  <td key={i} className="px-2 py-1.5">
                    {run && (
                      <>
                        <FixtureRun run={run} />
                        {run.difficulty != null && (
                          <span className="mt-0.5 block text-xs text-muted">
                            Average difficulty {run.difficulty.toFixed(1)}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-md bg-field px-3 py-6 text-muted">Choose two players to compare their FPL figures.</p>
      )}
    </div>
  );
}

function GameweekLine({ fpl }) {
  const gw = fpl.next;
  if (!gw) return null;
  return (
    <p className="mt-1">
      Next: <strong>Gameweek {gw.id} (FPL)</strong>
      {gw.deadline && (
        <>
          , deadline <time dateTime={gw.deadline.toISOString()}>{fmtFull(gw.deadline)}</time>
        </>
      )}
    </p>
  );
}

export default function FplPage({ route }) {
  const state = useSource("fpl");
  const news = useSource("news");
  const stories = useStories(news.data);
  const fplPlayers = state.data?.players;
  const reports = useMemo(() => {
    /** @type {Map<string, any>} */
    const all = new Map();
    if (!fplPlayers || !stories.length) return all;
    for (const squad of espnSquads(fplPlayers).values())
      for (const [id, r] of injuryReports(stories, squad)) all.set(id, r);
    return all;
  }, [fplPlayers, stories]);
  useTitle(titleFor(route));
  /** Filters live in the address; changing one replaces the entry so Back leaves the page. */
  const go = (patch) => window.location.replace(toHash({ ...route, ...patch }));
  const viewHref = (view) => toHash({ ...route, view });
  const title = VIEWS.find(([k]) => k === route.view)?.[1] ?? "Players";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-bold">Fantasy Premier League</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Prices, ownership, points, form and fixture difficulty from Fantasy Premier League, the official fantasy game.
          These are the game’s figures, not match statistics.
        </p>
        {state.data && <GameweekLine fpl={state.data} />}
      </div>
      <nav aria-label="Fantasy Premier League views" className="flex flex-wrap gap-1 border-b border-line">
        {VIEWS.map(([key, label]) => (
          <a
            key={key}
            href={viewHref(key)}
            aria-current={route.view === key ? "page" : undefined}
            className={`inline-flex min-h-11 items-center border-b-2 px-3 font-semibold ${
              route.view === key ? "border-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </a>
        ))}
      </nav>
      <Section
        id="fpl-heading"
        title={title}
        state={state}
        sourceLine={false}
        empty="Fantasy Premier League data isn’t available yet."
      >
        {(fpl) => (
          <Reports.Provider value={reports}>
            {route.view === "assistant" ? (
              <AssistantView fpl={fpl} route={route} go={go} />
            ) : route.view === "compare" ? (
              <CompareView fpl={fpl} route={route} go={go} />
            ) : (
              <PlayersView fpl={fpl} route={route} go={go} />
            )}
            <FreshnessLine
              label="Source: Fantasy Premier League public data, collected by this site’s pipeline every 4 hours"
              at={state.asOf}
            />
            <FreshnessLine
              label="Injury notes: recent headlines from reliable outlets (this site's news feeds), shown where FPL's flags may lag"
              at={news.asOf}
            />
          </Reports.Provider>
        )}
      </Section>
    </div>
  );
}
