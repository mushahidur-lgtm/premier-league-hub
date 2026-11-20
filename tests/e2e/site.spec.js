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
  await page.getByRole("combobox").selectOption(RECORDED.club);
  await expect(page.locator("#my-club-heading")).toBeVisible();
  expect(await accent()).not.toBe(before);
  await page.reload();
  await expect(page.locator("#my-club-heading")).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveValue(RECORDED.club);
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
