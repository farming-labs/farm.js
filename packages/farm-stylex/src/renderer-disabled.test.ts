import { resolveFarmRenderer } from "@farm.js/core/renderer";
import { describe, expect, it } from "vitest";
import { stylex } from "./index";

// `renderer: false` reaches plugins raw from farm.config.ts, or already resolved by core.
const disabledRenderers = [false, resolveFarmRenderer(false)] as const;

function context(isDev: boolean) {
  return { config: {}, isDev, isProd: !isDev, lifecycle: { onShutdown() {} } } as never;
}

describe("stylex() with renderer: false", () => {
  it.each(disabledRenderers)(
    "explains that a backend-only app has no pages (%o)",
    async (renderer) => {
      const plugin = stylex();
      await expect(
        Promise.resolve().then(() =>
          plugin.configure?.({ root: "/app", renderer, plugins: [plugin] } as never, context(true)),
        ),
      ).rejects.toThrow("Remove stylex(), or remove `renderer: false` to render pages.");
    },
  );

  it("still configures an app with a renderer", async () => {
    const plugin = stylex();
    await expect(
      Promise.resolve().then(() =>
        plugin.configure?.({ root: "/app", plugins: [plugin] } as never, context(true)),
      ),
    ).resolves.not.toThrow();
  });
});
