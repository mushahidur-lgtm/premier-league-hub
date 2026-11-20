// Answers every request the site makes from recorded fixtures, and pins the clock to the time they
// were recorded, so countdowns, "updated 3h ago" and news staleness behave the same on any day.
import { readFileSync } from "node:fs";

const dir = new URL("./fixtures/", import.meta.url);
const load = (name) => readFileSync(new URL(name, dir), "utf8");
export const RECORDED = JSON.parse(load("recorded.json"));

// 1×1 transparent PNG for crests, so no request leaves the machine.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const json = (body, status = 200) => ({ status, contentType: "application/json", body });

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ fail?: RegExp }} [opts] requests matching `fail` get HTTP 500
 */
export async function mockAll(page, { fail } = {}) {
  await page.clock.install({ time: new Date(RECORDED.recordedAt) });
  await page.route(
    (url) => url.hostname !== "localhost",
    (route) => {
      const url = route.request().url();
      if (fail?.test(url)) return route.fulfill(json('{"error":"test"}', 500));
      if (/espncdn\.com/.test(url)) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      if (/\/standings/.test(url)) return route.fulfill(json(load("standings.json")));
      if (/\/scoreboard/.test(url)) return route.fulfill(json(load("scoreboard.json")));
      if (/\/summary\?event=/.test(url)) {
        return url.includes(RECORDED.eventId)
          ? route.fulfill(json(load("summary.json")))
          : route.fulfill(json("{}", 404));
      }
      const athlete = /\/athletes\/(\d+)(\/gamelog)?$/.exec(url);
      if (athlete) {
        if (athlete[1] !== RECORDED.playerId) return route.fulfill(json("{}", 404));
        return route.fulfill(json(load(athlete[2] ? "gamelog.json" : "athlete.json")));
      }
      const team = url.match(/\/teams\/(\d+)\/(schedule|roster)/);
      if (team) {
        const [, id, kind] = team;
        if (id !== RECORDED.espnId) return route.fulfill(json(kind === "roster" ? '{"athletes":[]}' : '{"events":[]}'));
        if (kind === "roster") return route.fulfill(json(load("roster.json")));
        return route.fulfill(json(load(url.includes("fixture=true") ? "schedule-fixtures.json" : "schedule.json")));
      }
      return route.abort();
    },
  );
  await page.route(/\/data\/(news|meta|league)\.json/, (route) =>
    route.fulfill(json(load(/(news|meta|league)\.json/.exec(route.request().url())[0]))),
  );
}
