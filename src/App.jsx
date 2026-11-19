import { useEffect, useState } from "react";
import { parseHash } from "./lib/route.js";
import { SITE_NAME } from "./config/site.js";

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
        <p className="mt-2 text-neutral-700">Scaffold. Current route: {route.name}</p>
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-sm text-neutral-700">
        Unofficial fan site, not affiliated with the Premier League or any club. Data from ESPN; news links to the
        original outlets.
      </footer>
    </div>
  );
}
