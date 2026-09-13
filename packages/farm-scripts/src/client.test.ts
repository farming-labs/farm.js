import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ScriptConsentRequiredError,
  ScriptGlobalMissingError,
  ScriptTimeoutError,
  defineScript,
  getScriptConsent,
  grantScriptConsent,
  setScriptConsent,
  startScriptRuntime,
} from "./client.js";

const STORE = Symbol.for("@farm.js/scripts.browser-store");

function register<T>(handle: ReturnType<typeof defineScript<T>>) {
  return startScriptRuntime([handle.definition], window);
}

function script(name: string): HTMLScriptElement | null {
  return document.querySelector(`script[data-farm-script="${name}"]`);
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Farm Scripts browser runtime", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, STORE);
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as any).SupportChat;
    delete (window as any).Demo;
    Reflect.deleteProperty(window, STORE);
  });

  it("loads once and gives use() the vendor global with its declared type", async () => {
    interface SupportChat {
      load(options: { user: string }): boolean;
    }
    const supportChat = defineScript<SupportChat>({
      name: "support-chat",
      src: "https://cdn.example.test/chat.js",
      global: "SupportChat",
      load: "manual",
    });
    register(supportChat);

    const first = supportChat.load();
    const second = supportChat.load();
    expect(document.querySelectorAll("script[data-farm-script]")).toHaveLength(1);
    (window as any).SupportChat = { load: vi.fn(() => true) };
    script("support-chat")?.dispatchEvent(new Event("load"));

    await expect(first).resolves.toBe((window as any).SupportChat);
    await expect(second).resolves.toBe((window as any).SupportChat);
    const result = supportChat.use((sdk) => sdk.load({ user: "Ada" }));
    expectTypeOf(result).toEqualTypeOf<Promise<boolean>>();
    await expect(result).resolves.toBe(true);
    expect(supportChat.status).toBe("ready");
  });

  it("applies Farm's base path to app-local scripts", async () => {
    const local = defineScript({ name: "local", src: "/vendor/local.js", load: "manual" });
    startScriptRuntime([local.definition], window, "/dashboard/");

    const loading = local.load();
    expect(script("local")?.getAttribute("src")).toBe("/dashboard/vendor/local.js");
    script("local")?.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBeUndefined();
  });

  it("waits for explicit consent and begins a triggered load when consent is granted", async () => {
    const analytics = defineScript({
      name: "analytics",
      src: "/analytics.js",
      consent: "analytics",
      load: "immediate",
    });
    register(analytics);

    expect(analytics.status).toBe("blocked");
    expect(script("analytics")).toBeNull();
    await expect(analytics.load()).rejects.toBeInstanceOf(ScriptConsentRequiredError);
    expect(getScriptConsent("analytics")).toBe("unknown");

    grantScriptConsent("analytics");
    expect(getScriptConsent("analytics")).toBe("granted");
    expect(script("analytics")).not.toBeNull();
    script("analytics")?.dispatchEvent(new Event("load"));
    await settle();
    expect(analytics.status).toBe("ready");
  });

  it.each(["denied", "unknown"] as const)(
    "blocks a dependency-delayed script when consent becomes %s and resumes after a new grant",
    async (consent) => {
      vi.useFakeTimers();
      const vendor = defineScript({ name: "vendor", src: "/vendor.js", load: "manual" });
      const extension = defineScript({
        name: "extension",
        src: "/extension.js",
        load: "manual",
        consent: "analytics",
        dependsOn: [vendor],
      });
      const runtime = startScriptRuntime([vendor.definition, extension.definition], window);
      grantScriptConsent("analytics");
      const loading = extension.load().catch((error) => error);
      expect(script("vendor")).not.toBeNull();
      expect(script("extension")).toBeNull();

      setScriptConsent("analytics", consent);
      script("vendor")!.dispatchEvent(new Event("load"));
      await vi.advanceTimersByTimeAsync(0);

      expect(script("extension")).toBeNull();
      expect(await loading).toBeInstanceOf(ScriptConsentRequiredError);
      expect(extension.status).toBe("blocked");

      grantScriptConsent("analytics");
      await vi.advanceTimersByTimeAsync(0);
      expect(script("extension")).not.toBeNull();
      script("extension")!.dispatchEvent(new Event("load"));
      await expect(extension.load()).resolves.toBeUndefined();
      expect(extension.status).toBe("ready");
      runtime.close();
    },
  );

  it("does not retry a script after consent is withdrawn during the retry delay", async () => {
    vi.useFakeTimers();
    const analytics = defineScript({
      name: "analytics",
      src: "/analytics.js",
      load: "manual",
      consent: "analytics",
      retries: 1,
      retryDelay: 250,
    });
    const runtime = register(analytics);
    grantScriptConsent("analytics");
    const loading = analytics.load().catch((error) => error);
    script("analytics")!.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(0);
    setScriptConsent("analytics", "denied");
    await vi.advanceTimersByTimeAsync(250);

    expect(script("analytics")).toBeNull();
    expect(await loading).toBeInstanceOf(ScriptConsentRequiredError);
    expect(analytics.status).toBe("blocked");

    grantScriptConsent("analytics");
    expect(script("analytics")).not.toBeNull();
    script("analytics")!.dispatchEvent(new Event("load"));
    await expect(analytics.load()).resolves.toBeUndefined();
    runtime.close();
  });

  it("does not start another dependency after the parent script loses consent", async () => {
    vi.useFakeTimers();
    const first = defineScript({ name: "first", src: "/first.js", load: "manual" });
    const second = defineScript({ name: "second", src: "/second.js", load: "manual" });
    const analytics = defineScript({
      name: "analytics",
      src: "/analytics.js",
      load: "manual",
      consent: "analytics",
      dependsOn: [first, second],
    });
    const runtime = startScriptRuntime(
      [first.definition, second.definition, analytics.definition],
      window,
    );
    grantScriptConsent("analytics");
    const loading = analytics.load().catch((error) => error);
    setScriptConsent("analytics", "denied");
    script("first")!.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(0);

    expect(script("second")).toBeNull();
    expect(script("analytics")).toBeNull();
    expect(await loading).toBeInstanceOf(ScriptConsentRequiredError);
    expect(analytics.status).toBe("blocked");
    runtime.close();
  });

  it("rechecks consent after a loading status listener withdraws it", async () => {
    const analytics = defineScript({
      name: "analytics",
      src: "/analytics.js",
      load: "manual",
      consent: "analytics",
      retries: 1,
    });
    const runtime = register(analytics);
    grantScriptConsent("analytics");
    const unsubscribe = analytics.subscribe(({ status, attempt }) => {
      if (status === "loading" && attempt === 1) setScriptConsent("analytics", "denied");
    });
    const loading = analytics.load().catch((error) => error);
    expect(script("analytics")).toBeNull();
    expect(await loading).toBeInstanceOf(ScriptConsentRequiredError);
    expect(analytics.status).toBe("blocked");
    unsubscribe();
    runtime.close();
  });

  it("does not unload an already ready script when consent is withdrawn", async () => {
    const analytics = defineScript({
      name: "analytics",
      src: "/analytics.js",
      load: "manual",
      consent: "analytics",
    });
    const runtime = register(analytics);
    grantScriptConsent("analytics");
    const loading = analytics.load();
    const element = script("analytics")!;
    element.dispatchEvent(new Event("load"));
    await loading;
    setScriptConsent("analytics", "denied");
    await expect(analytics.load()).resolves.toBeUndefined();
    expect(script("analytics")).toBe(element);
    expect(analytics.status).toBe("ready");
    runtime.close();
  });

  it("supports hydration, interaction, and side-effect-only loading strategies", async () => {
    const hydrated = defineScript({
      name: "hydrated",
      src: "/hydrated.js",
      load: "after-hydration",
    });
    const interacted = defineScript({
      name: "interacted",
      src: "/interacted.js",
      load: "interaction",
    });
    const runtime = startScriptRuntime([hydrated.definition, interacted.definition], window);

    expect(script("hydrated")).toBeNull();
    runtime.afterHydration();
    expect(script("hydrated")).not.toBeNull();
    script("hydrated")?.dispatchEvent(new Event("load"));

    expect(script("interacted")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(script("interacted")).not.toBeNull();
    script("interacted")?.dispatchEvent(new Event("load"));
    await settle();

    expect(hydrated.status).toBe("ready");
    expect(interacted.status).toBe("ready");
    runtime.close();
  });

  it("uses independent observers for visible scripts with different margins", async () => {
    const observers: MockIntersectionObserver[] = [];
    class MockIntersectionObserver {
      readonly observed: Element[] = [];
      constructor(
        readonly callback: IntersectionObserverCallback,
        readonly options?: IntersectionObserverInit,
      ) {
        observers.push(this);
      }
      observe(element: Element) {
        this.observed.push(element);
      }
      unobserve(element: Element) {
        this.observed.splice(this.observed.indexOf(element), 1);
      }
      disconnect() {
        this.observed.length = 0;
      }
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [];
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    document.body.innerHTML = '<div id="chat"></div><div id="map"></div>';
    const chat = defineScript({
      name: "chat",
      src: "/chat.js",
      load: { when: "visible", selector: "#chat", rootMargin: "50px" },
    });
    const map = defineScript({
      name: "map",
      src: "/map.js",
      load: { when: "visible", selector: "#map", rootMargin: "300px" },
    });
    const runtime = startScriptRuntime([chat.definition, map.definition], window);
    await settle();

    expect(observers.map((observer) => observer.options?.rootMargin).sort()).toEqual([
      "300px",
      "50px",
    ]);
    const chatObserver = observers.find((observer) => observer.options?.rootMargin === "50px")!;
    const mapObserver = observers.find((observer) => observer.options?.rootMargin === "300px")!;
    const mapTarget = document.querySelector("#map")!;
    expect(mapObserver.observed).toContain(mapTarget);
    const mapLoading = map.load();
    expect(mapObserver.observed).not.toContain(mapTarget);
    script("map")?.dispatchEvent(new Event("load"));
    await expect(mapLoading).resolves.toBeUndefined();

    const target = document.querySelector("#chat")!;
    chatObserver.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      chatObserver as never,
    );
    expect(script("chat")).not.toBeNull();
    expect(script("map")).not.toBeNull();
    runtime.close();
  });

  it("loads dependencies first and reports status changes", async () => {
    const vendor = defineScript({ name: "vendor", src: "/vendor.js", load: "manual" });
    const extension = defineScript({
      name: "extension",
      src: "/extension.js",
      load: "manual",
      dependsOn: [vendor],
    });
    startScriptRuntime([vendor.definition, extension.definition], window);
    const states: string[] = [];
    const unsubscribe = extension.subscribe((snapshot) =>
      states.push(`${snapshot.status}:${snapshot.attempt}`),
    );

    const loading = extension.load();
    expect(script("vendor")).not.toBeNull();
    expect(script("extension")).toBeNull();
    script("vendor")?.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(script("extension")).not.toBeNull());
    script("extension")?.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBeUndefined();

    expect(states).toEqual(["idle:0", "loading:0", "loading:1", "ready:1"]);
    unsubscribe();
  });

  it("resumes a triggered dependency chain after consent is granted", async () => {
    const vendor = defineScript({
      name: "consented-vendor",
      src: "/consented-vendor.js",
      consent: "functional",
      load: "manual",
    });
    const widget = defineScript({
      name: "dependent-widget",
      src: "/dependent-widget.js",
      dependsOn: [vendor],
      load: "manual",
    });
    startScriptRuntime([vendor.definition, widget.definition], window);

    const loading = widget.load();
    await expect(loading).rejects.toBeInstanceOf(ScriptConsentRequiredError);
    expect(widget.status).toBe("blocked");

    grantScriptConsent("functional");
    await vi.waitFor(() => expect(script("consented-vendor")).not.toBeNull());
    script("consented-vendor")?.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(script("dependent-widget")).not.toBeNull());
    script("dependent-widget")?.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(widget.status).toBe("ready"));
  });

  it("starts idle scripts only from the idle callback", () => {
    let runIdle: (() => void) | undefined;
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: IdleRequestCallback) => {
        runIdle = () => callback({ didTimeout: false, timeRemaining: () => 20 });
        return 1;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const idle = defineScript({ name: "idle-sdk", src: "/idle-sdk.js", load: "idle" });
    startScriptRuntime([idle.definition], window);

    expect(script("idle-sdk")).toBeNull();
    runIdle?.();
    expect(script("idle-sdk")).not.toBeNull();
  });

  it("retries cleanly when a script fails or omits its configured global", async () => {
    const sdk = defineScript<{ ready: true }>({
      name: "demo-sdk",
      src: "/demo-sdk.js",
      global: "Demo.sdk",
      load: "manual",
      retries: 1,
      retryDelay: 0,
      readyTimeout: 0,
    });
    register(sdk);
    const loading = sdk.load();
    script("demo-sdk")?.dispatchEvent(new Event("load"));
    await vi.waitFor(() =>
      expect(document.querySelectorAll('script[data-farm-script="demo-sdk"]')).toHaveLength(1),
    );
    (window as any).Demo = { sdk: { ready: true } };
    script("demo-sdk")?.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toEqual({ ready: true });
    expect(sdk.status).toBe("ready");
  });

  it("returns a focused error when the loaded vendor global never appears", async () => {
    const sdk = defineScript({
      name: "missing-sdk",
      src: "/missing-sdk.js",
      global: "Demo.missing",
      load: "manual",
      readyTimeout: 0,
    });
    register(sdk);
    const loading = sdk.load();
    script("missing-sdk")?.dispatchEvent(new Event("load"));

    await expect(loading).rejects.toBeInstanceOf(ScriptGlobalMissingError);
    expect(sdk.status).toBe("error");
    expect(script("missing-sdk")).toBeNull();
  });

  it("times out a stalled network request and removes its element", async () => {
    vi.useFakeTimers();
    const stalled = defineScript({
      name: "stalled",
      src: "/stalled.js",
      load: "manual",
      timeout: 50,
    });
    register(stalled);
    const loading = stalled.load();
    const rejected = expect(loading).rejects.toBeInstanceOf(ScriptTimeoutError);
    await vi.advanceTimersByTimeAsync(50);

    await rejected;
    expect(stalled.status).toBe("error");
    expect(script("stalled")).toBeNull();
  });

  it("reports an invalid visible selector through the handle", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invalid = defineScript({
      name: "invalid-visible",
      src: "/invalid-visible.js",
      load: { when: "visible", selector: "[" },
    });
    startScriptRuntime([invalid.definition], window);
    await settle();

    expect(invalid.status).toBe("error");
    expect(invalid.error).toBeInstanceOf(TypeError);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("deduplicates preconnects and does not contact a consent origin early", async () => {
    const vendor = defineScript({
      name: "vendor",
      src: "https://cdn.example.test/vendor.js",
      preconnect: true,
      load: "manual",
    });
    const second = defineScript({
      name: "second",
      src: "https://cdn.example.test/second.js",
      preconnect: true,
      load: "manual",
    });
    const consented = defineScript({
      name: "consented",
      src: "https://private.example.test/sdk.js",
      consent: "marketing",
      preconnect: true,
      load: "manual",
    });
    startScriptRuntime([vendor.definition, second.definition, consented.definition], window);

    expect(document.querySelectorAll('link[rel="preconnect"]')).toHaveLength(1);
    grantScriptConsent("marketing");
    expect(document.querySelectorAll('link[href^="https://private.example.test"]')).toHaveLength(0);
    const loading = consented.load();
    expect(document.querySelectorAll('link[href^="https://private.example.test"]')).toHaveLength(1);
    script("consented")?.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBeUndefined();
    expect(() => setScriptConsent("", "granted")).toThrow("non-empty string");
    expect(() => setScriptConsent("analytics", "maybe" as never)).toThrow("consent state");
  });
});
