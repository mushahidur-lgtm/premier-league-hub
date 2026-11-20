// @ts-check
/**
 * Light / dark theme. The viewer's choice ("system", "light" or "dark") is kept in localStorage; "system"
 * follows the device. The resolved theme is set as data-theme on <html>, which index.css reads. index.html runs
 * the same resolution inline before first paint (keep THEME_KEY in step with it), so there is no flash.
 */
import { useSyncExternalStore } from "react";

export const THEME_KEY = "plh-theme";
/** @typedef {"system" | "light" | "dark"} ThemePref */
export const THEME_PREFS = /** @type {const} */ (["system", "light", "dark"]);
/** Browser bar colour per theme (the page background). */
const BAR = { light: "#fafbf8", dark: "#0e1512" };

/** @param {unknown} v @returns {ThemePref} */
export const asPref = (v) => (v === "light" || v === "dark" ? v : "system");

/**
 * @param {ThemePref} pref
 * @param {boolean} systemDark
 * @returns {"light" | "dark"}
 */
export const resolveTheme = (pref, systemDark) => (pref === "system" ? (systemDark ? "dark" : "light") : pref);

/** The next choice for the header's theme button. @param {ThemePref} pref @returns {ThemePref} */
export const nextPref = (pref) => THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length];

/** Dark-background crest from ESPN (same file name under 500-dark). @param {string} url */
export const darkCrest = (url) => url.replace("/teamlogos/soccer/500/", "/teamlogos/soccer/500-dark/");

/** @returns {ThemePref} */
function readPref() {
  try {
    return asPref(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

const media = () =>
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

let pref = typeof window === "undefined" ? /** @type {ThemePref} */ ("system") : readPref();
/** @type {Set<() => void>} */
const listeners = new Set();
let snapshot = { pref, theme: resolveTheme(pref, media()?.matches ?? false) };

function apply() {
  const theme = resolveTheme(pref, media()?.matches ?? false);
  snapshot = { pref, theme };
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[theme]);
  }
  for (const l of listeners) l();
}

/** @param {ThemePref} next */
export function setThemePref(next) {
  pref = asPref(next);
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
  apply();
}

/** @param {() => void} cb */
function subscribe(cb) {
  listeners.add(cb);
  const mq = media();
  const onChange = () => pref === "system" && apply();
  mq?.addEventListener?.("change", onChange);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener?.("change", onChange);
  };
}

/** The viewer's choice and the theme in effect. */
export function useTheme() {
  const s = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  return { ...s, setPref: setThemePref };
}

// Keep <html> in step with the store from the first import (index.html set it already; this corrects a
// stale value, e.g. after the stored choice changed in another tab).
if (typeof document !== "undefined") apply();
