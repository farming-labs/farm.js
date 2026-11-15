import { resolveFarmRenderer } from "@farm.js/core/renderer";
import { describe, expect, it } from "vitest";
import { hints } from "./index";

// `renderer: false` reaches plugins raw from farm.config.ts, or already resolved by core.
const disabledRenderers = [false, resolveFarmRenderer(false)] as const;

function context(isDev: boolean) {
  return { config: {}, isDev, isProd: !isDev, lifecycle: { onShutdown() {} } } as never;
}

describe("hints() with renderer: false", () => {
  it.each(disabledRenderers)(
    "removes itself instead of pre-bundling a browser runtime (%o)",
    async (renderer) => {
      const plugin = hints();
      const other = { name: "other" };
      const configured = (await plugin.configure?.(
        { root: "/app", renderer, plugins: [plugin, other], vite: {} } as never,
        context(true),
      )) as { plugins: unknown[]; vite?: { optimizeDeps?: unknown } };
      expect(configured.plugins).toEqual([other]);
      expect(configured.vite?.optimizeDeps).toBeUndefined();
    },
  );
});
