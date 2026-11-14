import { describe, expect, it, vi } from "vitest";
import { prefetch } from "./index.js";

describe("prefetch Farm plugin", () => {
  it("registers the plugin with the resolved options", () => {
    const plugin = prefetch({ strategy: "hover", maxConcurrent: 2 });

    expect(plugin.name).toBe("farm:prefetch");
    expect(plugin.client?.public).toEqual({
      strategy: "hover",
      maxConcurrent: 2,
      allow: [],
      deny: [],
      hoverDelayMs: 50,
    });
    expect(JSON.stringify(plugin.client?.public)).not.toContain("function");
  });

  it("fills the defaults when no options are given", () => {
    const plugin = prefetch();

    expect(plugin.client?.public).toEqual({
      strategy: "both",
      maxConcurrent: 6,
      allow: [],
      deny: [],
      hoverDelayMs: 50,
    });
  });

  it("creates a runtime from the public options in setup and closes it", async () => {
    const plugin = prefetch({ strategy: "hover", hoverDelayMs: 0 });
    const router = { prefetch: vi.fn(async () => {}) };

    const runtime = await (plugin.client?.setup as Function)?.({
      public: { strategy: "hover", maxConcurrent: 6, allow: [], deny: [], hoverDelayMs: 0 },
      router,
    });
    expect(typeof runtime.close).toBe("function");

    (plugin.client?.close as Function)?.({ state: runtime });
  });

  it("rejects multiple prefetch plugin instances", () => {
    const first = prefetch();
    const second = prefetch();

    expect(() => first.configure?.({ plugins: [first, second] } as never, {} as never)).toThrow(
      "one prefetch() instance",
    );
  });
});
