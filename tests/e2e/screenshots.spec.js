// README screenshots and the Open Graph image, taken from the production build with the recorded
// fixtures. Not a test: skipped unless SHOTS=1 (`npm run screenshots`). Club crests are the one
// thing fetched live (from ESPN's CDN), so the pictures show real crests.
import { test } from "@playwright/test";
import { mockAll, RECORDED } from "./mock.js";
import { CLUBS } from "../../src/config/clubs.js";

const OUT = "docs/screenshots";

test.skip(!process.env.SHOTS, "set SHOTS=1 (npm run screenshots)");

test.beforeEach(async ({ page }) => {
  await mockAll(page);
  await page.route(/espncdn\.com/, (route) => route.continue());
});

/** @param {import("@playwright/test").Page} page */
const settle = async (page) => {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // Lazy images below the fold never load, so wait only for those in view.
  await page.waitForFunction(() =>
    [...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight).every((i) => i.complete),
  );
  const broken = await page.evaluate(() =>
    [...document.images]
      .filter((i) => i.getBoundingClientRect().top < innerHeight && !i.naturalWidth)
      .map((i) => i.src),
  );
  if (broken.length) console.warn("crests that didn't load:", broken);
};

/** For full-page shots: scroll through so lazy crests below the first screen load too. */
const settleFull = async (page) => {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await settle(page);
};

test("desktop pages", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("./");
  await page.locator("section[aria-labelledby=transfers-heading] li").first().waitFor();
  await settle(page);
  await page.screenshot({ path: `${OUT}/home.png` });
  await page.locator("section[aria-labelledby=transfers-heading]").screenshot({ path: `${OUT}/transfers.png` });
  await page.locator("section[aria-labelledby=fixtures-heading]").screenshot({ path: `${OUT}/gameweek.png` });
  await page.locator("section[aria-labelledby=leaders-heading]").screenshot({ path: `${OUT}/leaders.png` });

  await page.goto(`./#/club/${RECORDED.club}`);
  const note = page.getByRole("link", { name: /Reported injured/ });
  await note.waitFor();
  await settle(page);
  await page.screenshot({ path: `${OUT}/club.png` });
  await note.evaluate((el) => el.closest("li")?.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: `${OUT}/squad-injury.png` });

  await page.goto(`./#/player/${RECORDED.playerId}`);
  await page.locator("section[aria-labelledby=recent-heading] tbody tr").first().waitFor();
  await settleFull(page);
  await page.screenshot({ path: `${OUT}/player.png`, fullPage: true });

  await page.goto(`./#/compare?a=${RECORDED.playerId}&b=${RECORDED.otherPlayerId}`);
  await page.locator("#compare-heading").waitFor();
  await settleFull(page);
  await page.screenshot({ path: `${OUT}/compare.png`, fullPage: true });

  await page.goto(`./#/stats?club=${RECORDED.club}&metric=possession`);
  await page.getByRole("img", { name: /^Bar chart/ }).waitFor();
  await settleFull(page);
  await page.screenshot({ path: `${OUT}/stats-teams.png`, fullPage: true });

  await page.goto(`./#/stats?view=progression`);
  await page.getByRole("img", { name: /^Line chart/ }).waitFor();
  await settle(page);
  await page.screenshot({ path: `${OUT}/stats-progression.png` });

  await page.goto(`./#/match/${RECORDED.eventId}`);
  await page.getByRole("heading", { name: "Key events" }).waitFor();
  await settleFull(page);
  await page.screenshot({ path: `${OUT}/match.png`, fullPage: true });
});

test("mobile home", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await page.goto("./");
  await page.locator("section[aria-labelledby=table-heading] tbody tr").first().waitFor();
  await settle(page);
  await page.screenshot({ path: `${OUT}/home-mobile.png` });

  await page.goto(`./#/stats?view=progression`);
  await page.getByRole("img", { name: /^Line chart/ }).waitFor();
  await settle(page);
  await page.locator("figure").screenshot({ path: `${OUT}/progression-mobile.png` });
});

// 1200×630 card drawn with the site's own fonts and colours; no league logo or wordmark.
test("open graph image", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto("./");
  await settle(page);
  const stripes = CLUBS.map(
    (c) =>
      `<span style="flex:1;background:linear-gradient(${c.colors.primary} 70%, ${c.colors.secondary} 70%)"></span>`,
  ).join("");
  await page.evaluate((stripes) => {
    document.body.innerHTML = `
      <div style="width:1200px;height:630px;background:#fafbf8;color:#14201b;display:flex;flex-direction:column;
                  justify-content:space-between;font-family:Barlow,sans-serif;box-sizing:border-box">
        <div style="display:flex;height:28px">${stripes}</div>
        <div style="padding:0 80px">
          <div style="font:700 112px/1 'Barlow Condensed',sans-serif;letter-spacing:-1px">Premier League Hub</div>
          <div style="font-size:40px;margin-top:28px;color:#4f5c55;max-width:960px;line-height:1.25">
            Table, fixtures, club pages, squads, news and match centre for all 20 clubs.</div>
        </div>
        <div style="padding:0 80px 56px;font-size:26px;color:#1f5135;font-weight:600">
          Unofficial fan site · data from ESPN · news from BBC Sport, The Guardian and Sky Sports</div>
      </div>`;
    document.body.style.margin = "0";
  }, stripes);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "public/og.png" });
});
