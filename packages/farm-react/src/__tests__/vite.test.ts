// @vitest-environment node

import { describe, expect, it } from "vitest";
import { react } from "../index";
import { createFarmRendererPlugin } from "../vite";

describe("React renderer Vite integration", () => {
  it("does not install a transform when the compiler is disabled", () => {
    expect(createFarmRendererPlugin({ rendererOptions: react().options })).toEqual([]);
  });

  it("installs automatic inference from compiler: true", () => {
    const plugins = createFarmRendererPlugin({
      rendererOptions: react({ experimental: { compiler: true } }).options,
    });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("farm:react-aot-compiler");
    expect(plugins[0]?.enforce).toBe("pre");
  });
});
