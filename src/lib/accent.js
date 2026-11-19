// @ts-check
/**
 * Club accent colours that pass WCAG AA on this site's surfaces.
 *
 * A club's own colour is often too light to carry text (sky blues, ambers). The accent keeps the
 * club's hue and darkens it towards the site's ink colour until it reaches 4.5:1 against the page
 * background, so it can be used for text, links, focus rings and filled buttons (with white text).
 * The raw club colours are only used for decoration that carries no information (the kit stripe).
 */

/** Page background and body text; keep in sync with the tokens in index.css. */
export const SURFACE = "#FAFBF8";
export const INK = "#14201B";
/** The site's own accent when no club is picked. */
export const DEFAULT_ACCENT = "#1F5135";

/** @param {string} hex @returns {[number, number, number] | null} */
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {number[]} rgb */
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** WCAG relative luminance. @param {string} hex */
export function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return NaN;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1–21). @param {string} a @param {string} b */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix `hex` towards `toward` by `t` (0–1). @param {string} hex @param {string} toward @param {number} t */
export function mix(hex, toward, t) {
  const a = parseHex(hex);
  const b = parseHex(toward);
  if (!a || !b) return hex;
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
}

/**
 * The closest colour to `hex` (mixing towards INK in small steps) with at least `min` contrast on `bg`.
 * @param {string} hex @param {number} [min] @param {string} [bg]
 */
export function readableOn(hex, min = 4.5, bg = SURFACE) {
  if (!parseHex(hex)) return DEFAULT_ACCENT;
  for (let i = 0; i <= 50; i++) {
    const c = mix(hex, INK, i / 50);
    if (contrast(c, bg) >= min) return c;
  }
  return INK;
}

/**
 * CSS custom properties for a club (or the site default for null):
 *   --accent         text, links, focus rings and button fills; at least 4.5:1 on SURFACE
 *   --accent-ink     text on an --accent fill (white or ink, whichever reads better)
 *   --accent-soft    a pale tint of the accent for backgrounds behind ink text
 *   --kit-1, --kit-2 the club's raw colours, decoration only
 * @param {{ colors: { primary: string, secondary: string } } | null} club
 * @returns {Record<string, string>}
 */
export function accentVars(club) {
  const primary = club?.colors?.primary ?? DEFAULT_ACCENT;
  const secondary = club?.colors?.secondary ?? INK;
  // The accent must also read on its own pale tint (active nav item, picked row), so step darker until both pass.
  let accent = club ? readableOn(primary) : DEFAULT_ACCENT;
  for (let i = 1; i <= 50 && contrast(accent, mix(accent, SURFACE, 0.9)) < 4.5; i++) {
    accent = mix(club ? readableOn(primary) : DEFAULT_ACCENT, INK, i / 50);
  }
  const accentInk = contrast("#FFFFFF", accent) >= contrast(INK, accent) ? "#FFFFFF" : INK;
  return {
    "--accent": accent,
    "--accent-ink": accentInk,
    "--accent-soft": mix(accent, SURFACE, 0.9),
    "--kit-1": parseHex(primary) ? primary : DEFAULT_ACCENT,
    "--kit-2": parseHex(secondary) ? secondary : INK,
  };
}
