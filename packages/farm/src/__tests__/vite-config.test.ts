// @vitest-environment node

import { describe, expect, it } from "vitest";
import path from "node:path";
import { FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE } from "../server/vite-config";
import { defineConfig } from "../vite";

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
