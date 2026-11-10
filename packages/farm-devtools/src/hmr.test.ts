import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { startDevtoolsUpdates } from "./hmr.js";

describe("DevTools HMR bridge", () => {
  it("uses existing HMR events and removes listeners on disposal", () => {
    const dom = new JSDOM('<div id="__farm_devtools_overlay__"><iframe></iframe></div>', {
      url: "http://localhost:3000",
    });
    const messages = vi.spyOn(
      dom.window.document.querySelector("iframe")!.contentWindow!,
      "postMessage",
    );
    const listeners = new Map<string, () => void>();
    const hot = {
      on: (event: string, listener: () => void) => {
        listeners.set(event, listener);
      },
      off: (event: string) => {
        listeners.delete(event);
      },
      dispose: vi.fn(),
    };
    const runtime = startDevtoolsUpdates(dom.window as unknown as Window, hot);
    for (const [event, state] of [
      ["vite:beforeUpdate", "pending"],
      ["vite:afterUpdate", "ready"],
      ["vite:error", "error"],
      ["vite:ws:disconnect", "disconnected"],
      ["vite:ws:connect", "ready"],
    ]) {
      listeners.get(event)!();
      expect(messages).toHaveBeenLastCalledWith(
        { type: "farm:devtools:hmr", state },
        "http://localhost:3000",
      );
    }
    dom.window.document.querySelector("iframe")!.remove();
    expect(() => listeners.get("vite:afterUpdate")!()).not.toThrow();
    runtime.dispose();
    expect(listeners.size).toBe(0);
    expect(hot.dispose).toHaveBeenCalledWith(runtime.dispose);
    dom.window.close();
  });
  it("is inert without HMR", () => {
    const dom = new JSDOM("<body></body>");
    expect(() => startDevtoolsUpdates(dom.window as unknown as Window).dispose()).not.toThrow();
    dom.window.close();
  });
});
