/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

describe("SPA router viewport prefetch", () => {
  const callbacks: IntersectionObserverCallback[] = [];
  const disconnect = vi.fn();
  const observe = vi.fn();
  const unobserve = vi.fn();

  class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback);
    }
    observe = observe;
    unobserve = unobserve;
    disconnect = disconnect;
  }

  beforeEach(() => {
    callbacks.length = 0;
    disconnect.mockClear();
    observe.mockClear();
    unobserve.mockClear();
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function intersect(target: Element, index = 0) {
    callbacks[index]?.(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  }

  function intersectMany(targets: Element[], index = 0) {
    callbacks[index]?.(
      targets.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry),
      {} as IntersectionObserver,
    );
  }

  it("prefetches after the viewport delay while the link remains mounted", () => {
    const router = new SPARouter({ prefetchTimeout: 50, scrollRestoration: false });
    const prefetch = vi.spyOn(router, "prefetch").mockResolvedValue();
    const link = document.createElement("a");
    link.setAttribute("href", "/products");

    router.observeForPrefetch(link);
    intersect(link);
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
    intersect(link);
    router.unobserveForPrefetch(link);
    vi.advanceTimersByTime(50);

    expect(prefetch).not.toHaveBeenCalled();
    router.destroy();
  });

  it("ignores an observer callback queued before the link was unobserved", () => {
    const router = new SPARouter({ prefetchTimeout: 50, scrollRestoration: false });
    const prefetch = vi.spyOn(router, "prefetch").mockResolvedValue();
    const link = document.createElement("a");
    link.setAttribute("href", "/removed-before-callback");

    router.observeForPrefetch(link);
    router.unobserveForPrefetch(link);
    intersect(link);
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
    intersect(pending);
    router.observeForPrefetch(observed);
    router.destroy();
    vi.advanceTimersByTime(50);

    expect(prefetch).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("shares one observer across every viewport-prefetched link", () => {
    const router = new SPARouter({ prefetchTimeout: 50, scrollRestoration: false });
    const first = document.createElement("a");
    first.setAttribute("href", "/first");
    const second = document.createElement("a");
    second.setAttribute("href", "/second");

    router.observeForPrefetch(first);
    router.observeForPrefetch(second);

    expect(callbacks).toHaveLength(1);
    expect(observe).toHaveBeenCalledTimes(2);
    router.destroy();
  });

  it("limits viewport prefetch concurrency and drops an unmounted queued link", async () => {
    const router = new SPARouter({ prefetchTimeout: 50, scrollRestoration: false });
    const releases: Array<() => void> = [];
    const prefetch = vi.spyOn(router, "prefetch").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const links = Array.from({ length: 6 }, (_, index) => {
      const link = document.createElement("a");
      link.setAttribute("href", `/products/${index}`);
      router.observeForPrefetch(link);
      return link;
    });
    const duplicateQueuedLink = document.createElement("a");
    duplicateQueuedLink.setAttribute("href", "/products/5");
    router.observeForPrefetch(duplicateQueuedLink);

    intersectMany([...links, duplicateQueuedLink]);
    vi.advanceTimersByTime(50);
    expect(prefetch).toHaveBeenCalledTimes(4);

    router.unobserveForPrefetch(links[4]);
    releases[0]();
    await Promise.resolve();
    await Promise.resolve();

    expect(prefetch).toHaveBeenCalledTimes(5);
    expect(prefetch).not.toHaveBeenCalledWith("/products/4");
    expect(prefetch).toHaveBeenLastCalledWith("/products/5");
    expect(prefetch.mock.calls.filter(([href]) => href === "/products/5")).toHaveLength(1);
    router.destroy();
  });
});
