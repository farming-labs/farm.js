import { defineConfig, devices } from "@playwright/test";

const development = "http://127.0.0.1:4198";
const production = "http://127.0.0.1:4199/lab/";

export default defineConfig({
  testDir: "./tests/e2e-wasm",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --dir examples/wasm-demo dev --port 4198",
      url: development,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FARM_TELEMETRY_DISABLED: "1" },
    },
    {
      command: "pnpm --dir examples/wasm-demo build && pnpm --dir examples/wasm-demo preview",
      url: production,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        HOST: "127.0.0.1",
        PORT: "4199",
        FARM_TELEMETRY_DISABLED: "1",
        FARM_SKIP_NPM_INSTALL: "1",
        FARM_VITE_BUILDER: process.env.FARM_VITE_BUILDER || "rolldown",
      },
    },
  ],
  projects: [
    { name: "development", use: { baseURL: development } },
    { name: "production", use: { baseURL: production } },
  ],
});
