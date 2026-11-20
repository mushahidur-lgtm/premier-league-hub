import { Suspense, useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { CLUBS, clubBySlug } from "./config/clubs.js";
import { SITE_NAME } from "./config/site.js";
import { accentVars } from "./lib/accent.js";
import { refreshAll, useAutoRefresh } from "./lib/data.js";
import { lazyRetry } from "./lib/lazy.js";
import { parseHash, toHash } from "./lib/route.js";
import { useMyClub } from "./lib/storage.js";
import { titleFor } from "./lib/titles.js";
import { ErrorBoundary } from "./components/ui.jsx";
import Home from "./components/Home.jsx";

const ClubPage = lazyRetry(() => import("./components/ClubPage.jsx"));
const MatchPage = lazyRetry(() => import("./components/MatchPage.jsx"));
const SearchPage = lazyRetry(() => import("./components/SearchPage.jsx"));
const PlayerPage = lazyRetry(() => import("./components/PlayerPage.jsx"));
const ComparePage = lazyRetry(() => import("./components/ComparePage.jsx"));

function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

function ClubPicker() {
  const { slug, setSlug } = useMyClub();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only sm:not-sr-only">My club</span>
      <select
        value={slug ?? ""}
        onChange={(e) => setSlug(e.target.value || null)}
        className="min-h-11 max-w-40 rounded-md border border-line bg-white px-2 font-semibold text-ink"
      >
        <option value="">Pick your club</option>
        {CLUBS.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.shortName}
          </option>
        ))}
      </select>
    </label>
  );
}

function Header() {
  const [spinning, setSpinning] = useState(false);
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <a href="#/" className="mr-auto flex min-h-11 items-center gap-2">
          <span aria-hidden="true" className="kit-stripe inline-block h-6 w-2 rounded-sm" />
          <span className="font-display text-2xl leading-none font-bold">{SITE_NAME}</span>
        </a>
        <nav aria-label="Main" className="flex items-center gap-2">
          <a
            href={toHash({ name: "search", query: "" })}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 font-semibold hover:bg-field"
          >
            <Search aria-hidden="true" className="size-5" />
            <span className="sr-only sm:not-sr-only">Search</span>
          </a>
          <ClubPicker />
          <button
            type="button"
            onClick={() => {
              setSpinning(true);
              refreshAll();
              setTimeout(() => setSpinning(false), 800);
            }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-field"
          >
            <RefreshCw aria-hidden="true" className={`size-5 ${spinning ? "animate-spin" : ""}`} />
            <span className="sr-only">Refresh data</span>
          </button>
        </nav>
      </div>
    </header>
  );
}

function NotFound({ path }) {
  return (
    <div>
      <h1 className="font-display text-4xl font-bold">Page not found</h1>
      <p className="mt-2 text-muted">
        There’s nothing at <code>{path || "this address"}</code>. Try the{" "}
        <a href="#/" className="font-semibold text-accent underline">
          league home
        </a>{" "}
        or{" "}
        <a href="#/search" className="font-semibold text-accent underline">
          search
        </a>
        .
      </p>
    </div>
  );
}

function Page({ route, myClub }) {
  switch (route.name) {
    case "home":
      return <Home myClub={myClub} />;
    case "club": {
      const club = clubBySlug(route.slug);
      return club ? <ClubPage club={club} /> : <NotFound path={`/club/${route.slug}`} />;
    }
    case "match":
      return <MatchPage eventId={route.eventId} />;
    case "player":
      return <PlayerPage playerId={route.playerId} />;
    case "compare":
      return <ComparePage a={route.a} b={route.b} />;
    case "search":
      return <SearchPage query={route.query} />;
    default:
      return <NotFound path={route.path} />;
  }
}

export default function App() {
  const route = useRoute();
  const { slug } = useMyClub();
  const myClub = slug ? clubBySlug(slug) : null;
  useAutoRefresh();

  // A club page takes that club's colours; everywhere else uses the viewer's club (or the site default).
  const pageClub = route.name === "club" ? clubBySlug(route.slug) : null;
  const vars = accentVars(pageClub ?? myClub);

  // Per-route title (the match page refines its own once the teams are known), and focus to the
  // new page's main region so keyboard and screen reader users start at the top of the content.
  const main = useRef(null);
  const first = useRef(true);
  const routeKey = window.location.hash;
  useEffect(() => {
    // Match, player and compare pages own their titles (they know the names only once data arrives).
    if (!["match", "player", "compare"].includes(route.name))
      document.title = titleFor(route, { clubName: pageClub?.name });
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus();
    window.scrollTo(0, 0);
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={vars} className="flex min-h-screen flex-col bg-chalk text-ink">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
        className="sr-only z-50 rounded-md bg-accent px-4 py-3 font-semibold text-accent-ink focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" ref={main} tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none">
        <ErrorBoundary resetKey={routeKey}>
          <Suspense
            fallback={
              <p role="status" className="text-muted">
                Loading page…
              </p>
            }
          >
            <Page route={route} myClub={myClub} />
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted">
          <p>
            Unofficial fan site, not affiliated with the Premier League or any club. Fixtures, table, squads and match
            data from ESPN. News headlines link to the original outlets (BBC Sport, The Guardian, Sky Sports). Times are
            shown in your timezone.
          </p>
        </div>
      </footer>
    </div>
  );
}
