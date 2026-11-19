import { Component, useEffect, useMemo, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { clubByEspnId } from "../config/clubs.js";
import { sizedCrest } from "../lib/crest.js";
import { fmtFull, timeAgo } from "../lib/format.js";
import { isChunkError } from "../lib/lazy.js";
import { buildStories } from "../lib/news.js";
import { toHash } from "../lib/route.js";

/** Shared button look: 44 px tall, visible focus from index.css. */
export const btn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 font-semibold text-ink hover:border-ink";
export const btnAccent =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 font-semibold text-accent-ink hover:opacity-90";

/** "ESPN club schedule · updated 3m ago", with the exact time on hover and for screen readers. */
export function SourceLine({ state }) {
  if (!state.source) return null;
  const at = state.asOf;
  return (
    <p className="mt-3 text-sm text-muted">
      Source: {state.source.name}, {state.source.detail}
      {at && (
        <>
          {" · "}
          <time dateTime={at.toISOString()} title={fmtFull(at)}>
            updated {timeAgo(at)}
          </time>
        </>
      )}
      {state.status === "refreshing" && " · checking for updates…"}
    </p>
  );
}

/**
 * One data section: heading, then loading / error / empty / stale states around `children(data)`,
 * then the source line. Every section on every page goes through this.
 * @param {{ title: string, id: string, state: any, empty?: string, children: (data: any) => any,
 *   action?: any, className?: string, headingLevel?: 2 | 3 }} props
 */
export function Section({ title, id, state, empty = "Nothing to show yet.", children, action, className = "" }) {
  const hasData = state.data != null;
  return (
    <section aria-labelledby={id} className={`min-w-0 ${className}`}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id={id} className="font-display text-2xl font-semibold leading-tight">
          {title}
        </h2>
        {action}
      </div>
      {!hasData && (state.status === "loading" || state.status === "idle") && (
        <p role="status" className="animate-pulse rounded-md bg-field px-3 py-6 text-muted">
          Loading…
        </p>
      )}
      {state.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-loss/40 bg-white p-3">
          <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-loss" />
          <p className="min-w-0 flex-1">
            {hasData ? "Couldn’t refresh; showing the last saved copy." : "Couldn’t load this section."}{" "}
            <span className="text-muted">({state.error})</span>
          </p>
          <button type="button" className={btn} onClick={() => state.reload()}>
            <RefreshCw aria-hidden="true" className="size-4" /> Try again
          </button>
        </div>
      )}
      {hasData && state.stale && state.status !== "error" && (
        <p className="mb-2 text-sm font-semibold text-warn">
          {state.status === "refreshing" ? "Saved copy from an earlier visit; updating…" : "This may be out of date."}
        </p>
      )}
      {hasData && state.empty && <p className="rounded-md bg-field px-3 py-6 text-muted">{empty}</p>}
      {hasData && !state.empty && children(state.data)}
      {state.warnings?.length > 0 && <p className="mt-2 text-sm text-muted">{state.warnings.join(". ")}.</p>}
      {(hasData || state.status === "error") && <SourceLine state={state} />}
    </section>
  );
}

/** ESPN CDN crest. Decorative next to a name, so alt is empty unless `label` is given. */
export function Crest({ src, espnId, size = 24, label = "" }) {
  const url = src || (espnId ? `https://a.espncdn.com/i/teamlogos/soccer/500/${espnId}.png` : null);
  if (!url) return <span style={{ width: size, height: size }} className="inline-block shrink-0" />;
  return (
    <img
      src={sizedCrest(url, size)}
      srcSet={`${sizedCrest(url, size, 2)} 2x`}
      alt={label}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className="inline-block shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}

/** A team's name, linked to its club page when it's a Premier League club. */
export function TeamLink({ side, className = "" }) {
  const club = side?.id ? clubByEspnId(side.id) : null;
  const name = side?.short ?? side?.name ?? "TBD";
  if (!club) return <span className={className}>{name}</span>;
  return (
    <a href={toHash({ name: "club", slug: club.slug })} className={`underline-offset-2 hover:underline ${className}`}>
      {name}
    </a>
  );
}

const RESULT = {
  W: { label: "Win", cls: "bg-win text-white" },
  D: { label: "Draw", cls: "bg-draw text-white" },
  L: { label: "Loss", cls: "bg-loss text-white" },
};

/** W / D / L chip with the full word for screen readers. */
export function ResultChip({ result, title }) {
  const r = RESULT[result];
  if (!r) return null;
  return (
    <span
      title={title}
      className={`num inline-flex size-7 items-center justify-center rounded-sm text-base font-bold ${r.cls}`}
    >
      <span aria-hidden="true">{result}</span>
      <span className="sr-only">{r.label}</span>
    </span>
  );
}

/** Ticking countdown to a kick-off; only this component re-renders every second. */
export function Countdown({ to }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = to.getTime() - now;
  if (ms <= 0) return <span>Kick-off time reached</span>;
  const d = Math.floor(ms / 86400e3);
  const h = Math.floor((ms % 86400e3) / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  const s = Math.floor((ms % 60e3) / 1000);
  const parts = [
    [d, "d"],
    [h, "h"],
    [m, "m"],
  ].filter(([v], i) => v > 0 || i > 0);
  return (
    <span>
      {/* Screen readers get a calm, minute-level reading instead of a ticking one. */}
      <span aria-hidden="true" className="num text-2xl font-semibold tracking-wide">
        {parts.map(([v, u]) => `${v}${u}`).join(" ")} {d === 0 && `${s}s`}
      </span>
      <span className="sr-only">
        Kick-off in {d ? `${d} days, ` : ""}
        {h} hours and {m} minutes
      </span>
    </span>
  );
}

/** Catches render errors per route; a missing code chunk (after a deploy) offers a reload. */
export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    return (
      <div role="alert" className="rounded-md border border-loss/40 bg-white p-4">
        <h2 className="font-display text-2xl font-semibold">
          {chunk ? "This page needs a reload" : "Something went wrong on this page"}
        </h2>
        <p className="mt-1 text-muted">
          {chunk
            ? "The site was updated since you opened it, so part of this page couldn’t load."
            : "The rest of the site still works. Reloading usually fixes it."}
        </p>
        <button type="button" className={`${btnAccent} mt-3`} onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    );
  }
}

/** Stories built once per news.json copy and shared by every component that shows news. */
const storyCache = new WeakMap();
export function useStories(data) {
  return useMemo(() => {
    if (!data?.items) return [];
    if (!storyCache.has(data)) storyCache.set(data, buildStories(data.items));
    return storyCache.get(data);
  }, [data]);
}

/** Sets the document title while mounted. */
export function useTitle(title) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
