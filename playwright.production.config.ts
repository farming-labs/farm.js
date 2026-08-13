import { defineConfig, devices } from "@playwright/test";

const port = process.env.FARM_PRODUCTION_E2E_PORT || "4175";
const externalBaseURL = process.env.FARM_E2E_BASE_URL;
const baseURL = externalBaseURL || `http://127.0.0.1:${port}`;

process.env.FARM_E2E_MODE = "prod";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["runtime-error-overlay.spec.ts"],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: [
          "FARM_VITE_BUILDER=rolldown corepack pnpm --dir examples/basic exec farm build --preset node-server",
          `NODE_ENV=production CRON_SECRET=farm-production-e2e-secret HOST=127.0.0.1 PORT=${port} node examples/basic/.farm/.output/server/index.mjs`,
        ].join(" && "),
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
