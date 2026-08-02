import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleFarmIslandHydration } from "../client/island-runtime";

describe("scheduleFarmIslandHydration", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="island"><button type="button">Copy</button></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as typeof window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown })
      .__FARM_PREHYDRATION_CLICK_QUEUE__;
    document.body.innerHTML = "";
  });

  it("hydrates load boundaries immediately", async () => {
    const hydrate = vi.fn(() => "hydrated");
    const container = document.getElementById("island")!;

    await expect(scheduleFarmIslandHydration({ container, strategy: null, hydrate })).resolves.toBe(
      "hydrated",
    );
    expect(hydrate).toHaveBeenCalledOnce();
  });

  it("waits for visibility before hydrating visible boundaries", async () => {
    let notifyVisibility: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          notifyVisibility = callback;
        }
        observe() {}
        disconnect() {
          disconnect();
        }
      },
    );
    const hydrate = vi.fn(() => "visible");
    const container = document.getElementById("island")!;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "visible",
      hydrate,
    });

    expect(hydrate).not.toHaveBeenCalled();
    notifyVisibility?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    await expect(scheduled).resolves.toBe("visible");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("hydrates interaction boundaries and replays their first button click", async () => {
    vi.useFakeTimers();
    const container = document.getElementById("island")!;
    const button = container.querySelector("button")!;
    let handledClicks = 0;
    const hydrate = vi.fn(() => {
      button.addEventListener("click", () => handledClicks++);
    });
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate,
    });

    button.click();
    await scheduled;
    expect(hydrate).toHaveBeenCalledOnce();
    expect(handledClicks).toBe(0);

    await vi.runAllTimersAsync();
    expect(handledClicks).toBe(1);
  });

  it("claims and replays clicks captured by the inline pre-hydration queue", async () => {
    vi.useFakeTimers();
    const container = document.getElementById("island")!;
    const button = container.querySelector("button")!;
    const queue = [{ target: button }];
    Object.assign(window, { __FARM_PREHYDRATION_CLICK_QUEUE__: queue });
    let handledClicks = 0;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () => button.addEventListener("click", () => handledClicks++),
    });

    document.dispatchEvent(
      new CustomEvent("farm:island-interaction", { detail: { target: button } }),
    );
    await scheduled;

    expect(queue).toHaveLength(0);
    await vi.runAllTimersAsync();
    expect(handledClicks).toBe(1);
  });

  it("uses idle scheduling with a timeout", async () => {
    let idleCallback: (() => void) | undefined;
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: () => void) => {
        idleCallback = callback;
        return 7;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    const hydrate = vi.fn(() => "idle");
    const container = document.getElementById("island")!;
    const scheduled = scheduleFarmIslandHydration({ container, strategy: "idle", hydrate });

    expect(hydrate).not.toHaveBeenCalled();
    idleCallback?.();

    await expect(scheduled).resolves.toBe("idle");
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });
});
