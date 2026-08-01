// @vitest-environment node

import { describe, expect, it } from "vitest";
import { defineConfig } from "../vite";

describe("Farm Vite dependency optimization", () => {
  it("pre-bundles framework client entries with React", async () => {
    const config = await defineConfig();

    expect(config.optimizeDeps.include).toEqual(
      expect.arrayContaining([
        "react",
        "react-dom/client",
        "@farm.js/core/client",
        "@farm.js/core/plugin/client",
        "@farm.js/core/deferred",
        "@farm.js/core/deployment",
      ]),
    );
    expect(config.optimizeDeps.entries).toBeUndefined();
  });
});
