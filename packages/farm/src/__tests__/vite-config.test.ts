// @vitest-environment node

import { describe, expect, it } from "vitest";
import { FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE } from "../server/vite-config";
import { defineConfig } from "../vite";

describe("Farm Vite dependency optimization", () => {
  it("pre-bundles framework client entries with React", async () => {
    const config = await defineConfig();

    expect(config.optimizeDeps).toMatchObject({
      noDiscovery: false,
      holdUntilCrawlEnd: true,
      include: [...FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE],
    });
    expect(config.optimizeDeps.entries).toBeUndefined();
  });
});
