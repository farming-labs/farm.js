import { defineConfig } from "@farm.js/core";

// One app, either server components engine. The contract suite builds it once per mode
// (tests/e2e-server-components) and runs the same browser tests against both.
const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";

export default defineConfig({
  experimental: {
    serverComponents: { mode },
    serverActions: true,
  },
  deploy: {
    outputDir: `.farm/.output-${mode}`,
  },
});
