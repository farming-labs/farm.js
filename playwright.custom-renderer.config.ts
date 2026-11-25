import { defineConfig, devices } from "@playwright/test";

// The custom-renderer example in development or as a production build. leaf and farm-leaf are
// workspace packages inside the example, so neither needs a build step.
const server = process.env.FARM_CUSTOM_RENDERER_SERVER === "dev" ? "dev" : "production";
const port = process.env.FARM_CUSTOM_RENDERER_E2E_PORT || (server === "dev" ? "4183" : "4185");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e-custom-renderer",
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
    command:
      server === "dev"
        ? `pnpm --dir examples/custom-renderer exec farm dev --host 127.0.0.1 --port ${port}`
        : [
            "pnpm --dir examples/custom-renderer exec farm build --preset node-server",
            `NODE_ENV=production HOST=127.0.0.1 PORT=${port} node examples/custom-renderer/.farm/.output/server/index.mjs`,
          ].join(" && "),
    url: `${baseURL}/api/crops`,
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
