import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScriptNotRegisteredError,
  defineScript,
  getScriptConsent,
  grantScriptConsent,
  startScriptRuntime,
} from "./client.js";

const STORE = Symbol.for("@farm.js/scripts.browser-store");

function script(name: string): HTMLScriptElement | null {
  return document.querySelector(`script[data-farm-script="${name}"]`);
}

describe("Farm Scripts runtime replacement (HMR)", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, STORE);
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).Analytics;
    Reflect.deleteProperty(window, STORE);
  });

  it("re-registers a changed definition after the owning runtime closes", async () => {
    const before = defineScript({
      name: "analytics",
      src: "https://cdn.example.test/analytics-v1.js",
      load: "manual",
    });
    const first = startScriptRuntime([before.definition], window);
    first.close();

    // The HMR successor carries the edited configuration. This threw
    // "conflicting options" before closed runtimes released their entries.
    const after = defineScript({
      name: "analytics",
      src: "https://cdn.example.test/analytics-v2.js",
      load: "manual",
    });
    const second = startScriptRuntime([after.definition], window);

    void after.load().catch(() => {});
    expect(script("analytics")?.getAttribute("src")).toBe(
      "https://cdn.example.test/analytics-v2.js",
    );
    second.close();
  });

  it("still rejects conflicting definitions between live runtimes", () => {
    const original = defineScript({
      name: "analytics",
      src: "https://cdn.example.test/analytics-v1.js",
      load: "manual",
    });
    const runtime = startScriptRuntime([original.definition], window);

    // The first runtime is still live, so this is a real application error.
    // defineScript registers into the live store, so the conflict already
    // fires there — earlier than runtime start, which is even better.
    expect(() =>
      defineScript({
        name: "analytics",
        src: "https://cdn.example.test/analytics-v2.js",
        load: "manual",
      }),
    ).toThrow(/conflicting options/);
    runtime.close();
  });

  it("stops loading a definition no runtime owns any more", async () => {
    const removed = defineScript({
      name: "analytics",
      src: "https://cdn.example.test/analytics.js",
      load: "manual",
    });
    const runtime = startScriptRuntime([removed.definition], window);
    runtime.close();

    // The definition was removed from the configuration; its entry must not
    // stay loadable through a stale handle.
    await expect(removed.load()).rejects.toBeInstanceOf(ScriptNotRegisteredError);
    expect(script("analytics")).toBeNull();
  });

  it("keeps an unchanged script's loaded state across the swap", async () => {
    const handle = defineScript<{ track(): void }>({
      name: "analytics",
      src: "https://cdn.example.test/analytics.js",
      global: "Analytics",
      load: "manual",
    });
    const first = startScriptRuntime([handle.definition], window);

    const loading = handle.load();
    (window as any).Analytics = { track: vi.fn() };
    script("analytics")?.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBe((window as any).Analytics);

    first.close();
    const second = startScriptRuntime([handle.definition], window);

    // Same definition: the ready state and injected element are reused, not
    // loaded a second time.
    await expect(handle.load()).resolves.toBe((window as any).Analytics);
    expect(document.querySelectorAll("script[data-farm-script]")).toHaveLength(1);
    second.close();
  });

  it("keeps consent decisions across the swap", () => {
    const gated = defineScript({
      name: "analytics",
      src: "https://cdn.example.test/analytics.js",
      load: "manual",
      consent: "analytics",
    });
    const first = startScriptRuntime([gated.definition], window);
    grantScriptConsent("analytics");
    first.close();

    const second = startScriptRuntime([gated.definition], window);
    // Consent belongs to the visitor, not to a runtime instance.
    expect(getScriptConsent("analytics")).toBe("granted");
    second.close();
  });
});
