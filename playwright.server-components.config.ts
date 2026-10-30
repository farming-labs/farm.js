import { defineConfig, devices } from "@playwright/test";

// The server components contract: one example app, run with the engine named by
// FARM_SERVER_COMPONENTS_MODE ("rsc" or "islands"), and the same tests for both.
// FARM_SERVER_COMPONENTS_SERVER=dev runs them against `farm dev` instead of a production build.
const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";
const dev = process.env.FARM_SERVER_COMPONENTS_SERVER === "dev";
const port =
  process.env.FARM_SERVER_COMPONENTS_PORT || String((mode === "rsc" ? 4181 : 4182) + (dev ? 2 : 0));
const baseURL = `http://${dev ? "localhost" : "127.0.0.1"}:${port}`;
const app = "examples/server-components";

export default defineConfig({
  testDir: "./tests/e2e-server-components",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  metadata: { mode, server: dev ? "dev" : "production" },
  webServer: {
    command: dev
      ? `FARM_SERVER_COMPONENTS_MODE=${mode} FARM_SKIP_RSC_INSTALL=1 pnpm --dir ${app} exec farm dev --port ${port}`
      : [
          `FARM_SERVER_COMPONENTS_MODE=${mode} FARM_SKIP_RSC_INSTALL=1 pnpm --dir ${app} exec farm build --preset node-server`,
          `NODE_ENV=production HOST=127.0.0.1 PORT=${port} node ${app}/.farm/.output-${mode}/server/index.mjs`,
        ].join(" && "),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [
    {
      name: `chromium-${mode}${dev ? "-dev" : ""}`,
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
