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

test("player profile: bio, availability, season figures, recent matches", async ({ page }) => {
  // Reached from the squad list on the club page.
  await page.goto(`./#/club/${RECORDED.club}`);
  const athlete = (await import("./fixtures/athlete.json", { with: { type: "json" } })).default.athlete;
  await page
    .locator("section[aria-labelledby=squad-heading]")
    .getByRole("link", { name: athlete.displayName, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/player/${RECORDED.playerId}$`));
  await expect(page.getByRole("heading", { level: 1, name: athlete.displayName })).toBeVisible();
  await expect(page).toHaveTitle(`${athlete.displayName} · Premier League Hub`);
  const profile = page.locator("section[aria-labelledby=player-heading]");
  await expect(profile.getByText("Shirt number")).toBeVisible();
  await expect(profile.getByText(athlete.citizenship)).toBeVisible();
  // ESPN has no photo for most players: a labelled placeholder, never a guessed image.
  await expect(profile.getByText("No photo from ESPN")).toBeVisible();

  const season = page.locator("section[aria-labelledby=season-heading]");
  await expect(season.getByText("Appearances")).toBeVisible();
  await expect(season.getByText(/^Minutes: Fantasy Premier League/)).toBeVisible();
  await expect(season.getByText(/it is not a zero/)).toBeVisible();

  const recent = page.locator("section[aria-labelledby=recent-heading]");
  await expect(recent.locator("tbody tr").first()).toBeVisible();
  await expect(recent.getByRole("link", { name: /match centre/ }).first()).toHaveAttribute("href", /#\/match\/\d+/);
  await noOverflow(page);
  await axeClean(page);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: athlete.displayName })).toBeVisible();
});

test("compare two players from the same season, with unavailable figures marked", async ({ page }) => {
  await page.goto(`./#/player/${RECORDED.playerId}`);
  await page.getByRole("link", { name: "Compare" }).click();
  await expect(page).toHaveURL(new RegExp(`#/compare\\?a=${RECORDED.playerId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Compare players" })).toBeVisible();

  const roster = (await import("./fixtures/roster.json", { with: { type: "json" } })).default;
  const other = roster.athletes.find((a) => a.id === RECORDED.otherPlayerId);
  await page.getByLabel("Second player").fill(other.lastName);
  await page.getByRole("button", { name: new RegExp(other.displayName) }).click();
  await expect(page).toHaveURL(new RegExp(`b=${RECORDED.otherPlayerId}`));

  const table = page.getByRole("table", { name: /season figures/ });
  await expect(table.getByRole("rowheader", { name: "Goals", exact: true })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: /Minutes played/ })).toBeVisible();
  await expect(page).toHaveTitle(/ v .* · Compare players · Premier League Hub$/);
  await noOverflow(page);
  await axeClean(page);

  // A player id that isn't in any squad says so instead of showing nothing.
  await page.goto("./#/compare?a=1&b=2");
  await expect(page.getByText("No player with id 1 in the current Premier League squads.")).toBeVisible();
});

test("statistics: teams, with club and season filters kept in the address", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("link", { name: "Statistics" }).click();
  await expect(page).toHaveURL(/#\/stats$/);
  await expect(page.getByRole("heading", { level: 1, name: "Statistics" })).toBeVisible();
  await expect(page).toHaveTitle("Statistics · Premier League Hub");
  await expect(page.getByText(/^Competition: Premier League/)).toBeVisible();
  await expect(page.getByRole("img", { name: /^Bar chart: Goals scored/ })).toBeVisible();

  await page.getByLabel("Club", { exact: true }).selectOption("arsenal");
  await expect(page).toHaveURL(/club=arsenal/);
  await expect(page.getByRole("heading", { name: /^Arsenal, \d{4}-\d{2}$/ })).toBeVisible();
  await expect(
    page.getByRole("table", { name: /home and away records/ }).getByRole("rowheader", { name: "Home" }),
  ).toBeVisible();

  await page.getByLabel("Statistic", { exact: true }).selectOption("possession");
  await expect(page).toHaveURL(/metric=possession/);
  await expect(page.getByLabel("Per match")).toHaveCount(0); // a percentage can't be per match
  await page.getByText("Show as a table").click();
  await expect(page.getByRole("table", { name: /Possession, .* ranked/ }).locator("tbody tr")).toHaveCount(20);

  // Last season: clubs promoted since are listed as absent, never shown as zeros.
  const seasons = await page.getByLabel("Season", { exact: true }).locator("option").allTextContents();
  await page.getByLabel("Season", { exact: true }).selectOption({ label: seasons[1] });
  await expect(page).toHaveURL(/season=\d{4}/);
  await expect(page.getByText(new RegExp(`Not in the Premier League in ${seasons[1]}:`))).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Club", { exact: true })).toHaveValue("arsenal");
  await expect(page.getByLabel("Statistic", { exact: true })).toHaveValue("possession");
  await expect(page.getByLabel("Season", { exact: true }).locator("option:checked")).toHaveText(seasons[1]);
  await noOverflow(page);
  await axeClean(page);
});

test("statistics: players table, per 90 and one player's two seasons", async ({ page }) => {
  await page.goto(`./#/stats?view=players`);
  await expect(
    page
      .getByRole("table", { name: /Goals, ranked/ })
      .locator("tbody tr")
      .first(),
  ).toBeVisible();
  await page.getByLabel("Per 90 minutes").check();
  await expect(page).toHaveURL(/per=1/);
  await page.getByLabel("Club", { exact: true }).selectOption(RECORDED.club);
  await page.getByLabel("Player", { exact: true }).selectOption(RECORDED.playerId);
  await expect(page).toHaveURL(new RegExp(`player=${RECORDED.playerId}`));
  const panel = page.getByRole("table", { name: /this season and last/ });
  await expect(panel).toBeVisible();
  // Last season comes from ESPN's core API (recorded): a real number, not "–".
  await expect(
    panel
      .getByRole("row", { name: /^Appearances/ })
      .locator("td")
      .last(),
  ).toHaveText(/^\d+$/);
  await expect(page.getByRole("link", { name: "Compare with another player" })).toHaveAttribute(
    "href",
    `#/compare?a=${RECORDED.playerId}`,
  );
  await page.reload();
  await expect(page.getByLabel("Player", { exact: true })).toHaveValue(RECORDED.playerId);
  await noOverflow(page);
  await axeClean(page);
});

test("statistics: points and position by gameweek, up to four clubs, with a table view", async ({ page }) => {
  await page.goto(`./#/stats?view=progression`);
  const chosen = page.getByRole("list", { name: "Clubs shown" }).getByRole("listitem");
  await expect(chosen).toHaveCount(4); // the current top four when nothing is chosen
  await expect(page.getByRole("img", { name: /^Line chart: league position/ })).toBeVisible();
  await page
    .getByRole("button", { name: /^Remove / })
    .first()
    .click();
  await expect(chosen).toHaveCount(3);
  await expect(page).toHaveURL(/club=[a-z-]+,[a-z-]+,[a-z-]+$/);
  await page.getByLabel("Add a club", { exact: true }).selectOption("hull");
  await expect(chosen).toHaveCount(4);
  await page.getByLabel("Show", { exact: true }).selectOption("points");
  await expect(page.getByRole("img", { name: /^Line chart: points/ })).toBeVisible();
  await page.getByText("Show as a table").click();
  await expect(
    page
      .getByRole("table", { name: /after each gameweek/ })
      .locator("tbody tr")
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/clubs level on all three share a place/)).toBeVisible();
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
  // A player result opens that player's profile.
  await expect(
    page
      .locator("section[aria-labelledby=r-players] li")
      .first()
      .getByRole("link", { name: new RegExp(surname) }),
  ).toHaveAttribute("href", /^#\/player\/\d+$/);
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
