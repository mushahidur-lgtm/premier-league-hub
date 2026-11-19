import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  LOADERS,
  URLS,
  dataUrl,
  isEmptyData,
  loadSource,
  loaderFor,
  readCache,
  refreshAll,
  resetSourceState,
  useSource,
  writeCache,
} from "../../src/lib/data.js";
import { resetNetState } from "../../src/lib/net.js";
import { espnEvent } from "./helpers.js";

const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
const fail = (code) => ({ ok: false, status: code, headers: { get: () => null }, json: async () => ({}) });
const deferred = () => {
  let resolve;
  let reject;
  const p = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { p, resolve, reject };
};

beforeEach(() => {
  resetNetState();
  resetSourceState();
});

describe("URLs", () => {
  it("are built per club from the ESPN id; never the /teams/:id endpoint", () => {
    expect(URLS.schedule("363")).toBe("https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/363/schedule");
    expect(URLS.schedule("363", "league")).toContain("/eng.1/teams/363/schedule");
    expect(URLS.roster("363")).toContain("/eng.1/teams/363/roster");
    expect(URLS.scoreboard()).toMatch(/\/eng\.1\/scoreboard$/);
    expect(URLS.scoreboard("20250301-20250303")).toMatch(/scoreboard\?dates=20250301-20250303$/);
    expect(URLS.summary("704321")).toMatch(/\/all\/summary\?event=704321$/);
    for (const u of [URLS.schedule("1"), URLS.roster("1"), URLS.standings, URLS.scoreboard(), URLS.summary("1")]) {
      expect(u).not.toMatch(/\/teams\/\d+$/);
    }
  });
  it("news comes from this site's own origin, under the Vite base path", () => {
    expect(dataUrl("news.json")).toBe("/data/news.json"); // BASE_URL is "/" under Vitest
  });
});

describe("loaderFor", () => {
  it("maps keys to loaders and rejects unknown or incomplete keys", () => {
    for (const k of [
      "standings",
      "news",
      "scoreboard",
      "scoreboard:20250301",
      "schedule:359",
      "roster:359",
      "summary:1",
      "summary:1:eng.1",
    ]) {
      expect(loaderFor(k), k).toBeTypeOf("function");
    }
    for (const k of ["nope", "schedule", "roster:", "standings:1", "summary"]) expect(loaderFor(k), k).toBeNull();
  });
  it("an unknown key fails as a data error instead of throwing synchronously", async () => {
    await expect(loadSource("nope")).rejects.toMatchObject({ kind: "data" });
  });
});

describe("loaders", () => {
  it("club schedule: reads results from that club's side", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ events: [espnEvent()] })),
    );
    const { data } = await LOADERS.schedule("367");
    expect(data.results[0]).toMatchObject({ result: "L", isHome: false });
  });
  it("club schedule: falls back to league-only fixtures and says so", async () => {
    const f = vi.fn(async (u) => (String(u).includes("/all/") ? fail(404) : ok({ events: [espnEvent()] })));
    vi.stubGlobal("fetch", f);
    const { data, warnings } = await LOADERS.schedule("359");
    expect(data.results).toHaveLength(1);
    expect(warnings).toEqual(["Showing Premier League matches only"]);
  });
  it("scoreboard: league-wide, so no club perspective", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ events: [espnEvent()] })),
    );
    const { data } = await LOADERS.scoreboard();
    expect(data.results[0]).toMatchObject({ team: null, result: null });
  });
  it("news: parses the pipeline file and reports failed feeds from meta.json", async () => {
    const news = {
      generatedAt: "2025-03-01T10:00:00Z",
      outlets: {},
      items: [
        {
          id: "1",
          title: "T",
          link: "https://www.bbc.co.uk/1",
          date: "2025-03-01T09:00:00Z",
          outlet: "bbc",
          clubs: ["fulham"],
        },
      ],
    };
    const meta = {
      feeds: [
        { club: "fulham", outlet: "bbc", ok: true, items: 5 },
        { club: "fulham", outlet: "sky", ok: false, items: 0 },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u) => ok(String(u).endsWith("news.json") ? news : meta)),
    );
    const { data, warnings } = await LOADERS.news();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].source).toBe("BBC Sport");
    expect(data.generatedAt).toBeInstanceOf(Date);
    expect(data.feeds).toHaveLength(2);
    expect(warnings).toEqual(["1 of 2 news feeds failed at the last update"]);
  });
  it("news: still shows when meta.json is missing, with a warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u) => (String(u).endsWith("news.json") ? ok({ items: [] }) : fail(404))),
    );
    const { data, warnings } = await LOADERS.news();
    expect(data).toMatchObject({ items: [], feeds: null });
    expect(warnings).toEqual(["Feed status unavailable"]);
  });
  it("news: fails (no invented stories) when news.json is missing or malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fail(404)),
    );
    await expect(LOADERS.news()).rejects.toMatchObject({ kind: "http" });
    resetNetState();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ nope: true })),
    );
    await expect(LOADERS.news()).rejects.toMatchObject({ kind: "data" });
  });
});

describe("loadSource: shared requests and safe refresh", () => {
  it("callers asking for a key already loading share one request", async () => {
    const d = deferred();
    const loader = vi.fn(() => d.p);
    const a = loadSource("standings", { loader });
    const b = loadSource("standings", { loader });
    d.resolve({ data: { rows: [1] } });
    expect(await a).toEqual(await b);
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it("a forced reload starts a new request, and the older, slower result cannot overwrite the saved copy", async () => {
    const calls = [];
    const loader = () => {
      const d = deferred();
      calls.push(d);
      return d.p;
    };
    const older = loadSource("standings", { loader });
    const newer = loadSource("standings", { loader, force: true });
    expect(calls).toHaveLength(2);
    calls[1].resolve({ data: { rows: ["new"] } });
    await newer;
    calls[0].resolve({ data: { rows: ["old"] } });
    await older;
    expect(readCache().standings.data).toEqual({ rows: ["new"] });
  });
  it("a failed load writes nothing", async () => {
    await expect(loadSource("standings", { loader: async () => Promise.reject(new Error("boom")) })).rejects.toThrow(
      "boom",
    );
    expect(readCache().standings).toBeUndefined();
  });
});

describe("useSource", () => {
  afterEach(() => vi.unstubAllGlobals());
  const table = { rows: [{ id: "1", rank: 1 }], season: "2025-26" };

  it("loading → ok, with the source and fetch time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ children: [{ standings: { entries: [{ team: { id: 1 }, stats: [] }] } }] })),
    );
    const { result } = renderHook(() => useSource("standings"));
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current).toMatchObject({ stale: false, empty: false, error: null, source: { name: "ESPN" } });
    expect(result.current.savedAt).toBeInstanceOf(Date);
  });

  it("shows the last good copy at once, marked stale, then replaces it", async () => {
    writeCache("standings", { rows: [{ id: "old" }] }, new Date(Date.now() - 3600e3));
    const d = deferred();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => d.p),
    );
    const { result } = renderHook(() => useSource("standings"));
    expect(result.current).toMatchObject({ status: "refreshing", stale: true, data: { rows: [{ id: "old" }] } });
    await act(async () => d.resolve(ok({ children: [{ standings: { entries: [{ team: { id: 9 }, stats: [] }] } }] })));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.stale).toBe(false);
    expect(result.current.data.rows[0].id).toBe("9");
  });

  it("a failed load keeps the saved copy on screen, stale, with the error", async () => {
    writeCache("standings", table, new Date(Date.now() - 3600e3));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fail(500)),
    );
    const { result } = renderHook(() => useSource("standings"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ data: table, stale: true, error: "HTTP 500" });
    expect(readCache().standings.data).toEqual(table);
  });

  it("an error with nothing saved has no data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fail(404)),
    );
    const { result } = renderHook(() => useSource("roster:359"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ data: null, stale: false });
  });

  it("valid but empty data is 'empty', not 'ok'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ athletes: [] })),
    );
    const { result } = renderHook(() => useSource("roster:359"));
    await waitFor(() => expect(result.current.status).toBe("empty"));
    expect(result.current.empty).toBe(true);
  });

  it("a null key loads nothing", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { result } = renderHook(() => useSource(null));
    expect(result.current).toMatchObject({ status: "idle", data: null, source: null });
    expect(f).not.toHaveBeenCalled();
  });

  it("switching key (another club) never shows the previous club's data", async () => {
    writeCache("roster:1", { players: [{ id: "a" }] });
    const d = deferred();
    vi.stubGlobal(
      "fetch",
      vi.fn((u) =>
        String(u).includes("/teams/1/") ? Promise.resolve(ok({ athletes: [{ id: 1, displayName: "A" }] })) : d.p,
      ),
    );
    const { result, rerender } = renderHook(({ k }) => useSource(k), { initialProps: { k: "roster:1" } });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    rerender({ k: "roster:2" });
    expect(result.current).toMatchObject({ status: "loading", data: null });
    await act(async () => d.resolve(ok({ athletes: [{ id: 2, displayName: "B" }] })));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data.players.map((p) => p.id)).toEqual(["2"]);
  });

  it("refreshAll() makes every mounted source fetch again, bypassing the 30 s memo", async () => {
    const f = vi.fn(async () => ok({ athletes: [{ id: 1, displayName: "A" }] }));
    vi.stubGlobal("fetch", f);
    const { result } = renderHook(() => useSource("roster:359"));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(f).toHaveBeenCalledTimes(1);
    await act(async () => refreshAll());
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe("ok"));
  });

  it("two components on the same key share one network request", async () => {
    const f = vi.fn(async () => ok({ athletes: [] }));
    vi.stubGlobal("fetch", f);
    const a = renderHook(() => useSource("roster:359"));
    const b = renderHook(() => useSource("roster:359"));
    await waitFor(() => expect(a.result.current.status).toBe("empty"));
    await waitFor(() => expect(b.result.current.status).toBe("empty"));
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("isEmptyData", () => {
  it.each([
    [null, true],
    [[], true],
    [{ rows: [] }, true],
    [{ items: [] }, true],
    [{ players: [] }, true],
    [{ fixtures: [], results: [] }, true],
    [{ fixtures: [], results: [1] }, false],
    [{ rows: [1] }, false],
    [{ lineups: [] }, false], // unknown shapes are not assumed empty
  ])("%j → %s", (data, empty) => expect(isEmptyData(data)).toBe(empty));
});
