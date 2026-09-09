import { describe, expect, it, vi } from "vitest";
import { hints } from "./index.js";

function context(isDev: boolean) {
  return {
    config: {},
    isDev,
    isProd: !isDev,
    lifecycle: { onShutdown() {} },
    requestContext: {},
  } as never;
}

describe("hints Farm plugin", () => {
  it("exposes resolved browser-safe defaults", () => {
    const plugin = hints();
    expect(plugin.name).toBe("farm:hints");
    expect(plugin.enforce).toBe("post");
    expect(plugin.client?.public).toMatchObject({
      enabled: true,
      html: true,
      report: "overlay",
      accessibility: { level: "AA" },
      performance: { lcp: 2_500 },
      thirdParty: { slow: 1_000 },
    });
  });

  it("removes itself before production bundles are generated", async () => {
    const plugin = hints();
    const other = { name: "other" };
    const configured = await plugin.configure?.(
      { plugins: [other, plugin] } as never,
      context(false),
    );

    expect((configured as any).plugins).toEqual([other]);
  });

  it("also removes itself when explicitly disabled", async () => {
    const plugin = hints({ enabled: false });
    const configured = await plugin.configure?.({ plugins: [plugin] } as never, context(true));
    expect((configured as any).plugins).toEqual([]);
  });

  it("records lifecycle timings without delaying hydration or navigation", () => {
    const plugin = hints();
    const state = { recordTiming: vi.fn(), scan: vi.fn(() => Promise.resolve()) };

    const hydrationResult = plugin.client?.hydration?.after?.({
      state,
      durationMs: 42,
      location: new URL("https://example.test/account"),
    } as never);
    const navigationResult = plugin.client?.navigation?.rendered?.({
      state,
      durationMs: 73,
      to: new URL("https://example.test/settings"),
    } as never);

    expect(hydrationResult).toBeUndefined();
    expect(navigationResult).toBeUndefined();
    expect(state.recordTiming).toHaveBeenNthCalledWith(1, "hydration", 42, "/account");
    expect(state.recordTiming).toHaveBeenNthCalledWith(2, "navigation", 73, "/settings");
    expect(state.scan).toHaveBeenNthCalledWith(1, "hydration", "/account");
    expect(state.scan).toHaveBeenNthCalledWith(2, "navigation", "/settings");
  });
});
