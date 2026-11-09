import { resolveFarmRenderer } from "@farm.js/core/renderer";
import { describe, expect, it } from "vitest";
import { msw } from "./index";

// `renderer: false` reaches plugins raw from farm.config.ts, or already resolved by core.
const disabledRenderers = [false, resolveFarmRenderer(false)] as const;

function context(isDev: boolean) {
  return { config: {}, isDev, isProd: !isDev, lifecycle: { onShutdown() {} } } as never;
}

describe("msw() with renderer: false", () => {
  it.each(disabledRenderers)(
    "keeps server mocking and adds no browser worker (%o)",
    async (renderer) => {
      const plugin = msw({ handlers: "src/mocks/handlers.ts" });
      const configured = await plugin.configure?.(
        { root: "/app", renderer, plugins: [plugin], vite: { plugins: [] } } as never,
        context(true),
      );
      expect(configured).toBeUndefined();
      expect(plugin.dev?.server).toBeTypeOf("function");
    },
  );

  it.each(disabledRenderers)("rejects an explicit browser: true (%o)", async (renderer) => {
    const plugin = msw({ handlers: "src/mocks/handlers.ts", browser: true });
    await expect(
      Promise.resolve().then(() =>
        plugin.configure?.({ root: "/app", renderer, plugins: [plugin] } as never, context(true)),
      ),
    ).rejects.toThrow("Remove `browser: true`; server mocking still runs.");
  });
});
