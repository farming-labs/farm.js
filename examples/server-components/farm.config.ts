import { defineConfig } from "@farm.js/core";

// One app, either server components engine. The contract suite builds it once per mode
// (tests/e2e-server-components) and runs the same browser tests against both.
const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";
// A deploy target to build for instead of the Node server the contract runs by default.
const target = process.env.FARM_SERVER_COMPONENTS_TARGET;

export default defineConfig({
  experimental: {
    serverComponents: { mode },
    serverActions: true,
  },
  deploy: {
    ...(target ? { target } : {}),
    outputDir: `.farm/.output-${mode}${target ? `-${target}` : ""}`,
  },
});
