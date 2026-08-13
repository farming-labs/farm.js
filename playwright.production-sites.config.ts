import { defineConfig, devices } from "@playwright/test";

const docsPort = process.env.FARM_DOCS_PRODUCTION_E2E_PORT || "4276";
const demoPort = process.env.FARM_SSR_SSG_PRODUCTION_E2E_PORT || "4277";
const docsBaseURL = `http://127.0.0.1:${docsPort}`;
const demoBaseURL = `http://127.0.0.1:${demoPort}`;

export default defineConfig({
  testDir: "./tests/e2e-production-sites",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `NODE_ENV=production HOST=127.0.0.1 PORT=${docsPort} node docs/.farm/.output/server/index.mjs`,
      url: docsBaseURL,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `NODE_ENV=production HOST=127.0.0.1 PORT=${demoPort} node examples/ssr-ssg-demo/.farm/.output/server/index.mjs`,
      url: demoBaseURL,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: "docs-production",
      testMatch: "docs.production.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: docsBaseURL,
      },
    },
    {
      name: "ssr-ssg-production",
      testMatch: "ssr-ssg.production.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: demoBaseURL,
      },
    },
  ],
});
