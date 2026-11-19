import { describe, expect, it } from "vitest";
import { LruCache } from "../../src/lib/cache.js";

const clock = () => {
  let t = 1000;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
};

describe("LruCache", () => {
  it("stores and returns values, and reports a miss as undefined", () => {
    const c = new LruCache({ max: 3 });
    c.set("a", { v: 1 }, 1000);
    expect(c.get("a")).toEqual({ v: 1 });
    expect(c.get("zzz")).toBeUndefined();
  });
  it("ignores undefined values (they would look like misses)", () => {
    const c = new LruCache({ max: 3 });
    c.set("a", undefined, 1000);
    expect(c.size).toBe(0);
  });
  it("expires entries after their own TTL", () => {
    const k = clock();
    const c = new LruCache({ max: 5, now: k.now });
    c.set("short", 1, 1000);
    c.set("long", 2, 5000);
    k.advance(999);
    expect(c.get("short")).toBe(1);
    k.advance(2);
    expect(c.get("short")).toBeUndefined(); // 1001ms old, TTL 1000
    expect(c.get("long")).toBe(2);
    k.advance(5000);
    expect(c.get("long")).toBeUndefined();
    expect(c.size).toBe(0); // expired entries are removed when touched
  });
  it("evicts the least recently used entry when full", () => {
    const c = new LruCache({ max: 3 });
    for (const k of ["a", "b", "c"]) c.set(k, k, 1e6);
    c.get("a"); // a is now the most recently used
    c.set("d", "d", 1e6); // evicts b, the oldest untouched entry
    expect(c.keys()).toEqual(["c", "a", "d"]);
    expect(c.get("b")).toBeUndefined();
    expect(c.stats().evictions).toBe(1);
    c.set("e", "e", 1e6); // evicts c
    expect(c.keys()).toEqual(["a", "d", "e"]);
  });
  it("re-setting a key refreshes its value, TTL and recency without growing the cache", () => {
    const k = clock();
    const c = new LruCache({ max: 2, now: k.now });
    c.set("a", 1, 1000);
    c.set("b", 2, 1e6);
    k.advance(900);
    c.set("a", 3, 1000);
    k.advance(900);
    expect(c.get("a")).toBe(3); // would have expired under the first TTL
    expect(c.size).toBe(2);
    expect(c.stats().evictions).toBe(0);
  });
  it("never exceeds max", () => {
    const c = new LruCache({ max: 10 });
    for (let i = 0; i < 100; i++) c.set(`k${i}`, i, 1e6);
    expect(c.size).toBe(10);
    expect(c.keys()[0]).toBe("k90");
    expect(c.stats().evictions).toBe(90);
  });
  it("prune removes only the expired", () => {
    const k = clock();
    const c = new LruCache({ max: 5, now: k.now });
    c.set("a", 1, 100);
    c.set("b", 2, 1000);
    k.advance(500);
    expect(c.prune()).toBe(1);
    expect(c.keys()).toEqual(["b"]);
  });
  it("reports hits, misses, expirations and hit rate, overall and per category", () => {
    const k = clock();
    const c = new LruCache({ max: 5, now: k.now });
    c.set("r", 1, 100);
    c.get("r", "roster"); // hit
    c.get("nope", "roster"); // miss
    c.get("nope2", "live"); // miss
    k.advance(200);
    c.get("r", "roster"); // expired -> miss + expiration
    const s = c.stats();
    expect(s).toMatchObject({ hits: 1, misses: 3, expirations: 1, hitRate: 0.25, size: 0, max: 5 });
    expect(s.byCategory.roster).toEqual({ hits: 1, misses: 2, expirations: 1 });
    expect(s.byCategory.live).toEqual({ hits: 0, misses: 1, expirations: 0 });
  });
  it("clear empties the cache but keeps the counters", () => {
    const c = new LruCache({ max: 5 });
    c.set("a", 1, 1e6);
    c.get("a");
    c.clear();
    expect(c.size).toBe(0);
    expect(c.stats().hits).toBe(1);
  });
});
