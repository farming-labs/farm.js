/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

describe("SPA router viewport prefetch", () => {
  const callbacks: IntersectionObserverCallback[] = [];
  const disconnect = vi.fn();

  class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect = disconnect;
  }

  beforeEach(() => {
    callbacks.length = 0;
    disconnect.mockClear();
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function intersect(index = 0) {
    callbacks[index]?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  }

  it("prefetches after the viewport delay while the link remains mounted", () => {
    const router = new SPARouter({ prefetchTimeout: 50, scrollRestoration: false });
    const prefetch = vi.spyOn(router, "prefetch").mockResolvedValue();
    const link = document.createElement("a");
    link.setAttribute("href", "/products");

    router.observeForPrefetch(link);
    intersect();
    vi.advanceTimersByTime(50);

    expect(prefetch).toHaveBeenCalledWith("/products");
    router.destroy();
  });

  it("cancels a scheduled prefetch when the link is unobserved", () => {
    const router = new SPARouter({ prefetchTimeout: 50, scrollRestoration: false });
    const prefetch = vi.spyOn(router, "prefetch").mockResolvedValue();
    const link = document.createElement("a");
    link.setAttribute("href", "/removed");

    router.observeForPrefetch(link);
    intersect();
    router.unobserveForPrefetch(link);
    vi.advanceTimersByTime(50);

    expect(prefetch).not.toHaveBeenCalled();
    router.destroy();
  });

  it("disconnects observers and cancels scheduled prefetches on destroy", () => {
    const router = new SPARouter({ prefetchTimeout: 50, scrollRestoration: false });
    const prefetch = vi.spyOn(router, "prefetch").mockResolvedValue();
    const pending = document.createElement("a");
    pending.setAttribute("href", "/pending");
    const observed = document.createElement("a");
    observed.setAttribute("href", "/observed");

    router.observeForPrefetch(pending);
    intersect(0);
    router.observeForPrefetch(observed);
    router.destroy();
    vi.advanceTimersByTime(50);

    expect(prefetch).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
