// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { describe, expect, it, vi } from "vitest";
import { FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE } from "../server/vite-config";
import { logger } from "../utils";
import { defineConfig, farmPlugin } from "../vite";

describe("Farm Vite dependency optimization", () => {
  it("pre-bundles framework and route UI entries with React", async () => {
    const config = await defineConfig();

    expect(config.optimizeDeps).toMatchObject({
      noDiscovery: false,
      holdUntilCrawlEnd: true,
      include: [...FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE],
    });
    expect(config.optimizeDeps.entries).toEqual([
      "src/app/**/{page,layout,loading,error,not-found,default}.{js,jsx,ts,tsx}",
    ]);
  });

  it("maps @ to srcDir in the development Vite config", async () => {
    const config = await defineConfig({ srcDir: "web" });

    expect(config.resolve?.alias).toMatchObject({
      "@": path.resolve(process.cwd(), "web"),
    });
  });
});

describe("Farm Vite publicDir", () => {
  it("passes the configured publicDir to Vite through the plugin config hook", () => {
    const plugin = farmPlugin({ publicDir: "static" });

    const config = (plugin.config as any)?.(
      {},
      { command: "serve", mode: "development", isSsrBuild: false },
    );
    expect(config.publicDir).toBe("static");
  });

  it("leaves Vite's default publicDir untouched when none is configured", () => {
    const plugin = farmPlugin({});

    const config = (plugin.config as any)?.(
      {},
      { command: "serve", mode: "development", isSsrBuild: false },
    );
    expect("publicDir" in config).toBe(false);
  });
});

describe("Farm Vite link delegation", () => {
  it("preserves download links and application click cancellation", async () => {
    const plugin = farmPlugin({});
    const source = await (plugin.load as (id: string) => Promise<string>)("/@farm/client");
    const start = source.indexOf("// ====== EVENT DELEGATION FOR LINKS ======");
    const end = source.indexOf("if (import.meta.hot)", start);
    const delegation = source.slice(start, end);

    expect(delegation).toContain("if (target.hasAttribute('download')) return;");
    expect(delegation).toContain("if (event.defaultPrevented) return;");
    expect(delegation).toContain("hasAbsoluteNavigationHref(href)");
    expect(delegation).not.toContain("}, true)");
  });

  it("loads queried client entries used by bootstrap plugins", async () => {
    const plugin = farmPlugin({});
    const id = "/@farm/client.js?mf-entry-bootstrap";
    const resolved = await (plugin.resolveId as (id: string) => Promise<string>)(id);
    const source = await (plugin.load as (id: string) => Promise<string>)(id);

    expect(resolved).toBe(id);
    expect(source).toContain("// ====== EVENT DELEGATION FOR LINKS ======");
  });
});

describe("Farm Vite type artifacts", () => {
  it("warns when startup generation leaves farm.d.ts stale", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-vite-type-warning-"));
    await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
    await fs.mkdir(path.join(root, "src", "farm.d.ts"));
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [
        farmPlugin({
          root,
          images: { provider: "none" },
          telemetry: false,
        }),
      ],
      server: { middlewareMode: true },
    });

    try {
      expect(warning).toHaveBeenCalledWith(
        expect.stringMatching(/^Route type generation failed \(farm\.d\.ts may be stale\): /),
      );
    } finally {
      await server.close();
      warning.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
