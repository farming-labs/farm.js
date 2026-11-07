import { describe, expect, it, vi } from "vitest";
import { progress } from "./index.js";

describe("progress Farm plugin", () => {
  it("registers the plugin with the resolved options", () => {
    const plugin = progress({ delayMs: 0, color: "red", height: 2 });

    expect(plugin.name).toBe("farm:progress");
    expect(plugin.client?.public).toEqual({ delayMs: 0, color: "red", height: 2 });
    expect(JSON.stringify(plugin.client?.public)).not.toContain("function");
  });

  it("fills the defaults when no options are given", () => {
    const plugin = progress();

    expect(plugin.client?.public).toEqual({ delayMs: 150, color: "#2563eb", height: 3 });
  });

  it("connects navigation hooks and close to the browser runtime", () => {
    const plugin = progress();
    const state = { show: vi.fn(), hide: vi.fn(), fail: vi.fn(), close: vi.fn() };

    (plugin.client?.navigation?.before as Function)?.({ state });
    (plugin.client?.navigation?.rendered as Function)?.({ state });
    (plugin.client?.navigation?.error as Function)?.({ state });
    (plugin.client?.close as Function)?.({ state });

    expect(state.show).toHaveBeenCalledOnce();
    expect(state.hide).toHaveBeenCalledOnce();
    expect(state.fail).toHaveBeenCalledOnce();
    expect(state.close).toHaveBeenCalledOnce();
  });

  it("rejects multiple progress plugin instances", () => {
    const first = progress();
    const second = progress();

    expect(() => first.configure?.({ plugins: [first, second] } as never, {} as never)).toThrow(
      "one progress() instance",
    );
  });
});
