import { afterEach, describe, expect, it } from "vitest";
import { fmtDay, fmtKick, fmtTime, relDay, sameDay, timeAgo } from "../../src/lib/format.js";
import { parseDate } from "../../scripts/lib/feed-parser.mjs";
import { heroMode } from "../../src/lib/hero.js";

/**
 * The viewer's timezone drives every displayed time. Node re-reads process.env.TZ at runtime, so each
 * test can pretend to be in a different zone. Expected values are produced with an explicit
 * `timeZone` (a different mechanism from the process default) so the two are independent.
 */
const ZONES = ["UTC", "Europe/London", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Auckland"];
const inZone = (tz, fn) => {
  process.env.TZ = tz;
  return fn();
};
afterEach(() => {
  process.env.TZ = "UTC";
});

const expectedTime = (d, tz) =>
  new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
const expectedDay = (d, tz) =>
  new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(d);

describe("kick-off times follow the viewer's timezone", () => {
  const kickoff = new Date("2025-01-10T23:30:00Z");
  it.each(ZONES)("%s: time and date are the local wall-clock values", (tz) => {
    inZone(tz, () => {
      expect(fmtTime(kickoff)).toBe(expectedTime(kickoff, tz));
      expect(fmtDay(kickoff)).toBe(expectedDay(kickoff, tz));
      expect(fmtKick(kickoff)).toContain(expectedDay(kickoff, tz).split(" ")[0]);
    });
  });
  it("the same instant lands on different calendar days in different zones", () => {
    const day = (tz) => inZone(tz, () => new Date(kickoff).getDate());
    expect(day("America/Los_Angeles")).toBe(10);
    expect(day("UTC")).toBe(10);
    expect(day("Asia/Tokyo")).toBe(11);
    expect(day("Pacific/Auckland")).toBe(11);
  });
  it("daylight saving: a summer kick-off in London is shown in BST, a winter one in GMT", () => {
    inZone("Europe/London", () => {
      expect(expectedTime(new Date("2025-07-01T18:30:00Z"), "Europe/London")).toMatch(/7:30/);
      expect(fmtTime(new Date("2025-07-01T18:30:00Z"))).toMatch(/7:30|19:30/);
      expect(fmtTime(new Date("2025-01-01T18:30:00Z"))).toMatch(/6:30|18:30/);
    });
  });
  it("invalid dates render as an empty string in every zone, never 'Invalid Date'", () => {
    for (const tz of ZONES)
      inZone(tz, () => {
        for (const bad of [null, undefined, "", "nope", new Date("x")]) {
          expect(fmtTime(bad)).toBe("");
          expect(fmtDay(bad)).toBe("");
          expect(fmtKick(bad)).toBe("");
        }
      });
  });
});

describe("'today' is the viewer's today", () => {
  // Kick-off 23:30 UTC on 10 Jan; "now" is 40 minutes later.
  const match = new Date("2025-01-10T23:30:00Z");
  const now = new Date("2025-01-11T00:10:00Z");
  const expected = {
    UTC: false,
    "Europe/London": false,
    "Asia/Tokyo": true,
    "America/Los_Angeles": true,
    "Pacific/Auckland": true,
  };
  it.each(Object.entries(expected))("%s: sameDay = %s", (tz, same) => {
    inZone(tz, () => expect(sameDay(match, now)).toBe(same));
  });
  it("relDay says Today / Tomorrow in the viewer's zone", () => {
    inZone("Asia/Tokyo", () => {
      expect(relDay(match, now)).toBe("Today");
      expect(relDay(new Date("2025-01-11T23:30:00Z"), now)).toBe("Tomorrow"); // 12 Jan 08:30 in Tokyo
    });
    inZone("UTC", () => expect(relDay(match, now)).not.toBe("Today"));
  });
  it("hero full-time window is a duration, so it does not depend on the zone", () => {
    const data = {
      fixtures: [],
      results: [{ id: "1", state: "post", friendly: false, postponed: false, date: match, home: {}, away: {} }],
    };
    for (const tz of ZONES)
      inZone(tz, () => expect(heroMode(data, match.getTime() + 2 * 3600e3).mode).toBe("fulltime"));
  });
});

describe("feed timestamps are absolute", () => {
  it("the pipeline parses feed dates identically in every zone (zone-less = UTC)", () => {
    for (const tz of ZONES)
      inZone(tz, () => {
        expect(parseDate("2025-01-10 08:30:00")).toBe("2025-01-10T08:30:00.000Z");
        expect(parseDate("Fri, 10 Jan 2025 08:30:00 GMT")).toBe("2025-01-10T08:30:00.000Z");
        expect(parseDate("2025-01-10T09:30:00+01:00")).toBe("2025-01-10T08:30:00.000Z");
      });
  });
  it("'x ago' is a duration and doesn't change with the zone", () => {
    const now = Date.UTC(2025, 0, 10, 12);
    for (const tz of ZONES)
      inZone(tz, () => {
        expect(timeAgo(new Date(now - 3 * 3600e3), now)).toBe("3h ago");
        expect(timeAgo(new Date(now - 5 * 60e3), now)).toBe("5m ago");
      });
  });
});
