import { defineConfig } from "@farm.js/core";

// The payload benchmark app, built once per server components engine.
const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";

export default defineConfig({
  experimental: { serverComponents: { mode } },
  deploy: { outputDir: `.farm/.output-${mode}` },
});
