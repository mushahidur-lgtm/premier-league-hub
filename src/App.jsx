import { useEffect, useState } from "react";
import { parseHash } from "./lib/route.js";
import { SITE_NAME } from "./config/site.js";

/** Phase 1 placeholder: proves the deployed site can read the pipeline's same-origin data. */
function PipelineStatus() {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/meta.json`, { signal: ctrl.signal, cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((meta) => setState({ status: "ok", meta }))
      .catch((err) => {
        if (err.name !== "AbortError") setState({ status: "error", error: String(err.message ?? err) });
      });
    return () => ctrl.abort();
  }, []);

  if (state.status === "loading") return <p className="mt-4 text-neutral-700">Loading data status…</p>;
  if (state.status === "error") {
    return (
      <p role="alert" className="mt-4 text-red-800">
        Couldn’t load data/meta.json ({state.error}).
      </p>
    );
  }
  const { meta } = state;
  const generated = new Date(meta.generatedAt);
  const ageHours = (Date.now() - generated.getTime()) / 36e5;
  return (
    <section aria-labelledby="pipeline-heading" className="mt-6 rounded-lg border border-neutral-300 p-4">
      <h2 id="pipeline-heading" className="font-semibold">
        News pipeline
      </h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-neutral-700">Updated</dt>
        <dd>
          <time dateTime={meta.generatedAt}>{generated.toLocaleString()}</time>
          {ageHours > 6 && <span className="ml-2 text-amber-800">(stale)</span>}
        </dd>
        <dt className="text-neutral-700">Stories</dt>
        <dd>{meta.counts.items}</dd>
        <dt className="text-neutral-700">Feeds working</dt>
        <dd>
          {meta.counts.feedsOk} of {meta.counts.feeds}
        </dd>
      </dl>
      <p className="mt-3 text-sm">
        <a className="underline" href={`${import.meta.env.BASE_URL}data/news.json`}>
          data/news.json
        </a>
      </p>
    </section>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">{SITE_NAME}</h1>
        <p className="mt-2 text-neutral-700">Under construction. Current route: {route.name}</p>
        <PipelineStatus />
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-sm text-neutral-700">
        Unofficial fan site, not affiliated with the Premier League or any club. Data from ESPN; news links to the
        original outlets.
      </footer>
    </div>
  );
}
