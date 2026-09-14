import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e-devtools",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  use: { ...devices["Desktop Chrome"], screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: [
    {
      command: "pnpm --dir examples/hints-demo dev --port 4194",
      url: "http://localhost:4194",
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FARM_TELEMETRY_DISABLED: "1" },
    },
    {
      command:
        "pnpm --dir examples/hints-demo build && node examples/hints-demo/.farm/.output/server/index.mjs",
      url: "http://127.0.0.1:4195",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        HOST: "127.0.0.1",
        PORT: "4195",
        FARM_TELEMETRY_DISABLED: "1",
        FARM_SKIP_NPM_INSTALL: "1",
        FARM_VITE_BUILDER: process.env.FARM_VITE_BUILDER || "rolldown",
      },
    },
  ],
  projects: [
    { name: "development", use: { baseURL: "http://localhost:4194" } },
    { name: "production", use: { baseURL: "http://127.0.0.1:4195" } },
  ],
});
