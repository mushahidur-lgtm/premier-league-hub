import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{js,jsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // Pins TZ=UTC so date-formatting assertions behave the same everywhere (CI included).
    globalSetup: ["tests/unit/global-setup.js"],
    // In-memory localStorage, reset after every test, plus timer/mock cleanup.
    setupFiles: ["tests/unit/setup.js"],
  },
});
