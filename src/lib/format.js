// @ts-check
/** Date / time formatting in the viewer's own timezone. */

export const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const validDate = (d) => (d instanceof Date ? !Number.isNaN(d.getTime()) : false);
export const fmtDate = (d, opts) => {
  if (!d) return "";
  const date = validDate(d) ? d : new Date(d);
  return validDate(date) ? new Intl.DateTimeFormat(undefined, opts).format(date) : "";
};
export const fmtKick = (d) =>
  fmtDate(d, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtDay = (d) => fmtDate(d, { weekday: "short", day: "numeric", month: "short" });
export const fmtLongDay = (d) => fmtDate(d, { weekday: "long", day: "numeric", month: "long" });
export const fmtTime = (d) => fmtDate(d, { hour: "2-digit", minute: "2-digit" });
export const fmtFull = (d) => fmtDate(d, { dateStyle: "medium", timeStyle: "short" });
export const tzShort = (d) =>
  new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(d ?? new Date())
    .find((p) => p.type === "timeZoneName")?.value ?? "";

export function timeAgo(input, now = Date.now()) {
  if (!input) return "";
  // Dates restored from storage arrive as ISO strings.
  const d = validDate(input) ? input : new Date(input);
  if (!validDate(d)) return "";
  const s = Math.round((now - d.getTime()) / 1000);
  if (s < 0) return "just now";
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return days < 7 ? `${days}d ago` : fmtDay(d);
}

export const sameDay = (a, b) =>
  a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today", "Tomorrow", or a short date. */
export function relDay(d, now = new Date()) {
  if (sameDay(d, now)) return "Today";
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  if (sameDay(d, t)) return "Tomorrow";
  return fmtDay(d);
}

export const ordinal = (n) =>
  n == null ? "–" : n + (["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? "th");
export const signed = (n) => (n == null ? "–" : n > 0 ? `+${n}` : String(n));

/**
 * A date of birth written out ("14 January 1999" or "January 14, 1999" by locale), read in UTC so it never
 * shifts a day with the viewer's timezone.
 * @param {Date | null | undefined} d
 */
export const fmtBirthDate = (d) =>
  d ? fmtDate(d, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;
