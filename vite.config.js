import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { BASE } from "./src/config/site.js";

// No dev CORS proxy: browser data comes only from CORS-enabled ESPN endpoints,
// and news comes from same-origin files written by scripts/fetch-data.mjs.
export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss()],
});
