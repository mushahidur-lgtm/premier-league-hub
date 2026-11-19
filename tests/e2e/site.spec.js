import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockAll, RECORDED } from "./mock.js";

const axeClean = async (page) => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
};
const noOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

test.beforeEach(async ({ page }) => {
  await mockAll(page);
});

test("home: table, fixtures, stories and club grid", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle(/table, fixtures and news/);
  await expect(page.locator("section[aria-labelledby=table-heading] tbody tr")).toHaveCount(20);
  await expect(page.getByRole("heading", { name: "Fixtures and results" })).toBeVisible();
  await expect(page.locator("section[aria-labelledby=fixtures-heading] li").first()).toBeVisible();
  await expect(page.locator("section[aria-labelledby=news-heading] li").first()).toBeVisible();
  await expect(page.getByText(/Source: ESPN, Premier League table/)).toBeVisible();
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

test("a failing source shows an error with a retry, and the rest of the page still works", async ({ page }) => {
  await page.unrouteAll();
  await mockAll(page, { fail: /\/standings/ });
  await page.goto("./");
  const table = page.locator("section[aria-labelledby=table-heading]");
  await expect(table.getByRole("alert")).toContainText("Couldn’t load this section");
  await expect(table.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.locator("section[aria-labelledby=news-heading] li").first()).toBeVisible();
});
