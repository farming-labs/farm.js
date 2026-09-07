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

  it("keeps sibling interaction queues and replay boundary-local", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="first"><button type="button">First</button></div>
      <div id="second"><button type="button">Second</button></div>
    `;
    const first = document.getElementById("first")!;
    const second = document.getElementById("second")!;
    const firstButton = first.querySelector("button")!;
    const secondButton = second.querySelector("button")!;
    const handled = { first: 0, second: 0 };
    const hydrateFirst = vi.fn(() => firstButton.addEventListener("click", () => handled.first++));
    const hydrateSecond = vi.fn(() =>
      secondButton.addEventListener("click", () => handled.second++),
    );
    const firstScheduled = scheduleFarmIslandHydration({
      container: first,
      strategy: "interaction",
      hydrate: hydrateFirst,
    });
    const secondScheduled = scheduleFarmIslandHydration({
      container: second,
      strategy: "interaction",
      hydrate: hydrateSecond,
    });

    firstButton.click();
    await firstScheduled;
    await vi.runAllTimersAsync();

    expect(hydrateFirst).toHaveBeenCalledOnce();
    expect(hydrateSecond).not.toHaveBeenCalled();
    expect(handled).toEqual({ first: 1, second: 0 });

    secondButton.click();
    await secondScheduled;
    await vi.runAllTimersAsync();
    expect(hydrateSecond).toHaveBeenCalledOnce();
    expect(handled).toEqual({ first: 1, second: 1 });
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

    await scheduled;

    expect(queue).toHaveLength(0);
    await vi.runAllTimersAsync();
    expect(handledClicks).toBe(1);
  });

  it("hydrates and replays non-HTML ARIA button interactions", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<div id="island"><svg role="button" tabindex="0"><circle /></svg></div>';
    const container = document.getElementById("island")!;
    const button = container.querySelector("svg")!;
    let handledClicks = 0;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () => button.addEventListener("click", () => handledClicks++),
    });

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await scheduled;
    await vi.runAllTimersAsync();

    expect(handledClicks).toBe(1);
  });

  it("cancels a deferred boundary without hydrating it", async () => {
    const controller = new AbortController();
    const hydrate = vi.fn();
    const container = document.getElementById("island")!;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      signal: controller.signal,
      hydrate,
    });

    controller.abort();

    await expect(scheduled).resolves.toBeUndefined();
    container.querySelector("button")!.click();
    expect(hydrate).not.toHaveBeenCalled();
  });

  it("does not finish or replay an in-flight hydration after cancellation", async () => {
    const controller = new AbortController();
    const container = document.getElementById("island")!;
    const button = container.querySelector("button")!;
    let finishHydrate!: () => void;
    const hydrate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHydrate = resolve;
        }),
    );
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      signal: controller.signal,
      hydrate,
    });

    button.click();
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledOnce());
    controller.abort();
    await expect(scheduled).resolves.toBeUndefined();
    finishHydrate();
    await Promise.resolve();

    expect(container.hasAttribute("data-farm-island-hydrated")).toBe(false);
  });

  it("does not replay a queued interaction into a removed boundary", async () => {
    vi.useFakeTimers();
    const container = document.getElementById("island")!;
    const button = container.querySelector("button")!;
    let handledClicks = 0;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () => button.addEventListener("click", () => handledClicks++),
    });

    button.click();
    await scheduled;
    container.remove();
    await vi.runAllTimersAsync();

    expect(handledClicks).toBe(0);
  });

  it("does not replay a queued interaction after hydration is invalidated", async () => {
    vi.useFakeTimers();
    const container = document.getElementById("island")!;
    const button = container.querySelector("button")!;
    let handledClicks = 0;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () => button.addEventListener("click", () => handledClicks++),
    });

    button.click();
    await scheduled;
    container.removeAttribute("data-farm-island-hydrated");
    await vi.runAllTimersAsync();

    expect(handledClicks).toBe(0);
  });

  it("cleans every deferred trigger and queued target when boundaries are removed", async () => {
    document.body.innerHTML = `
      <div id="visible"><button type="button">Visible</button></div>
      <div id="idle"><button type="button">Idle</button></div>
      <div id="interaction"><button type="button">Interaction</button></div>
    `;
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
    let notifyIdle: (() => void) | undefined;
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: () => void) => {
        notifyIdle = callback;
        return 9;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);

    const visible = document.getElementById("visible")!;
    const idle = document.getElementById("idle")!;
    const interaction = document.getElementById("interaction")!;
    const hydrateVisible = vi.fn();
    const hydrateIdle = vi.fn();
    const hydrateInteraction = vi.fn();
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const scheduled = [
      scheduleFarmIslandHydration({
        container: visible,
        strategy: "visible",
        signal: controllers[0].signal,
        hydrate: hydrateVisible,
      }),
      scheduleFarmIslandHydration({
        container: idle,
        strategy: "idle",
        signal: controllers[1].signal,
        hydrate: hydrateIdle,
      }),
      scheduleFarmIslandHydration({
        container: interaction,
        strategy: "interaction",
        signal: controllers[2].signal,
        hydrate: hydrateInteraction,
      }),
    ];
    const queue = [
      { target: visible.querySelector("button") },
      { target: idle.querySelector("button") },
      { target: interaction.querySelector("button") },
    ];
    Object.assign(window, { __FARM_PREHYDRATION_CLICK_QUEUE__: queue });

    for (const controller of controllers) controller.abort();
    await Promise.all(scheduled);
    notifyVisibility?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    notifyIdle?.();
    interaction.querySelector<HTMLButtonElement>("button")!.click();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelIdleCallback).toHaveBeenCalledWith(9);
    expect(queue).toHaveLength(0);
    expect(hydrateVisible).not.toHaveBeenCalled();
    expect(hydrateIdle).not.toHaveBeenCalled();
    expect(hydrateInteraction).not.toHaveBeenCalled();
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
