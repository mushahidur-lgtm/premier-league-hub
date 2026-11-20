import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockAll, RECORDED } from "./mock.js";
import { clubBySlug } from "../../src/config/clubs.js";

const axeClean = async (page) => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
};
const noOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

// Every test fails on a console error or uncaught exception, unless it expects one (see the failing-source test).
const consoleErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  consoleErrors.set(page, errors);
  await mockAll(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.annotations.some((a) => a.type === "expects-console-errors")) return;
  expect(consoleErrors.get(page)).toEqual([]);
});

test("home: table, fixtures, stories and club grid", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle(/table, fixtures and news/);
  await expect(page.locator("section[aria-labelledby=table-heading] tbody tr")).toHaveCount(20);
  await expect(page.getByRole("heading", { name: "Fixtures and results" })).toBeVisible();
  await expect(page.locator("section[aria-labelledby=fixtures-heading] li").first()).toBeVisible();
  await expect(page.locator("section[aria-labelledby=news-heading] li").first()).toBeVisible();
  await expect(page.getByText(/Source: ESPN, Premier League table/)).toBeVisible();
  const transfers = page.locator("section[aria-labelledby=transfers-heading] li");
  await expect(transfers.first()).toBeVisible();
  await expect(transfers.first()).toContainText(/Confirmed|Reported/);
  await expect(page.locator("section[aria-labelledby=clubs-heading] li")).toHaveCount(20);
  await noOverflow(page);
  await axeClean(page);
});

test("home dashboard: gameweek selector, filters, form, leaders and key fixtures", async ({ page }) => {
  await page.goto("./");
  const fixtures = page.locator("section[aria-labelledby=fixtures-heading]");
  const gw = fixtures.getByRole("combobox", { name: "Gameweek" });
  // Opens on FPL's next gameweek (the current one is finished in the recording).
  await expect(gw.locator("option:checked")).toHaveText("Gameweek 11 (next)");
  const rows = fixtures.locator("li");
  await expect(rows).toHaveCount(10);
  await expect(fixtures.getByRole("button", { name: /^Upcoming/ })).toHaveText("Upcoming 10");
  // ESPN's scoreboard covers this gameweek, so rows link to the match centre.
  await expect(rows.first().getByRole("link")).toHaveCount(3);

  // The selector fetches the chosen gameweek: a finished one shows FPL's results, unlinked.
  await gw.selectOption({ label: "Gameweek 5" });
  await expect(rows).toHaveCount(10);
  await expect(fixtures.getByRole("button", { name: /^Completed/ })).toHaveText("Completed 10");
  await expect(rows.first()).toContainText(/\d–\d/);
  await expect(fixtures.getByText(/aren’t on ESPN’s scoreboard/)).toBeVisible();
  // A finished gameweek's scores are not labelled live.
  await expect(fixtures.getByText(/^Scores: ESPN/)).not.toContainText("live");
  await fixtures.getByRole("button", { name: "Next gameweek" }).click();
  await expect(gw.locator("option:checked")).toHaveText("Gameweek 6");
  await fixtures.getByRole("button", { name: "Previous gameweek" }).click();
  await fixtures.getByRole("button", { name: "Previous gameweek" }).click();
  await expect(gw.locator("option:checked")).toHaveText("Gameweek 4");

  // Filters.
  await gw.selectOption({ label: "Gameweek 11 (next)" });
  await fixtures.getByRole("button", { name: /^Completed/ }).click();
  await expect(fixtures.getByRole("button", { name: /^Completed/ })).toHaveAttribute("aria-pressed", "true");
  await expect(fixtures.getByText("No completed matches in Gameweek 11.")).toBeVisible();
  await expect(fixtures.getByText(/^Scores: ESPN · live/)).toBeVisible();
  await expect(fixtures.getByText(/Fantasy Premier League, via this site's pipeline · updated/)).toBeVisible();

  // Form column, from FPL's fixture list, with its own source line.
  const table = page.locator("section[aria-labelledby=table-heading]");
  await expect(table.getByRole("columnheader", { name: "Form" })).toBeVisible();
  await expect(table.getByText(/^Form: last five league results/)).toBeVisible();

  const leaders = page.locator("section[aria-labelledby=leaders-heading]");
  await expect(leaders.getByRole("table", { name: "Goals" }).locator("tbody tr").first()).toBeVisible();
  await expect(leaders.getByRole("table", { name: "Assists" }).locator("tbody tr").first()).toBeVisible();
  await expect(page.locator("section[aria-labelledby=key-fixtures-heading]")).toContainText(
    /meeting: \d+(st|nd|rd|th) v|No top-six or bottom-four meetings/,
  );
  await noOverflow(page);
  await axeClean(page);
});

test("without league.json the fixtures fall back to ESPN's scoreboard, and the league sections say what failed", async ({
  page,
}) => {
  test.info().annotations.push({ type: "expects-console-errors" }); // the deliberate HTTP 500
  await page.route(/\/data\/league\.json/, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"test"}' }),
  );
  await page.goto("./");
  const fixtures = page.locator("section[aria-labelledby=fixtures-heading]");
  await expect(fixtures.locator("li").first()).toBeVisible();
  await expect(fixtures.getByText(/Source: ESPN, Premier League scoreboard/)).toBeVisible();
  await expect(fixtures.getByRole("combobox", { name: "Gameweek" })).toHaveCount(0);
  for (const id of ["leaders-heading", "key-fixtures-heading"]) {
    const sec = page.locator(`section[aria-labelledby=${id}]`);
    await expect(sec.getByRole("alert")).toContainText("Couldn’t load this section");
    await expect(sec.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(sec.getByText(/Source: Fantasy Premier League and ESPN/)).toBeVisible();
  }
  // The table still renders, just without the form column.
  await expect(page.locator("section[aria-labelledby=table-heading] tbody tr")).toHaveCount(20);
  await expect(page.getByRole("columnheader", { name: "Form" })).toHaveCount(0);
});

test("club page: matches, position, form, news and squad", async ({ page }) => {
  await page.goto(`./#/club/${RECORDED.club}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/ · Premier League Hub$/);
  await expect(page.getByText("Next match", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("list", { name: /League form/ })).toBeVisible();
  await expect(page.locator("section[aria-labelledby=squad-heading] li").first()).toBeVisible();
  await expect(page.getByText(/Its list can lag club news/)).toBeVisible();
  await expect(page.getByText(/all fit/i)).toHaveCount(0);
  // Rule 3: the fixture's injury story names a player ESPN lists as fine, so the squad shows the
  // report on that player and the summary line says so.
  const squad = page.locator("section[aria-labelledby=squad-heading]");
  await expect(squad.getByRole("link", { name: /Reported injured · BBC Sport · 2h ago/ })).toBeVisible();
  await expect(squad.getByText(/Recent news reports a player ESPN doesn’t list as injured or doubtful/)).toBeVisible();
  await noOverflow(page);
  await axeClean(page);
});

test("match centre: score, events, stats and line-ups", async ({ page }) => {
  await page.goto(`./#/match/${RECORDED.eventId}`);
  await expect(page).toHaveTitle(/ v .* · Premier League Hub$/);
  await expect(page.getByRole("heading", { name: "Key events" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Team statistics" })).toBeVisible();
  await expect(page.getByRole("img", { name: /line-up on the pitch/ })).toHaveCount(2);
  await noOverflow(page);
  await axeClean(page);
  // Second visit: chunk loaded and summary cached, so the page renders at once; the title must still be the match.
  const title = await page.title();
  await page.goto("./#/");
  await expect(page).toHaveTitle(/table, fixtures and news/);
  await page.goto(`./#/match/${RECORDED.eventId}`);
  await expect(page.getByRole("heading", { name: "Key events" })).toBeVisible();
  await expect(page).toHaveTitle(title);
});

test("search finds players and keeps the query in the address", async ({ page }) => {
  await page.goto("./#/search");
  const box = page.getByRole("searchbox", { name: "Clubs, players and stories" });
  // A surname from the recorded squad, so the test follows whatever was recorded.
  const fixtures = await import("./fixtures/roster.json", { with: { type: "json" } });
  const surname = fixtures.default.athletes.find((a) => a.lastName && a.lastName.length > 3).lastName;
  await box.fill(surname);
  await expect(page.locator("section[aria-labelledby=r-players] li").first()).toContainText(surname);
  await expect(page).toHaveURL(new RegExp(`#/search\\?q=${encodeURIComponent(surname)}`));
  await page.reload();
  await expect(box).toHaveValue(surname);
  await noOverflow(page);
  await axeClean(page);
});

test("picking a club leads the home page with it, re-themes at once and survives a reload", async ({ page }) => {
  await page.goto("./");
  const accent = () =>
    page.evaluate(() => getComputedStyle(document.querySelector("#main").parentElement).getPropertyValue("--accent"));
  const before = await accent();
  await page.getByRole("combobox", { name: /club/i }).selectOption(RECORDED.club);
  await expect(page.locator("#my-club-heading")).toBeVisible();
  expect(await accent()).not.toBe(before);
  const lead = page.locator("section[aria-labelledby=my-club-heading]");
  await expect(lead.getByText("Form, last five league games")).toBeVisible();
  await expect(lead.getByText(/pts (clear of|behind)|level on points/)).toBeVisible();
  await page.reload();
  await expect(page.locator("#my-club-heading")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /club/i })).toHaveValue(RECORDED.club);
});

test("unknown routes and clubs show a not-found page", async ({ page }) => {
  await page.goto("./#/nowhere");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto("./#/club/not-a-club");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("skip link moves focus to the content", async ({ page }) => {
  await page.goto("./");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("every route survives a reload, content and title", async ({ page }) => {
  const routes = [
    [
      "#/",
      /table, fixtures and news/,
      () => expect(page.locator("section[aria-labelledby=table-heading] tbody tr")).toHaveCount(20),
    ],
    [
      `#/club/${RECORDED.club}`,
      new RegExp(`^${clubBySlug(RECORDED.club).name} · `),
      () => expect(page.getByRole("heading", { level: 1 })).toBeVisible(),
    ],
    [
      `#/match/${RECORDED.eventId}`,
      / v .* · /,
      () => expect(page.getByRole("heading", { name: "Key events" })).toBeVisible(),
    ],
    ["#/search?q=arsenal", /^Search: arsenal · /, () => expect(page.getByRole("searchbox")).toHaveValue("arsenal")],
    [
      "#/nowhere",
      /^Page not found · /,
      () => expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible(),
    ],
  ];
  for (const [hash, title, check] of routes) {
    await page.goto(`./${hash}`);
    await check();
    await expect(page).toHaveTitle(title);
    await page.reload();
    await check();
    await expect(page).toHaveTitle(title);
  }
});

test("a failing source shows an error with a retry, and the rest of the page still works", async ({ page }) => {
  test.info().annotations.push({ type: "expects-console-errors" }); // the deliberate HTTP 500
  await page.unrouteAll();
  await mockAll(page, { fail: /\/standings/ });
  await page.goto("./");
  const table = page.locator("section[aria-labelledby=table-heading]");
  await expect(table.getByRole("alert")).toContainText("Couldn’t load this section");
  await expect(table.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.locator("section[aria-labelledby=news-heading] li").first()).toBeVisible();
});
