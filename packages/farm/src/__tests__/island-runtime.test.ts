import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  holdFarmIslandInteractions,
  scheduleFarmIslandHydration,
  watchFarmIslandTriggers,
} from "../client/island-runtime";

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
        unobserve() {}
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
      [{ isIntersecting: true, target: container.firstElementChild } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    await expect(scheduled).resolves.toBe("visible");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("observes the children of a boxless boundary container", async () => {
    // Isolated boundary markers render with display:contents, so the marker
    // itself never produces a client rect and can never intersect (#565 e2e).
    const observed: Element[] = [];
    let notifyVisibility: IntersectionObserverCallback | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          notifyVisibility = callback;
        }
        observe(target: Element) {
          observed.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    document.body.innerHTML =
      '<f-island id="boundary" style="display:contents"><button type="button">Reveal</button></farm-client-boundary>';
    const container = document.getElementById("boundary")!;
    const hydrate = vi.fn(() => "visible");
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "visible",
      hydrate,
    });

    expect(observed).toEqual([container.querySelector("button")]);
    expect(hydrate).not.toHaveBeenCalled();
    notifyVisibility?.(
      [{ isIntersecting: true, target: container.firstElementChild } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await expect(scheduled).resolves.toBe("visible");
  });

  it("hydrates a visible boundary with no observable children immediately", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    document.body.innerHTML =
      '<f-island id="boundary" style="display:contents"></farm-client-boundary>';
    const container = document.getElementById("boundary")!;
    const hydrate = vi.fn(() => "visible");

    await expect(
      scheduleFarmIslandHydration({ container, strategy: "visible", hydrate }),
    ).resolves.toBe("visible");
    expect(hydrate).toHaveBeenCalledOnce();
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

  it("replays every click made while an interaction boundary hydrates, in order", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<div id="island"><button type="button" id="add">Add</button><button type="button" id="undo">Undo</button></div>';
    const container = document.getElementById("island")!;
    const add = document.getElementById("add")!;
    const undo = document.getElementById("undo")!;
    const handled: string[] = [];
    let finishHydrate!: () => void;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () =>
        new Promise<void>((resolve) => {
          finishHydrate = () => {
            add.addEventListener("click", () => handled.push("add"));
            undo.addEventListener("click", () => handled.push("undo"));
            resolve();
          };
        }),
    });

    add.click();
    add.click();
    undo.click();
    await vi.advanceTimersByTimeAsync(0);
    finishHydrate();
    await scheduled;
    await vi.runAllTimersAsync();
    expect(handled).toEqual(["add", "add", "undo"]);
  });

  // Server HTML is on screen before its island hydrates, so a click on it then would do nothing.
  for (const strategy of ["load", "idle", "visible"] as const) {
    it(`replays every click made while a ${strategy} boundary hydrates, and starts it on one`, async () => {
      vi.useFakeTimers();
      // Never in view: only the click starts a visible boundary.
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      const container = document.getElementById("island")!;
      const button = container.querySelector("button")!;
      let handledClicks = 0;
      let finishHydrate!: () => void;
      const hydrate = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishHydrate = () => {
              button.addEventListener("click", () => handledClicks++);
              resolve();
            };
          }),
      );
      const scheduled = scheduleFarmIslandHydration({ container, strategy, hydrate });

      button.click();
      button.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(hydrate).toHaveBeenCalledOnce();
      finishHydrate();
      await scheduled;
      await vi.runAllTimersAsync();
      expect(handledClicks).toBe(2);
    });
  }

  it("submits a form once when its submit button is clicked twice before hydration", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<div id="island"><form><button type="submit">Save</button></form></div>';
    const container = document.getElementById("island")!;
    const button = container.querySelector("button")!;
    let finishHydrate!: () => void;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () => new Promise<void>((resolve) => (finishHydrate = resolve)),
    });
    let submits = 0;
    container.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      submits++;
    });

    button.click();
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(submits).toBe(0);
    finishHydrate();
    await scheduled;
    await vi.runAllTimersAsync();
    expect(submits).toBe(1);
  });

  it("replays a click the boot script queued and announced once, not once per record", async () => {
    vi.useFakeTimers();
    const container = document.getElementById("island")!;
    const button = container.querySelector("button")!;
    const queue: Array<{ target: Element; kind: string }> = [];
    Object.assign(window, { __FARM_PREHYDRATION_CLICK_QUEUE__: queue });
    let handledClicks = 0;
    let finishHydrate!: () => void;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () =>
        new Promise<void>((resolve) => {
          finishHydrate = () => {
            button.addEventListener("click", () => handledClicks++);
            resolve();
          };
        }),
    });

    // What the boot script does for each click it holds: queue it, then announce it.
    for (let index = 0; index < 2; index++) {
      queue.push({ target: button, kind: "click" });
      document.dispatchEvent(
        new CustomEvent("farm:island-interaction", { detail: { target: button, kind: "click" } }),
      );
    }
    await vi.advanceTimersByTimeAsync(0);
    finishHydrate();
    await scheduled;
    await vi.runAllTimersAsync();
    expect(handledClicks).toBe(2);
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
        unobserve() {}
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
      [{ isIntersecting: true, target: visible.firstElementChild } as IntersectionObserverEntry],
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

describe("holdFarmIslandInteractions", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (window as typeof window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown })
      .__FARM_PREHYDRATION_CLICK_QUEUE__;
    document.body.innerHTML = "";
  });

  // Islands mode's entry holds these while islx loads (RFC 0010); no scheduler runs yet.
  it("holds clicks on islands that have not hydrated until their scheduler replays them", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <f-island id="waiting"><button type="button">Count</button></f-island>
      <f-island data-farm-island-hydrated="true"><button type="button">Hydrated</button></f-island>
      <button type="button" id="outside">Outside</button>`;
    const container = document.getElementById("waiting")!;
    const button = container.querySelector("button")!;
    const hydratedButton = document.querySelector("[data-farm-island-hydrated] button")!;
    const outside = document.getElementById("outside")!;
    const seen: string[] = [];
    document.addEventListener("click", (event) => {
      seen.push((event.target as Element).textContent ?? "");
    });

    const release = holdFarmIslandInteractions("f-island");
    button.click();
    button.click();
    hydratedButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    outside.click();
    release();
    // Once released, a click reaches the page again.
    outside.click();
    expect(seen).toEqual(["Hydrated", "Outside", "Outside"]);

    let handledClicks = 0;
    const scheduled = scheduleFarmIslandHydration({
      container,
      strategy: "interaction",
      hydrate: () => {
        button.addEventListener("click", () => handledClicks++);
      },
    });
    await scheduled;
    await vi.runAllTimersAsync();
    expect(handledClicks).toBe(2);
  });

  it("holds a form's submit once", () => {
    document.body.innerHTML = `<f-island><form><input name="q"></form></f-island>`;
    const form = document.querySelector("form")!;
    const release = holdFarmIslandInteractions("f-island");
    const first = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(first);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    release();

    expect(first.defaultPrevented).toBe(true);
    const queue = (window as typeof window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown[] })
      .__FARM_PREHYDRATION_CLICK_QUEUE__;
    expect(queue).toEqual([{ target: form, kind: "submit" }]);
  });
});

describe("watchFarmIslandTriggers", () => {
  const queue = () =>
    ((
      window as typeof window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown[] }
    ).__FARM_PREHYDRATION_CLICK_QUEUE__ ??= []);

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as typeof window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown })
      .__FARM_PREHYDRATION_CLICK_QUEUE__;
    document.body.innerHTML = "";
  });

  it("finds an island due at once when it hydrates at load, or has no strategy", () => {
    for (const attribute of ['strategy="load"', ""]) {
      document.body.innerHTML = `<f-island strategy="interaction"></f-island><f-island ${attribute}><button>A</button></f-island>`;
      const due = vi.fn();
      expect(watchFarmIslandTriggers(document, "f-island", due)).toBeNull();
      expect(due).not.toHaveBeenCalled();
    }
  });

  it("finds an island due at once when it holds a click", () => {
    document.body.innerHTML = '<f-island strategy="interaction"><button>A</button></f-island>';
    queue().push({ target: document.querySelector("button"), kind: "click" });
    expect(watchFarmIslandTriggers(document, "f-island", vi.fn())).toBeNull();
  });

  it("finds islands due at once while a Suspense boundary waits for the browser", () => {
    for (const marker of ["$?", "$!"]) {
      document.body.innerHTML = `<!--${marker}--><f-island strategy="interaction"></f-island>`;
      expect(watchFarmIslandTriggers(document, "f-island", vi.fn())).toBeNull();
    }
  });

  it("follows an outer island's strategy, not one inside it", () => {
    document.body.innerHTML =
      '<f-island strategy="interaction"><f-island strategy="load"></f-island></f-island>';
    expect(watchFarmIslandTriggers(document, "f-island", vi.fn())).toBeTypeOf("function");
  });

  it("calls `due` once on a press or focus inside a waiting island, and stops watching", () => {
    document.body.innerHTML =
      '<f-island strategy="interaction"><button>A</button></f-island><button id="outside">B</button>';
    const due = vi.fn();
    const stop = watchFarmIslandTriggers(document, "f-island", due);
    expect(stop).toBeTypeOf("function");
    document.getElementById("outside")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(due).not.toHaveBeenCalled();
    const button = document.querySelector("f-island button")!;
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(due).toHaveBeenCalledOnce();
  });

  it("calls `due` on a held click it is told about", () => {
    document.body.innerHTML = '<f-island strategy="interaction"><button>A</button></f-island>';
    const due = vi.fn();
    watchFarmIslandTriggers(document, "f-island", due);
    document.dispatchEvent(
      new CustomEvent("farm:island-interaction", {
        detail: { target: document.querySelector("button"), kind: "click" },
      }),
    );
    expect(due).toHaveBeenCalledOnce();
  });

  it("leaves a press on a link that navigates alone, as the scheduler does", () => {
    document.body.innerHTML =
      '<f-island strategy="interaction"><a href="/next">Next</a><a href="#part">Part</a></f-island>';
    const due = vi.fn();
    watchFarmIslandTriggers(document, "f-island", due);
    document
      .querySelector('a[href="/next"]')!
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(due).not.toHaveBeenCalled();
    document
      .querySelector('a[href="#part"]')!
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(due).toHaveBeenCalledOnce();
  });

  it("calls `due` when a form is touched, which islx posts without a page load", () => {
    document.body.innerHTML =
      '<f-island strategy="interaction"></f-island><form><input name="q" /></form>';
    const due = vi.fn();
    watchFarmIslandTriggers(document, "f-island", due);
    document.querySelector("input")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(due).toHaveBeenCalledOnce();
  });

  it("watches only its scope", () => {
    document.body.innerHTML =
      '<main><f-island strategy="interaction"><button>A</button></f-island></main><f-island strategy="interaction"><button>B</button></f-island>';
    const due = vi.fn();
    watchFarmIslandTriggers(document.querySelector("main")!, "f-island", due);
    document
      .querySelectorAll("button")[1]!
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(due).not.toHaveBeenCalled();
    document
      .querySelectorAll("button")[0]!
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(due).toHaveBeenCalledOnce();
  });

  it("calls `due` when an idle island's idle callback runs", () => {
    let idle: (() => void) | undefined;
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => ((idle = callback), 1));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    document.body.innerHTML =
      '<f-island strategy="idle"></f-island><f-island strategy="idle"></f-island>';
    const due = vi.fn();
    expect(watchFarmIslandTriggers(document, "f-island", due)).toBeTypeOf("function");
    expect(due).not.toHaveBeenCalled();
    idle?.();
    expect(due).toHaveBeenCalledOnce();
  });

  it("calls `due` when a visible island's children come into view", () => {
    const observed: Element[] = [];
    let notify: IntersectionObserverCallback | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe(target: Element) {
          observed.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    document.body.innerHTML = '<f-island strategy="visible"><p>Below</p></f-island>';
    const due = vi.fn();
    expect(watchFarmIslandTriggers(document, "f-island", due)).toBeTypeOf("function");
    expect(observed).toEqual([document.querySelector("p")]);
    notify?.(
      [{ isIntersecting: true, target: observed[0] } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(due).toHaveBeenCalledOnce();
  });

  it("finds a visible island with nothing to observe due at once", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    document.body.innerHTML = '<f-island strategy="visible"></f-island>';
    expect(watchFarmIslandTriggers(document, "f-island", vi.fn())).toBeNull();
  });

  it("stops every trigger when stopped", () => {
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", () => 7);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    document.body.innerHTML =
      '<f-island strategy="idle"></f-island><f-island strategy="interaction"><button>A</button></f-island>';
    const due = vi.fn();
    watchFarmIslandTriggers(document, "f-island", due)!();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    document.querySelector("button")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(due).not.toHaveBeenCalled();
  });
});
