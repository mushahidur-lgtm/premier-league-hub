// @ts-check
/**
 * Player availability from ESPN's roster record.
 *
 * "No injury on the list" is not the same as "fit": ESPN's roster feed carries injury reports only
 * when someone has entered them, and can lag the club. So absence of a report is its own state
 * ("No injury reported"), and a record we can't read is "Unknown". Nothing is ever promoted to
 * "Available".
 *
 *   injured / doubtful / suspended   an ESPN injury or status record says so
 *   clear                            ESPN supplied an (empty) injury list: "No injury reported"
 *   unknown                          the injury data is missing or can't be interpreted
 */
import { date } from "./validate.js";

export const AVAILABILITY = {
  injured: { label: "Injured" },
  doubtful: { label: "Doubtful" },
  suspended: { label: "Suspended" },
  clear: { label: "No injury reported" },
  unknown: { label: "Unknown" },
};

/** The states that mean "ESPN reports this player as not fully available". */
export const REPORTED_ABSENT = new Set(["injured", "doubtful", "suspended"]);
export const isReportedAbsent = (p) => REPORTED_ABSENT.has(p?.availability?.key);

const SUSPENDED = /suspen[ds]/;
const DOUBTFUL = /questionable|doubt|day-to-day|probable/;
const text = (v) => (typeof v === "string" ? v : "");

/** Reads one injury entry; null when it carries no readable information at all. */
function readEntry(inj) {
  if (inj === null || typeof inj !== "object") return null;
  const status = text(inj.status).trim();
  const typeText = text(inj.type?.description).trim() || text(inj.type?.name).trim();
  const detail = text(inj.details?.type).trim();
  const raw = `${status} ${typeText} ${detail}`.toLowerCase().trim();
  if (!raw) return null;
  return { raw, detail: detail || status || null, updated: date(inj.date) };
}

export function availabilityOf(athlete) {
  const a = athlete !== null && typeof athlete === "object" ? athlete : {};
  const statusName = text(a.status?.name);

  const list = a.injuries;
  if (Array.isArray(list) && list.length) {
    const entries = list.map(readEntry).filter((e) => e !== null);
    if (!entries.length) {
      // Something was reported but we can't tell what: never read that as "no injury".
      return {
        key: "unknown",
        label: AVAILABILITY.unknown.label,
        detail: "injury record unreadable",
        source: "ESPN injury report",
        updated: null,
      };
    }
    // A suspension outranks an injury, which outranks a doubt, whatever order ESPN listed them in.
    const pick = entries.find((e) => SUSPENDED.test(e.raw)) ?? entries.find((e) => !DOUBTFUL.test(e.raw)) ?? entries[0];
    const base = { source: "ESPN injury report", updated: pick.updated };
    if (SUSPENDED.test(pick.raw)) return { ...base, key: "suspended", label: AVAILABILITY.suspended.label };
    if (DOUBTFUL.test(pick.raw))
      return { ...base, key: "doubtful", label: AVAILABILITY.doubtful.label, detail: pick.detail };
    return { ...base, key: "injured", label: AVAILABILITY.injured.label, detail: pick.detail || "Injury" };
  }

  // No injury record: ESPN's player status can still say suspended / injured.
  if (a.suspended === true || SUSPENDED.test(statusName.toLowerCase()))
    return { key: "suspended", label: AVAILABILITY.suspended.label, source: "ESPN", updated: null };
  if (/injur/i.test(statusName))
    return { key: "injured", label: AVAILABILITY.injured.label, detail: statusName, source: "ESPN", updated: null };

  if (Array.isArray(list)) {
    // ESPN supplied an injury list and it is empty. That is all we know.
    return {
      key: "clear",
      label: AVAILABILITY.clear.label,
      source: "ESPN: no injury on the list; can lag club news",
      updated: null,
    };
  }
  return {
    key: "unknown",
    label: AVAILABILITY.unknown.label,
    source: "ESPN supplied no injury data for this player",
    updated: null,
  };
}

/** Counts and lists for UI summaries. */
export function summarizeAvailability(players = []) {
  const counts = { injured: 0, doubtful: 0, suspended: 0, clear: 0, unknown: 0 };
  const absent = [];
  for (const p of players) {
    const k = p?.availability?.key in counts ? p.availability.key : "unknown";
    counts[k]++;
    if (REPORTED_ABSENT.has(k)) absent.push(p);
  }
  return { counts, absent, total: players.length };
}
