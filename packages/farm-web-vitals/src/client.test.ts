import { describe, expect, it, vi } from "vitest";
import { webVitalsClient } from "./client.js";

describe("webVitalsClient", () => {
  it("wires performance, navigation and close hooks to a live collector", async () => {
    const onReport = vi.fn();
    const plugin = webVitalsClient({ onReport });
    const state = await (plugin.setup as Function)?.({});

    (plugin.performance as Function)?.({
      state,
      entry: {
        entryType: "largest-contentful-paint",
        startTime: 900,
      } as unknown as PerformanceEntry,
      location: { pathname: "/about", href: "/about", search: "", hash: "" },
    });
    (plugin.navigation?.before as Function)?.({ state });

    expect(onReport).toHaveBeenCalledOnce();
    expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ route: "/about", lcp: 900 }));
  });

  it("flushes on close", async () => {
    const onReport = vi.fn();
    const plugin = webVitalsClient({ onReport });
    const state = await (plugin.setup as Function)?.({});

    (plugin.performance as Function)?.({
      state,
      entry: {
        entryType: "navigation",
        responseStart: 150,
        startTime: 0,
      } as unknown as PerformanceEntry,
      location: { pathname: "/", href: "/", search: "", hash: "" },
    });
    (plugin.close as Function)?.({ state });

    expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ route: "/", ttfb: 150 }));
  });
});
