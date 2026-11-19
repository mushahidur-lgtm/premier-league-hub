// Takes the README screenshots (docs/screenshots/) and the Open Graph image (public/og.png) with
// Playwright against the production build. Local only, like the e2e tests.
import { spawnSync } from "node:child_process";

const { status } = spawnSync("npx", ["playwright", "test", "tests/e2e/screenshots.spec.js"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, SHOTS: "1" },
});
process.exit(status ?? 1);
