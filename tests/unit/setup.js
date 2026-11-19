import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Newer Node versions ship an experimental global `localStorage` that shadows jsdom's and is
// unusable without a backing file. Install a small spec-shaped replacement so tests are portable.
class MemoryStorage {
  #m = new Map();
  get length() {
    return this.#m.size;
  }
  key(i) {
    return [...this.#m.keys()][i] ?? null;
  }
  getItem(k) {
    return this.#m.has(String(k)) ? this.#m.get(String(k)) : null;
  }
  setItem(k, v) {
    this.#m.set(String(k), String(v));
  }
  removeItem(k) {
    this.#m.delete(String(k));
  }
  clear() {
    this.#m.clear();
  }
}
Object.defineProperty(globalThis, "Storage", { value: MemoryStorage, configurable: true, writable: true });
Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true, writable: true });

afterEach(() => {
  // Vitest runs without globals, so Testing Library cannot register its own cleanup: unmount here so
  // hooks from one test (e.g. listening for refreshAll) never react to the next.
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
