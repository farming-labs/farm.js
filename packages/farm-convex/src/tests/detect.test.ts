import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { announceNewDeployment } from "../dev.js";
import { convex } from "../index.js";
import { component } from "../component.js";

const url = "https://happy-otter-123.convex.cloud";

const CONVEX_CONFIG = `import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";
import stripe from "@convex-dev/stripe/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp();
app.use(betterAuth);
app.use(stripe);
app.use(rateLimiter);
export default app;
`;

function useAppRoot(convexConfig = CONVEX_CONFIG): string {
  const root = mkdtempSync(path.join(tmpdir(), "farm-convex-detect-"));
  mkdirSync(path.join(root, "convex"));
  writeFileSync(path.join(root, "convex", "convex.config.ts"), convexConfig);
  vi.spyOn(process, "cwd").mockReturnValue(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("detecting services from convex.config.ts", () => {
  it("turns on the helpers for installed components with no `use` list", () => {
    useAppRoot();
    const integration = convex({ url, dev: false });
    expect(integration.routes?.map((route) => route.path)).toEqual(["/api/auth/[...auth]"]);
    expect(integration.providers?.[0]?.props).toEqual({ url, tokenPath: "/api/auth/convex/token" });
    expect(integration.providers?.[0]?.component).toEqual({
      module: "@farm.js/convex/client",
      export: "ConvexClientProvider",
    });
  });

  it("lets an entry in `use` replace the detected helper for the same component", () => {
    useAppRoot();
    const integration = convex({
      url,
      dev: false,
      use: [component("@convex-dev/stripe", { webhooks: true })],
    });
    expect(integration.routes?.map((route) => route.path)).toEqual([
      "/api/auth/[...auth]",
      "/api/webhooks/stripe",
    ]);
  });

  it("detects nothing when detect is false", () => {
    useAppRoot();
    const integration = convex({ url, dev: false, detect: false });
    expect(integration.routes ?? []).toEqual([]);
    expect(integration.providers?.[0]?.props).toEqual({ url });
  });

  it("skips a detected service whose home is Farm", () => {
    useAppRoot();
    const integration = convex({ url, dev: false, home: { auth: "farm" } });
    expect(integration.routes ?? []).toEqual([]);
  });
});

describe("a new app without a deployment", () => {
  it("starts in farm dev without CONVEX_URL and mounts nothing yet", () => {
    useAppRoot();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CONVEX_URL", "");
    vi.stubEnv("VITE_CONVEX_URL", "");
    const integration = convex();
    expect(integration.providers ?? []).toEqual([]);
    expect(integration.routes ?? []).toEqual([]);
    expect(integration.plugins?.map((plugin) => plugin.name)).toEqual(["farm:convex"]);
  });

  it("still fails fast in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONVEX_URL", "");
    vi.stubEnv("VITE_CONVEX_URL", "");
    expect(() => convex()).toThrow(/requires CONVEX_URL/);
  });

  it("asks for a restart at once when convex dev wrote the URL before Farm started watching", () => {
    const root = mkdtempSync(path.join(tmpdir(), "farm-convex-first-run-"));
    writeFileSync(path.join(root, ".env.local"), "CONVEX_URL=http://127.0.0.1:3210\n");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stop = announceNewDeployment(root, 20);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Restart farm dev"));
    stop();
  });

  it(
    "asks for a restart once convex dev writes the deployment URL",
    { timeout: 15_000 },
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "farm-convex-first-run-"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const stop = announceNewDeployment(root, 20);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("CONVEX_URL is not set yet"));
      writeFileSync(path.join(root, ".env.local"), "CONVEX_URL=http://127.0.0.1:3210\n");
      await vi.waitFor(
        () => expect(log).toHaveBeenCalledWith(expect.stringContaining("Restart farm dev")),
        // Polled, so allow for a loaded machine, and stay below the test timeout so a miss
        // reports this assertion instead of a bare timeout.
        { timeout: 10_000, interval: 50 },
      );
      stop();
    },
  );
});
