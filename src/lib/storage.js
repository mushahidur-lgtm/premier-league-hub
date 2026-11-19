// @ts-check
/**
 * Small localStorage helpers. Storage can be unavailable (private mode,
 * blocked site data), so every access is guarded and the app works without it.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { clubBySlug } from "../config/clubs.js";

/** Prefix for every key this site writes, so it never collides with another app on the same origin. */
export const STORAGE_PREFIX = "plh-";

const isPlainObject = (/** @type {unknown} */ v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** True when `value` has the same basic shape as `fallback` (array / object / primitive). */
function sameShape(/** @type {unknown} */ value, /** @type {unknown} */ fallback) {
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (isPlainObject(fallback)) return isPlainObject(value);
  if (fallback === null || fallback === undefined) return true;
  return typeof value === typeof fallback;
}

/**
 * Reads and parses a stored value. Anything unusable (missing, unparseable, or a
 * different shape than the caller expects, e.g. `null` or a string where an
 * object is needed) yields `fallback`, so corrupted storage can never crash a hook.
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return sameShape(parsed, fallback) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** @param {string} key @param {unknown} value */
export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: persistence is optional */
  }
}

/**
 * useState that survives reloads.
 * @template T
 * @param {string} key
 * @param {T} initial
 * @returns {[T, import("react").Dispatch<import("react").SetStateAction<T>>]}
 */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => readJSON(key, initial));
  useEffect(() => writeJSON(key, value), [key, value]);
  return [value, setValue];
}

const MY_CLUB_KEY = `${STORAGE_PREFIX}my-club-v1`;

/*
 * The viewer's club is one shared store (same pattern as refresh.js), so picking a club in the header
 * re-themes the whole shell at once. It also follows changes made in other tabs (the "storage" event).
 * If storage refuses writes, the choice is kept in memory for this page load.
 */
/** @type {string | null} */
let memoryClub = null;
let memoryOnly = false;
const clubSubscribers = new Set();
const notifyClub = () => clubSubscribers.forEach((fn) => fn());

/** @returns {string | null} */
function readMyClub() {
  if (memoryOnly) return memoryClub;
  const stored = readJSON(MY_CLUB_KEY, /** @type {string | null} */ (null));
  return typeof stored === "string" && clubBySlug(stored) ? stored : null;
}

/** @param {string | null} next */
export function setMyClub(next) {
  const slug = next && clubBySlug(next) ? next : null;
  memoryClub = slug;
  try {
    localStorage.setItem(MY_CLUB_KEY, JSON.stringify(slug));
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  notifyClub();
}

/** @param {() => void} notify */
function subscribeMyClub(notify) {
  clubSubscribers.add(notify);
  const onStorage = (/** @type {StorageEvent} */ e) => {
    if (e.key === MY_CLUB_KEY || e.key === null) notify();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    clubSubscribers.delete(notify);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/**
 * The viewer's club, stored on this device only. Returns the slug, or null when none is picked or the
 * stored slug is no longer a club in `clubs.js` (e.g. after promotion/relegation). Every component
 * using it sees the same value.
 * @returns {{ slug: string | null, setSlug: (slug: string | null) => void }}
 */
export function useMyClub() {
  const slug = useSyncExternalStore(subscribeMyClub, readMyClub, () => null);
  return { slug, setSlug: setMyClub };
}

/** Test helper: forget the in-memory fallback. */
export function resetMyClub() {
  memoryClub = null;
  memoryOnly = false;
}

/**
 * Adds `value` to a keyed cache object and keeps at most `max` entries, dropping the oldest first
 * (by each entry's `at` timestamp). Keeps localStorage from growing without bound.
 * @param {Record<string, any>} cache
 * @param {string} key
 * @param {any} value
 * @param {number} max
 */
export function boundedPut(cache, key, value, max) {
  cache[key] = value;
  const keys = Object.keys(cache);
  if (keys.length <= max) return cache;
  keys
    .filter((k) => k !== key)
    .sort((a, b) => (cache[a]?.at ?? 0) - (cache[b]?.at ?? 0))
    .slice(0, keys.length - max)
    .forEach((k) => delete cache[k]);
  return cache;
}
