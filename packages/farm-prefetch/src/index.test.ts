import { describe, expect, it, vi } from "vitest";
import { prefetch } from "./index.js";

describe("prefetch Farm plugin", () => {
  it("sends the resolved options to the browser", () => {
    const plugin = prefetch({ mode: "viewport", deny: ["/admin/[...rest]"] });

    expect(plugin.name).toBe("farm:prefetch");
    expect(plugin.client?.public).toEqual({
      mode: "viewport",
      intentDelayMs: 50,
      allow: [],
      deny: ["/admin/[...rest]"],
    });
  });

  it("fills the defaults when no options are given", () => {
    expect(prefetch().client?.public).toEqual({
      mode: "intent",
      intentDelayMs: 50,
      allow: [],
      deny: [],
    });
  });

  it("fails at config time for invalid options", () => {
    expect(() => prefetch({ mode: "hover" } as never)).toThrow("[farm:prefetch] Invalid options");
  });

  it("starts the runtime on the framework router and closes it", async () => {
    document.body.innerHTML = `<a href="/about" data-farm-prefetch="render">About</a>`;
    const plugin = prefetch({ mode: "none" });
    const router = { navigate: vi.fn(), prefetch: vi.fn(async () => {}) };

    const client = plugin.client;
    if (!client?.setup || !client.close) throw new Error("prefetch() must define client hooks");
    const runtime = await (client.setup as Function)({ public: client.public, router });
    await Promise.resolve();
    await Promise.resolve();

    expect(router.prefetch).toHaveBeenCalledWith("/about");
    expect(typeof runtime.close).toBe("function");
    (client.close as Function)({ state: runtime });
    document.body.innerHTML = "";
  });

  it("rejects a second prefetch() instance", () => {
    const first = prefetch();
    const second = prefetch();

    expect(() => first.configure?.({ plugins: [first, second] } as never, {} as never)).toThrow(
      "registered more than once",
    );
    expect(() => first.configure?.({ plugins: [first] } as never, {} as never)).not.toThrow();
  });
});
