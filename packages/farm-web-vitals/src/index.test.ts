import { describe, expect, it, vi } from "vitest";
import { webVitals } from "./index.js";

describe("webVitals Farm plugin", () => {
  it("registers the plugin with the resolved options", () => {
    const plugin = webVitals({ endpoint: "/__farm/vitals" });

    expect(plugin.name).toBe("farm:web-vitals");
    expect(plugin.client?.public).toEqual({ endpoint: "/__farm/vitals" });
    expect(JSON.stringify(plugin.client?.public)).not.toContain("function");
  });

  it("fills the defaults when no options are given", () => {
    const plugin = webVitals();

    expect(plugin.client?.public).toEqual({});
  });

  it("connects performance, navigation and close hooks to the collector", async () => {
    const plugin = webVitals({ endpoint: "/__farm/vitals" });
    const state = { record: vi.fn(), flush: vi.fn(), close: vi.fn() };
    const entry = {
      entryType: "largest-contentful-paint",
      startTime: 1200,
    } as unknown as PerformanceEntry;
    const location = { pathname: "/pricing", href: "/pricing", search: "", hash: "" };

    (plugin.client?.performance as Function)?.({ state, entry, location });
    (plugin.client?.navigation?.before as Function)?.({ state });
    (plugin.client?.close as Function)?.({ state });

    expect(state.record).toHaveBeenCalledOnce();
    expect(state.record).toHaveBeenCalledWith(entry, location);
    expect(state.flush).toHaveBeenCalledOnce();
    expect(state.close).toHaveBeenCalledOnce();
  });

  it("creates a collector from the public endpoint in setup", async () => {
    const plugin = webVitals({ endpoint: "/__farm/vitals" });
    const beacon = vi.fn().mockReturnValue(true);
    const original = Object.getOwnPropertyDescriptor(window.navigator, "sendBeacon");
    Object.defineProperty(window.navigator, "sendBeacon", {
      configurable: true,
      value: beacon,
    });
    try {
      const collector = await (plugin.client?.setup as Function)?.({
        public: { endpoint: "/__farm/vitals" },
      });
      expect(typeof collector.record).toBe("function");

      collector.record(
        { entryType: "largest-contentful-paint", startTime: 1200 } as unknown as PerformanceEntry,
        { pathname: "/", href: "/", search: "", hash: "" },
      );
      collector.flush();

      expect(beacon).toHaveBeenCalledOnce();
      expect(beacon.mock.calls[0][0]).toBe("/__farm/vitals");
      expect(JSON.parse(beacon.mock.calls[0][1]).lcp).toBe(1200);
    } finally {
      if (original) Object.defineProperty(window.navigator, "sendBeacon", original);
      else delete (window.navigator as unknown as Record<string, unknown>).sendBeacon;
    }
  });

  it("rejects multiple webVitals plugin instances", () => {
    const first = webVitals();
    const second = webVitals();

    expect(() => first.configure?.({ plugins: [first, second] } as never, {} as never)).toThrow(
      "one webVitals() instance",
    );
  });
});
