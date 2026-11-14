import { describe, expect, it, vi } from "vitest";
import { scrollRestoration } from "./index.js";

describe("scrollRestoration Farm plugin", () => {
  it("registers the plugin with the resolved options", () => {
    const plugin = scrollRestoration({ storageKeyPrefix: "my-app-scroll" });

    expect(plugin.name).toBe("farm:scroll-restoration");
    expect(plugin.client?.public).toEqual({ storageKeyPrefix: "my-app-scroll" });
    expect(JSON.stringify(plugin.client?.public)).not.toContain("function");
  });

  it("fills the defaults when no options are given", () => {
    const plugin = scrollRestoration();

    expect(plugin.client?.public).toEqual({ storageKeyPrefix: "farm-scroll-restore" });
  });

  it("creates a runtime from the public options in setup and closes it", async () => {
    const plugin = scrollRestoration();
    const runtime = await (plugin.client?.setup as Function)?.({
      public: { storageKeyPrefix: "farm-scroll-restore" },
    });
    expect(typeof runtime.close).toBe("function");
    expect(typeof runtime.saveForNavigation).toBe("function");
    expect(typeof runtime.restoreForNavigation).toBe("function");

    (plugin.client?.close as Function)?.({ state: runtime });
  });

  it("rejects multiple scrollRestoration plugin instances", () => {
    const first = scrollRestoration();
    const second = scrollRestoration();

    expect(() => first.configure?.({ plugins: [first, second] } as never, {} as never)).toThrow(
      "one scrollRestoration() instance",
    );
  });

  it("delegates the navigation hooks to the runtime", () => {
    const plugin = scrollRestoration();
    const state = {
      saveForNavigation: vi.fn(),
      restoreForNavigation: vi.fn(),
      discard: vi.fn(),
      close: vi.fn(),
    };
    const signal = new AbortController().signal;
    const event = {
      id: "navigation:1",
      from: null,
      to: { href: "http://localhost/next", pathname: "/next", search: "", hash: "" },
      action: "pop",
      state,
      signal,
    };

    (plugin.client?.navigation?.before as Function)?.(event);
    expect(state.saveForNavigation).toHaveBeenCalledWith(event);

    (plugin.client?.navigation?.rendered as Function)?.(event);
    expect(state.restoreForNavigation).toHaveBeenCalledWith(event);

    (plugin.client?.navigation?.error as Function)?.(event);
    expect(state.discard).toHaveBeenCalledWith("navigation:1");
  });
});
