import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { boundedPut, readJSON, resetMyClub, useMyClub, usePersistentState, writeJSON } from "../../src/lib/storage.js";

describe("readJSON / writeJSON", () => {
  it("round-trips values", () => {
    writeJSON("k", { a: 1 });
    expect(readJSON("k", {})).toEqual({ a: 1 });
  });
  it("returns the fallback when nothing is stored", () => {
    expect(readJSON("missing", { x: 1 })).toEqual({ x: 1 });
  });
  it("returns the fallback for invalid JSON", () => {
    localStorage.setItem("k", "{not json");
    expect(readJSON("k", { ok: true })).toEqual({ ok: true });
  });
  it.each([
    ["null", "null"],
    ["a string", '"hello"'],
    ["a number", "42"],
    ["an array where an object is expected", "[1,2]"],
  ])("returns the fallback when an object is expected but %s is stored", (_n, stored) => {
    localStorage.setItem("k", stored);
    expect(readJSON("k", {})).toEqual({});
  });
  it("returns the fallback when an array is expected but an object is stored", () => {
    localStorage.setItem("k", '{"a":1}');
    expect(readJSON("k", [])).toEqual([]);
  });
  it("does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readJSON("k", 5)).toBe(5);
    expect(() => writeJSON("k", 1)).not.toThrow();
  });
});

describe("usePersistentState", () => {
  it("survives a remount and writes every change", () => {
    const a = renderHook(() => usePersistentState("k-test", { n: 0 }));
    act(() => a.result.current[1]({ n: 5 }));
    a.unmount();
    expect(JSON.parse(localStorage.getItem("k-test"))).toEqual({ n: 5 });
    const b = renderHook(() => usePersistentState("k-test", { n: 0 }));
    expect(b.result.current[0]).toEqual({ n: 5 });
  });
  it("falls back to the default when the stored value has the wrong shape", () => {
    localStorage.setItem("k-shape", '"a string"');
    expect(renderHook(() => usePersistentState("k-shape", { n: 0 })).result.current[0]).toEqual({ n: 0 });
    localStorage.setItem("k-arr", "{}");
    expect(renderHook(() => usePersistentState("k-arr", [])).result.current[0]).toEqual([]);
  });
  it("keeps working in memory when storage refuses writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const h = renderHook(() => usePersistentState("k-q", 1));
    act(() => h.result.current[1](2));
    expect(h.result.current[0]).toBe(2);
  });
});

describe("useMyClub", () => {
  it("starts empty, stores a valid club and survives a remount", () => {
    const a = renderHook(() => useMyClub());
    expect(a.result.current.slug).toBeNull();
    act(() => a.result.current.setSlug("brentford"));
    expect(a.result.current.slug).toBe("brentford");
    a.unmount();
    expect(renderHook(() => useMyClub()).result.current.slug).toBe("brentford");
  });
  it("ignores slugs that are not clubs, stored or set", () => {
    localStorage.setItem("plh-my-club-v1", '"not-a-club"');
    const h = renderHook(() => useMyClub());
    expect(h.result.current.slug).toBeNull();
    act(() => h.result.current.setSlug("also-not-a-club"));
    expect(h.result.current.slug).toBeNull();
  });
  it("is shared: a change in one component reaches every other at once", () => {
    resetMyClub();
    const picker = renderHook(() => useMyClub());
    const shell = renderHook(() => useMyClub());
    act(() => picker.result.current.setSlug("fulham"));
    expect(shell.result.current.slug).toBe("fulham");
  });
  it("keeps the choice in memory when storage refuses writes", () => {
    resetMyClub();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const h = renderHook(() => useMyClub());
    act(() => h.result.current.setSlug("fulham"));
    expect(h.result.current.slug).toBe("fulham");
    resetMyClub();
  });
  it("follows a change made in another tab", () => {
    resetMyClub();
    const h = renderHook(() => useMyClub());
    localStorage.setItem("plh-my-club-v1", '"brentford"');
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "plh-my-club-v1" })));
    expect(h.result.current.slug).toBe("brentford");
  });
  it("can be cleared", () => {
    const h = renderHook(() => useMyClub());
    act(() => h.result.current.setSlug("fulham"));
    act(() => h.result.current.setSlug(null));
    expect(h.result.current.slug).toBeNull();
  });
});

describe("boundedPut", () => {
  it("keeps at most max entries, dropping the oldest", () => {
    const c = { a: { at: 1 }, b: { at: 2 } };
    boundedPut(c, "c", { at: 3 }, 2);
    expect(Object.keys(c).sort()).toEqual(["b", "c"]);
  });
});
