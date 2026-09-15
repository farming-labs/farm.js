import { defineConfig, devices } from "@playwright/test";

const port = process.env.FARM_ISOLATED_E2E_PORT || "4179";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e-isolated-hydration",
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
  webServer: {
    command: [
      "FARM_VITE_BUILDER=rolldown pnpm --dir examples/isolated-hydration exec farm build --preset node-server",
      `NODE_ENV=production HOST=127.0.0.1 PORT=${port} node examples/isolated-hydration/.farm/.output/server/index.mjs`,
    ].join(" && "),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
