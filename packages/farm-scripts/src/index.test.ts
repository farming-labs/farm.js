import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineScript } from "./client.js";
import { scripts } from "./index.js";

describe("scripts Farm plugin", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, Symbol.for("@farm.js/scripts.browser-store"));
  });

  it("serializes only normalized definitions into the client plugin", () => {
    const chat = defineScript({ name: "chat", src: "/chat.js", global: "SupportChat" });
    const plugin = scripts({ scripts: [chat] });

    expect(plugin.name).toBe("farm:scripts");
    expect(plugin.enforce).toBe("post");
    expect(plugin.client?.public).toEqual({ scripts: [chat.definition], basePath: "/" });
    expect(JSON.stringify(plugin.client?.public)).not.toContain("function");
  });

  it("passes Farm's normalized base path to the browser runtime", () => {
    const chat = defineScript({ name: "chat", src: "/chat.js" });
    const plugin = scripts({ scripts: [chat] });

    plugin.configure?.({ basePath: "/dashboard/", plugins: [plugin] } as never, {} as never);
    expect(plugin.client?.public).toMatchObject({ basePath: "/dashboard" });
  });

  it("connects hydration, navigation, and close to the browser runtime", () => {
    const chat = defineScript({ name: "chat", src: "/chat.js" });
    const plugin = scripts({ scripts: [chat] });
    const state = { afterHydration: vi.fn(), refresh: vi.fn(), close: vi.fn() };

    (plugin.client?.hydration?.after as Function)?.({ state });
    (plugin.client?.navigation?.rendered as Function)?.({ state });
    (plugin.client?.close as Function)?.({ state });

    expect(state.afterHydration).toHaveBeenCalledOnce();
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.close).toHaveBeenCalledOnce();
  });

  it("rejects multiple scripts plugin instances", () => {
    const chat = defineScript({ name: "chat", src: "/chat.js" });
    const first = scripts({ scripts: [chat] });
    const second = scripts({ scripts: [chat] });

    expect(() => first.configure?.({ plugins: [first, second] } as never, {} as never)).toThrow(
      "one scripts() instance",
    );
  });
});
