// @ts-check
/**
 * Is a newer build of the site live than the one running? GitLab Pages caches every file for 10 minutes, so
 * after a deploy a returning visitor can be served the previous index.html. The build writes version.json
 * (vite.config.js); this checks it, uncached, on load and when the tab comes back, at most every 5 minutes.
 */
import { useEffect, useState } from "react";

export const BUILD_ID = import.meta.env?.VITE_BUILD_ID ?? null;
const CHECK_EVERY_MS = 5 * 60e3;

/** @param {unknown} json @param {string | null} running */
export const isNewer = (json, running) =>
  running != null &&
  typeof json === "object" &&
  json !== null &&
  typeof (/** @type {any} */ (json).build) === "string" &&
  /** @type {any} */ (json).build !== running;

/** True once version.json names a different build than this one. */
export function useNewVersion() {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (import.meta.env?.DEV || !BUILD_ID) return undefined;
    let last = 0;
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - last < CHECK_EVERY_MS) return;
      last = Date.now();
      try {
        // Plain fetch, never the memoised data layer: this must reach the server every time.
        const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" });
        if (res.ok && alive && isNewer(await res.json(), BUILD_ID)) setNewer(true);
      } catch {
        // Offline or blocked: try again next time.
      }
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return newer;
}
