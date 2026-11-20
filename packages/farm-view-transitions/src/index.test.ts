import { describe, expect, it, vi } from "vitest";
import { viewTransitions } from "./index.js";

describe("viewTransitions Farm plugin", () => {
  it("registers the plugin with the resolved options", () => {
    const plugin = viewTransitions({ exclude: ["/checkout"] });

    expect(plugin.name).toBe("farm:view-transitions");
    expect(plugin.client?.public).toEqual({ exclude: ["/checkout"] });
    expect(JSON.stringify(plugin.client?.public)).not.toContain("function");
  });

  it("fills the defaults when no options are given", () => {
    const plugin = viewTransitions();

    expect(plugin.client?.public).toEqual({ exclude: [] });
  });

  it("creates a runtime from the public options in setup and closes it", async () => {
    const plugin = viewTransitions();
    const runtime = await (plugin.client?.setup as Function)?.({
      public: { exclude: [] },
    });
    expect(typeof runtime.close).toBe("function");
    expect(typeof runtime.beginForNavigation).toBe("function");
    expect(typeof runtime.finishForNavigation).toBe("function");

    (plugin.client?.close as Function)?.({ state: runtime });
  });

  it("rejects multiple viewTransitions plugin instances", () => {
    const first = viewTransitions();
    const second = viewTransitions();

    expect(() => first.configure?.({ plugins: [first, second] } as never, {} as never)).toThrow(
      "one viewTransitions() instance",
    );
  });

  it("delegates the navigation hooks to the runtime", () => {
    const plugin = viewTransitions();
    const state = {
      beginForNavigation: vi.fn(),
      finishForNavigation: vi.fn(),
      close: vi.fn(),
    };
    const signal = new AbortController().signal;
    const event = {
      id: "navigation:1",
      from: null,
      to: { href: "http://localhost/next", pathname: "/next", search: "", hash: "" },
      action: "push",
      state,
      signal,
    };

    (plugin.client?.navigation?.before as Function)?.(event);
    expect(state.beginForNavigation).toHaveBeenCalledWith(event);

    (plugin.client?.navigation?.resolved as Function)?.(event);
    expect(state.finishForNavigation).toHaveBeenCalledWith(event);
  });
});
