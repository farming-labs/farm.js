import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleFarmIslandHydration } from "../client/island-runtime";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("preserves native capture listener ordering between island registrations", async () => {
  document.body.innerHTML = '<div id="first"></div><div id="second"><button>Run</button></div>';
  const controller = new AbortController();
  const hydrate = vi.fn();
  const first = scheduleFarmIslandHydration({
    container: document.getElementById("first")!,
    strategy: "interaction",
    signal: controller.signal,
    hydrate,
  });
  const intercept = vi.fn((event: Event) => event.stopImmediatePropagation());
  document.addEventListener("click", intercept, true);
  const second = scheduleFarmIslandHydration({
    container: document.getElementById("second")!,
    strategy: "interaction",
    signal: controller.signal,
    hydrate,
  });
  try {
    document.querySelector("button")!.click();
    await Promise.resolve();
    expect(intercept).toHaveBeenCalledOnce();
    expect(hydrate).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener("click", intercept, true);
    controller.abort();
    await Promise.all([first, second]);
  }
});

describe("shared island visibility", () => {
  function observerMock() {
    const callbacks: IntersectionObserverCallback[] = [];
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          callbacks.push(callback);
        }
        observe = observe;
        unobserve = unobserve;
        disconnect = disconnect;
      },
    );
    const intersect = (...targets: Element[]) =>
      callbacks[0](
        targets.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
        {} as IntersectionObserver,
      );
    return { callbacks, observe, unobserve, disconnect, intersect };
  }

  it("uses one observer for 100 boundaries and disconnects after the last abort", async () => {
    const mock = observerMock();
    const controller = new AbortController();
    const hydrate = vi.fn();
    const scheduled = Array.from({ length: 100 }, () => {
      const container = document.createElement("div");
      container.innerHTML = "<button>Run</button>";
      document.body.append(container);
      return scheduleFarmIslandHydration({
        container,
        strategy: "visible",
        signal: controller.signal,
        hydrate,
      });
    });
    try {
      expect(mock.callbacks).toHaveLength(1);
      expect(mock.observe).toHaveBeenCalledTimes(100);
    } finally {
      controller.abort();
      await Promise.all(scheduled);
    }
    expect(mock.unobserve).toHaveBeenCalledTimes(100);
    expect(mock.disconnect).toHaveBeenCalledOnce();
    expect(hydrate).not.toHaveBeenCalled();
  });

  it("keeps a shared target observed when only one subscriber aborts", async () => {
    const mock = observerMock();
    document.body.innerHTML = "<div><button>Run</button></div>";
    const container = document.querySelector("div")!;
    const target = container.firstElementChild!;
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstHydrate = vi.fn();
    const secondHydrate = vi.fn(() => "ready");
    const first = scheduleFarmIslandHydration({
      container,
      strategy: "visible",
      signal: firstController.signal,
      hydrate: firstHydrate,
    });
    const second = scheduleFarmIslandHydration({
      container,
      strategy: "visible",
      signal: secondController.signal,
      hydrate: secondHydrate,
    });
    try {
      firstController.abort();
      await first;
      expect(mock.unobserve).not.toHaveBeenCalled();
      expect(mock.observe).toHaveBeenCalledOnce();
      mock.intersect(target);
      await expect(second).resolves.toBe("ready");
      mock.intersect(target);
      expect(secondHydrate).toHaveBeenCalledOnce();
      expect(firstHydrate).not.toHaveBeenCalled();
      expect(mock.unobserve).toHaveBeenCalledWith(target);
      expect(mock.disconnect).toHaveBeenCalledOnce();
    } finally {
      firstController.abort();
      secondController.abort();
      await Promise.all([first, second]);
    }
  });

  it("starts only intersecting boundaries and cleans up even when hydration rejects", async () => {
    const mock = observerMock();
    document.body.innerHTML =
      '<div id="first"><button>A</button><span>B</span></div><div id="second"><button>C</button></div>';
    const firstContainer = document.getElementById("first")!;
    const secondContainer = document.getElementById("second")!;
    const controller = new AbortController();
    const error = new Error("hydrate failed");
    const hydrate = vi.fn(() => {
      throw error;
    });
    const otherHydrate = vi.fn();
    const first = scheduleFarmIslandHydration({
      container: firstContainer,
      strategy: "visible",
      signal: controller.signal,
      hydrate,
    });
    const second = scheduleFarmIslandHydration({
      container: secondContainer,
      strategy: "visible",
      signal: controller.signal,
      hydrate: otherHydrate,
    });
    try {
      const rejected = expect(first).rejects.toBe(error);
      mock.intersect(...Array.from(firstContainer.children));
      await rejected;
      expect(hydrate).toHaveBeenCalledOnce();
      expect(otherHydrate).not.toHaveBeenCalled();
      expect(mock.unobserve).toHaveBeenCalledTimes(2);
      expect(mock.disconnect).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      await second;
    }
    expect(mock.disconnect).toHaveBeenCalledOnce();
  });
});
