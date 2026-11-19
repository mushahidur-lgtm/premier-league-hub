import { describe, expect, it } from "vitest";
import { AVAILABILITY, availabilityOf, isReportedAbsent, summarizeAvailability } from "../../src/lib/availability.js";
import { parseRoster } from "../../src/lib/parsers.js";

const A = (over) => availabilityOf({ id: "1", displayName: "P", ...over });

describe("explicit availability states", () => {
  it("injured: an injury record with a status or type", () => {
    expect(
      A({ injuries: [{ status: "Out", details: { type: "Hamstring" }, date: "2025-01-02T10:00:00Z" }] }),
    ).toMatchObject({ key: "injured", label: "Injured", detail: "Hamstring" });
    expect(A({ injuries: [{ type: { description: "Knee Injury" } }] }).key).toBe("injured");
    expect(A({ injuries: [{ status: "Out" }] }).detail).toBe("Out");
  });
  it.each(["Day-To-Day", "Questionable", "Doubtful", "Probable"])("doubtful: %s", (status) => {
    expect(A({ injuries: [{ status }] })).toMatchObject({ key: "doubtful", label: "Doubtful" });
  });
  it.each([
    ["injury record", { injuries: [{ status: "Suspension" }] }],
    ["injury record (suspended)", { injuries: [{ type: { description: "Suspended" } }] }],
    ["athlete.suspended flag", { suspended: true, injuries: [] }],
    ["athlete status name", { status: { name: "Suspended" }, injuries: [] }],
    ["no injury list but suspended flag", { suspended: true }],
  ])("suspended: %s", (_n, athlete) => {
    expect(A(athlete)).toMatchObject({ key: "suspended", label: "Suspended" });
  });
  it("an injured status without an injury record is still injured", () => {
    expect(A({ status: { name: "Injured" } })).toMatchObject({ key: "injured", detail: "Injured" });
  });
  it("clear ('No injury reported'): ESPN supplied an empty injury list, and nothing more is claimed", () => {
    const a = A({ injuries: [] });
    expect(a.key).toBe("clear");
    expect(a.label).toBe("No injury reported");
    expect(a.label).not.toMatch(/available|fit/i);
    expect(a.source).toMatch(/can lag/);
  });
});

describe("unknown: missing or malformed injury information", () => {
  it.each([
    ["no injuries field", {}],
    ["injuries null", { injuries: null }],
    ["injuries a string", { injuries: "none" }],
    ["injuries an object", { injuries: { status: "Out" } }],
    ["injuries a number", { injuries: 3 }],
  ])("%s", (_n, athlete) => {
    const a = A(athlete);
    expect(a.key).toBe("unknown");
    expect(a.label).toBe("Unknown");
  });
  it.each([
    ["null entry", [null]],
    ["empty object entry", [{}]],
    ["blank strings", [{ status: "  ", type: { description: "" }, details: { type: "" } }]],
    ["non-string fields", [{ status: 5, type: { description: {} }, details: { type: [] } }]],
    ["primitive entries", ["Out", 7]],
  ])("an injury record that can't be read is unknown, never 'no injury': %s", (_n, injuries) => {
    expect(A({ injuries })).toMatchObject({ key: "unknown", detail: "injury record unreadable" });
  });
  it("unreadable entries are ignored when a readable one exists", () => {
    expect(A({ injuries: [{}, null, { status: "Out" }] }).key).toBe("injured");
  });
  it("a non-object athlete is unknown", () => {
    for (const bad of [null, undefined, "x", 5, []]) expect(availabilityOf(bad).key).toBe("unknown");
  });
});

describe("precedence and dates", () => {
  it("suspension outranks injury, injury outranks a doubt, whatever order ESPN lists them", () => {
    expect(A({ injuries: [{ status: "Out" }, { status: "Suspension" }] }).key).toBe("suspended");
    expect(A({ injuries: [{ status: "Questionable" }, { status: "Out" }] }).key).toBe("injured");
    expect(A({ injuries: [{ status: "Questionable" }] }).key).toBe("doubtful");
  });
  it("keeps a valid report date and nulls an invalid one", () => {
    expect(A({ injuries: [{ status: "Out", date: "2025-01-02T10:00:00Z" }] }).updated).toBeInstanceOf(Date);
    expect(A({ injuries: [{ status: "Out", date: "garbage" }] }).updated).toBeNull();
    expect(A({ injuries: [{ status: "Out" }] }).updated).toBeNull();
  });
  it("never produces an 'available' state for any input", () => {
    const inputs = [
      undefined,
      null,
      {},
      { injuries: [] },
      { injuries: [{}] },
      { injuries: [{ status: "Out" }] },
      { status: { name: "Active" } },
      { injuries: "x" },
    ];
    for (const i of inputs) expect(Object.keys(AVAILABILITY)).toContain(availabilityOf(i).key);
    expect(Object.keys(AVAILABILITY)).not.toContain("available");
  });
});

describe("summaries and roster integration", () => {
  const players = [
    { availability: { key: "injured" } },
    { availability: { key: "doubtful" } },
    { availability: { key: "suspended" } },
    { availability: { key: "clear" } },
    { availability: { key: "clear" } },
    { availability: { key: "unknown" } },
    {},
    null,
  ];
  it("counts every state and lists only reported absences", () => {
    const s = summarizeAvailability(players);
    expect(s.counts).toEqual({ injured: 1, doubtful: 1, suspended: 1, clear: 2, unknown: 3 });
    expect(s.absent).toHaveLength(3);
    expect(s.total).toBe(8);
    expect(isReportedAbsent({ availability: { key: "clear" } })).toBe(false);
    expect(isReportedAbsent({ availability: { key: "unknown" } })).toBe(false);
    expect(isReportedAbsent({ availability: { key: "injured" } })).toBe(true);
    expect(isReportedAbsent(null)).toBe(false);
  });
  it("parseRoster attaches the right state to each player", () => {
    const { players: ps } = parseRoster({
      athletes: [
        { id: "1", displayName: "Hurt", position: { abbreviation: "D" }, injuries: [{ status: "Out" }] },
        { id: "2", displayName: "Fine", position: { abbreviation: "M" }, injuries: [] },
        { id: "3", displayName: "Nodata", position: { abbreviation: "F" } },
      ],
    });
    expect(Object.fromEntries(ps.map((p) => [p.name, p.availability.key]))).toEqual({
      Hurt: "injured",
      Fine: "clear",
      Nodata: "unknown",
    });
  });
});
