import { useEffect, useMemo, useState } from "react";
import { CLUBS } from "../config/clubs.js";
import { loadSource, readCache } from "../lib/data.js";

/**
 * Every club's squad, for player search. Loaded only on this page: saved copies show at once, then the
 * 20 rosters load in the background (each shared with any club page that wants the same one).
 */
export function useAllPlayers() {
  const [rosters, setRosters] = useState(() => {
    const cache = readCache();
    return Object.fromEntries(CLUBS.map((c) => [c.slug, cache[`roster:${c.espnId}`]?.data ?? null]));
  });
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.allSettled(
      CLUBS.map((c) =>
        loadSource(`roster:${c.espnId}`).then((r) => {
          if (live) setRosters((prev) => ({ ...prev, [c.slug]: r.data }));
        }),
      ),
    ).then((all) => live && setFailed(all.filter((r) => r.status === "rejected").length));
    return () => {
      live = false;
    };
  }, []);
  const players = useMemo(
    () =>
      Object.entries(rosters).flatMap(([clubSlug, data]) =>
        (data?.players ?? []).map((player) => ({ player, clubSlug })),
      ),
    [rosters],
  );
  const loaded = Object.values(rosters).filter(Boolean).length;
  return { players, loaded, failed };
}
