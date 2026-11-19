import { defineConfig, devices } from "@playwright/test";

// Local only (never in CI): `npx playwright test`. Runs against a production build served by
// `vite preview`; every network request is answered from tests/e2e/fixtures.
const PORT = 4173;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}/premier-league-hub/`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/premier-league-hub/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
