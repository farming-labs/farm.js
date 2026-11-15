import * as compiler from "vue/compiler-sfc";
import type { HmrContext, Plugin } from "vite";
import { describe, expect, it, vi } from "vitest";
import { createFarmRendererPlugin } from "../vite";

function hotUpdate(plugin: Plugin) {
  const send = vi.fn();
  const context = {
    file: "/app/src/farm.d.ts",
    timestamp: Date.now(),
    modules: [],
    read: async () => "",
    server: { ws: { send } },
  } as unknown as HmrContext;
  const hook = plugin.handleHotUpdate as (this: unknown, context: HmrContext) => unknown;
  return { result: hook.call({}, context), send };
}

describe("Vue renderer Vite plugin", () => {
  it("ignores file changes that arrive before plugin-vue resolves its compiler", () => {
    // Farm rewrites stale generated types while the dev server starts, before buildStart.
    const plugin = createFarmRendererPlugin() as Plugin;
    const { result, send } = hotUpdate(plugin);
    expect(result).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("delegates to plugin-vue once the compiler is resolved", () => {
    const plugin = createFarmRendererPlugin() as Plugin & {
      api: { options: { compiler?: typeof compiler } };
    };
    plugin.api.options.compiler = compiler;
    const { send } = hotUpdate(plugin);
    expect(send).toHaveBeenCalledWith({
      type: "custom",
      event: "file-changed",
      data: { file: "/app/src/farm.d.ts" },
    });
  });
});
