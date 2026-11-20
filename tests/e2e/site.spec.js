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
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Team statistics" })).toBeVisible();
  await expect(page.getByRole("img", { name: /line-up on the pitch/ })).toHaveCount(2);
  await noOverflow(page);
  await axeClean(page);
  // Second visit: chunk loaded and summary cached, so the page renders at once; the title must still be the match.
  const title = await page.title();
  await page.goto("./#/");
  await expect(page).toHaveTitle(/table, fixtures and news/);
  await page.goto(`./#/match/${RECORDED.eventId}`);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page).toHaveTitle(title);
});

test("match centre: goals by side, timeline detail, head-to-head and related news", async ({ page }) => {
  await page.goto(`./#/match/${RECORDED.eventId}`);
  // A finished match says so, and isn't labelled live.
  await expect(page.getByText("Final: ESPN’s record of the finished match.")).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
  const goals = page.locator("section[aria-labelledby=goals-heading]");
  await expect(goals.getByRole("heading", { level: 3 })).toHaveCount(2);
  await expect(goals).toContainText("Goals");
  await expect(goals).toContainText("Substitutions");
  // Timeline: key events by default, the whole commentary on request.
  const timeline = page.locator("section[aria-labelledby=events-heading]");
  const keyButton = timeline.getByRole("button", { name: "Key events" });
  await expect(keyButton).toHaveAttribute("aria-pressed", "true");
  const keyCount = await timeline.getByRole("list", { name: "Key events" }).locator("li").count();
  await timeline.getByRole("button", { name: /^Full commentary/ }).click();
  const all = timeline.getByRole("list", { name: "Full commentary" }).locator("li");
  await expect.poll(() => all.count()).toBeGreaterThan(keyCount);
  await expect(timeline.getByText(/Shot on target|Corner|Foul/).first()).toBeAttached();
  // Possession, shots and shots on target compared, numbers stated for screen readers.
  await expect(
    page
      .locator("section[aria-labelledby=stats-heading]")
      .getByText(/^Possession/)
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/ESPN publishes one formation per team/)).toBeVisible();
  // Head-to-head: earlier meetings, competition named, linked to their match centre; source and "not live".
  const h2h = page.locator("section[aria-labelledby=h2h-heading]");
  await expect(h2h.getByText(/^Last \d+ meetings?:/)).toBeVisible();
  await expect(h2h.getByRole("link").first()).toHaveAttribute("href", /#\/match\/\d+/);
  await expect(h2h.getByText(/FA Cup/).first()).toBeVisible();
  await expect(h2h.getByText(/past results, not live/)).toBeVisible();
  // Related news from this site's feeds: none in the fixture's 14 days for these clubs, and it says so.
  const news = page.locator("section[aria-labelledby=news-heading]");
  await expect(news.getByText(/No stories about these clubs around this match/)).toBeVisible();
  await expect(news.getByText(/^Source: /)).toBeVisible();
  await noOverflow(page);
  await axeClean(page);
});

test("match centre: a match in play is labelled live and fetched again every minute", async ({ page }) => {
  const raw = (await import("./fixtures/summary.json", { with: { type: "json" } })).default;
  const inPlay = structuredClone(raw);
  const type = inPlay.header.competitions[0].status.type;
  Object.assign(type, { state: "in", completed: false, name: "STATUS_SECOND_HALF", detail: "60'" });
  let requests = 0;
  await page.route(/\/summary\?event=/, (route) => {
    requests++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(inPlay) });
  });
  await page.goto(`./#/match/${RECORDED.eventId}`);
  await expect(page.getByTitle("Live data from ESPN")).toBeVisible();
  await expect(page.getByText(/fetched from ESPN again every minute while the match is in play/)).toBeVisible();
  const before = requests;
  await page.clock.runFor(61_000);
  await expect.poll(() => requests).toBeGreaterThan(before);
  // The head-to-head is labelled as past results, not live.
  await expect(page.getByText(/past results, not live/)).toBeVisible();
  await axeClean(page);
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
  // The count is announced once typing settles; the clear button empties the box and keeps focus there.
  await expect(page.getByRole("status").filter({ hasText: /results? for/ })).toBeAttached();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  await expect(page.getByRole("link", { name: /^Search/ })).toHaveAttribute("aria-current", "page");
  await noOverflow(page);
  await axeClean(page);
});

test("keyboard: / opens search from anywhere, but never while typing in a field", async ({ page }) => {
  await page.goto(`./#/stats`);
  await expect(page.getByRole("link", { name: "Statistics" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("/");
  await expect(page).toHaveURL(/#\/search$/);
  const box = page.getByRole("searchbox", { name: "Clubs, players and stories" });
  await expect(box).toBeFocused();
  await box.fill("a/b");
  await expect(box).toHaveValue("a/b");
  await page.goto("./#/fpl?view=compare");
  await page.getByLabel("Player 1", { exact: true }).fill("x/");
  await expect(page).toHaveURL(/#\/fpl/);
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

test("FPL players: filters and sort kept in the address, fixtures with difficulty", async ({ page }) => {
  await page.goto("./#/fpl");
  await expect(page).toHaveTitle(/^Fantasy Premier League · /);
  const table = page.getByRole("table", { name: /FPL players sorted by/ });
  await expect(table.locator("tbody tr").first()).toBeVisible();
  await expect(page.getByText(/Gameweek \d+ \(FPL\)/).first()).toBeVisible();
  await page.getByLabel("Position").selectOption("DEF");
  await page.getByLabel("Sort by").selectOption("fixtures");
  await expect(page).toHaveURL(/pos=DEF/);
  await expect(page).toHaveURL(/sort=fixtures/);
  // Every listed player is a defender; every fixture chip names its difficulty.
  await expect(table.locator("tbody tr").first()).toContainText("DEF");
  await expect(table.getByText(/difficulty [1-5]/).first()).toBeAttached();
  await page.reload();
  await expect(page.getByLabel("Position")).toHaveValue("DEF");
  await expect(page.getByLabel("Sort by")).toHaveValue("fixtures");
  await expect(page.getByText(/Source: Fantasy Premier League public data/)).toBeVisible();
  await noOverflow(page);
  await axeClean(page);
});

test("FPL transfer assistant: player out, budget, affordable alternatives, compare", async ({ page }) => {
  await page.goto("./#/fpl?pos=MID");
  const first = page
    .getByRole("table", { name: /FPL players sorted by/ })
    .locator("tbody tr")
    .first();
  await first.getByRole("link", { name: /^Replace/ }).click();
  await expect(page).toHaveURL(/view=assistant/);
  await expect(page).toHaveURL(/out=\d+/);
  await expect(page).toHaveTitle(/^Transfer assistant · /);
  // Typed key by key: each keystroke that reads as a price updates the address, and focus must stay put.
  const bank = page.getByLabel("Money in the bank (£m)");
  await bank.pressSequentially("1.5");
  await expect(page).toHaveURL(/bank=15/);
  await expect(bank).toHaveValue("1.5");
  await expect(bank).toBeFocused();
  const budgetLine = page.getByText(/to spend$/);
  await expect(budgetLine).toContainText("+ bank £1.5m");
  const total = Number((await budgetLine.locator("strong").last().textContent()).replace(/[£m]/g, ""));
  const results = page.getByRole("table", { name: /Possible replacements for/ });
  await expect(results.locator("tbody tr").first()).toBeVisible();
  // All midfielders, none dearer than the budget.
  const prices = await results.locator("tbody tr td:nth-child(2)").allTextContents();
  expect(prices.length).toBeGreaterThan(0);
  for (const p of prices) expect(Number(p.replace(/[£m]/g, ""))).toBeLessThanOrEqual(total);
  await expect(results.locator("tbody tr th")).toContainText(Array(prices.length).fill("MID"));
  await expect(page.getByText(/at most 3 players from one club/)).toBeVisible();
  await noOverflow(page);
  await axeClean(page);
  // A price paid lower than today's: FPL's selling price is below the current price.
  await page.getByLabel("Price you paid (£m, optional)").fill("4.0");
  await expect(page).toHaveURL(/paid=40/);
  await expect(page.getByText(/FPL pays the price you paid plus 50%/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Money in the bank (£m)")).toHaveValue("1.5");
  await results
    .locator("tbody tr")
    .first()
    .getByRole("link", { name: /^Compare/ })
    .click();
  await expect(page).toHaveURL(/view=compare/);
  await expect(page).toHaveURL(/[?&]b=\d+/);
  const compare = page.getByRole("table", { name: /compared with/ });
  await expect(compare.getByRole("row", { name: /^Total points/ })).toBeVisible();
  await expect(compare.getByRole("row", { name: /^Next 3 gameweeks/ })).toBeVisible();
  await noOverflow(page);
  await axeClean(page);
});

test("FPL compare: pick two players by name", async ({ page }) => {
  await page.goto("./#/fpl?view=compare");
  await expect(page.getByText("Choose two players to compare their FPL figures.")).toBeVisible();
  const picker = page.getByLabel("Player 1", { exact: true });
  await picker.fill("a");
  await expect(page.getByRole("list", { name: /Players matching/ })).toHaveCount(0);
  await picker.fill("ar");
  await page
    .getByRole("list", { name: /Players matching ar/ })
    .getByRole("button")
    .first()
    .click();
  await expect(page).toHaveURL(/a=\d+/);
  await expect(page.getByRole("table", { name: /compared with Player 2/ })).toBeVisible();
  await noOverflow(page);
  await axeClean(page);
});

test("FPL and the news agree (rule 3): a reported injury shows even when FPL has no flag", async ({ page }) => {
  // The fixture's BBC story reports this goalkeeper injured; FPL has no flag on him.
  await page.goto(`./#/fpl?club=${RECORDED.club}&pos=GKP`);
  const row = page.getByRole("table", { name: /FPL players sorted by/ }).getByRole("row", { name: /Arrizabalaga/ });
  await expect(row.getByRole("link", { name: /Reported injured · BBC Sport · 2h ago/ })).toBeVisible();
  await page.goto("./#/fpl?view=compare&a=2");
  const compare = page.getByRole("table", { name: /compared with/ });
  await expect(compare.getByRole("link", { name: /Reported injured · BBC Sport/ })).toBeVisible();
  await expect(compare.getByRole("row", { name: /^FPL availability flag/ })).toContainText("No flag");
  await expect(compare).not.toContainText("Available");
  await axeClean(page);
});

test("without fpl.json the FPL page says so and offers a retry", async ({ page }) => {
  test.info().annotations.push({ type: "expects-console-errors" });
  await page.route(/\/data\/fpl\.json/, (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("./#/fpl");
  await expect(page.getByRole("alert")).toContainText("Couldn’t load this section.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fantasy Premier League", level: 1 })).toBeVisible();
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
      () => expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible(),
    ],
    ["#/search?q=arsenal", /^Search: arsenal · /, () => expect(page.getByRole("searchbox")).toHaveValue("arsenal")],
    [
      "#/fpl?view=assistant&out=1&bank=5",
      /^Transfer assistant · /,
      () => expect(page.getByRole("table", { name: /Possible replacements for/ })).toBeVisible(),
    ],
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

test("dark mode: follows the device, passes AA on every route, and the header button switches it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "colours don't depend on width; one width is enough");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("./#/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const routes = [
    ["#/", () => page.locator("section[aria-labelledby=table-heading] tbody tr").first()],
    [`#/club/${RECORDED.club}`, () => page.getByRole("heading", { level: 1 })],
    [`#/match/${RECORDED.eventId}`, () => page.getByRole("heading", { name: "Timeline" })],
    [`#/player/${RECORDED.playerId}`, () => page.getByRole("heading", { name: "Profile" })],
    [`#/compare?a=${RECORDED.playerId}&b=${RECORDED.otherPlayerId}`, () => page.getByRole("table").first()],
    [`#/stats?club=${RECORDED.club}`, () => page.getByRole("img", { name: /^Bar chart/ })],
    ["#/stats?view=players", () => page.getByRole("table").first()],
    ["#/stats?view=progression", () => page.getByRole("img", { name: /^Line chart/ })],
    ["#/fpl", () => page.getByRole("table").first()],
    ["#/fpl?view=assistant&out=1&bank=15", () => page.getByRole("table", { name: /Possible replacements/ })],
    ["#/fpl?view=compare&a=1&b=2", () => page.getByRole("table").first()],
    ["#/search?q=arsenal", () => page.getByRole("searchbox")],
  ];
  for (const [hash, ready] of routes) {
    await page.goto(`./${hash}`);
    await expect(ready()).toBeVisible();
    await noOverflow(page);
    await axeClean(page);
  }
  // The button cycles device → light → dark, and the choice survives a reload.
  const button = page.getByRole("button", { name: /^Theme:/ });
  await expect(button).toHaveAccessibleName("Theme: same as device");
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /^Theme:/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0e1512");
});

test("a visitor on an older build is told a newer one is live, and can reload", async ({ page }) => {
  await page.goto("./#/");
  // The build's own version.json matches the running build: no notice.
  await expect(page.locator("section[aria-labelledby=table-heading] tbody tr").first()).toBeVisible();
  await expect(page.getByText("A new version of this site is available.")).toHaveCount(0);
  await page.route(/\/version\.json$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"build":"a-newer-build"}' }),
  );
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "A new version of this site is available." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  await axeClean(page);
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
