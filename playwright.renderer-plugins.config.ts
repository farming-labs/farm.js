import { defineConfig, devices } from "@playwright/test";

// @farm.js/prefetch and @farm.js/scroll-restoration on each renderer example, in development and
// as a production build. tests/e2e-renderer-plugins/serve.mjs serves a copy of the example with
// both plugins registered.
const apps = (["leaf", "preact", "solid", "vue", "svelte"] as const).flatMap((renderer, index) =>
  (["dev", "production"] as const).map((server, offset) => ({
    renderer,
    server,
    port: 4201 + index * 2 + offset,
  })),
);

export default defineConfig({
  testDir: "./tests/e2e-renderer-plugins",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: apps.map(({ renderer, server, port }) => ({
    command: `node tests/e2e-renderer-plugins/serve.mjs ${renderer} ${server} ${port}`,
    url: `http://127.0.0.1:${port}/plugin-probe`,
    reuseExistingServer: false,
    timeout: 240_000,
    // serve.mjs removes its copy of the example when it stops.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  })),
  projects: apps.map(({ renderer, server, port }) => ({
    name: `${renderer}-${server}`,
    metadata: { server },
    use: { baseURL: `http://127.0.0.1:${port}` },
  })),
});
