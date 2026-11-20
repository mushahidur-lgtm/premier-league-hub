import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { BASE } from "./src/config/site.js";

// One id per build: the commit in CI, otherwise the build time. The app compares it with the deployed
// version.json to tell a visitor holding a cached, older index.html that a newer build is live (GitLab Pages
// caches every file for 10 minutes and its headers can't be changed).
const BUILD_ID = process.env.CI_COMMIT_SHORT_SHA || `local-${Date.now().toString(36)}`;

/** Writes dist/version.json with the build id (build only). */
const versionFile = {
  name: "version-file",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
  },
};

// No dev CORS proxy: browser data comes only from CORS-enabled ESPN endpoints,
// and news comes from same-origin files written by scripts/fetch-data.mjs.
export default defineConfig({
  base: BASE,
  define: { "import.meta.env.VITE_BUILD_ID": JSON.stringify(BUILD_ID) },
  plugins: [react(), tailwindcss(), versionFile],
});
