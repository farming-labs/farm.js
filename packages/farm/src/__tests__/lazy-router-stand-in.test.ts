/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { splitFarmClientRouter } from "../nitro/universal-build";

type Observer = { callback: IntersectionObserverCallback; observed: Element[] };

function createStandIn() {
  const observers: Observer[] = [];
  class FakeIntersectionObserver {
    record: Observer;
    constructor(callback: IntersectionObserverCallback) {
      this.record = { callback, observed: [] };
      observers.push(this.record);
    }
    observe(element: Element) {
      this.record.observed.push(element);
    }
    unobserve(element: Element) {
      this.record.observed = this.record.observed.filter((item) => item !== element);
    }
    disconnect() {
      this.record.observed = [];
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

  const realRouter = {
    currentPath: "/loaded",
    fetchPage: vi.fn(async () => "html"),
    prefetch: vi.fn(async () => {}),
    observeForPrefetch: vi.fn(),
  };
  // The router module installs itself as the global when it runs.
  const load = vi.fn(async () => {
    (window as any).__FARM_SPA_ROUTER__ = realRouter;
    return { spaRouter: realRouter };
  });
  const { entry } = splitFarmClientRouter("/*farm-router-stub*/\n");
  const code = entry
    .replace('import("./farm-client-router")', "__load()")
    .replace(/\nexport \{[^}]*\};\n$/, "\n");
  const standIn = new Function(
    "__load",
    "IDLE_NAVIGATION_STATE",
    "hasAbsoluteNavigationHref",
    `${code}\nreturn spaRouter;`,
  )(load, {}, () => false);
  return { standIn, realRouter, load, observers };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).__FARM_SPA_ROUTER__;
});

describe("the lazy router stand-in", () => {
  it("stays the global router after the router loads, keeping wrapped methods", async () => {
    const { standIn, realRouter } = createStandIn();
    expect((window as any).__FARM_SPA_ROUTER__).toBe(standIn);
    expect(standIn.currentPath).toBe(window.location.pathname + window.location.search);

    const calls: string[] = [];
    const original = standIn.prefetch.bind(standIn);
    standIn.prefetch = (href: string) => {
      calls.push(href);
      return original(href);
    };
    await (window as any).__FARM_SPA_ROUTER__.prefetch("/a");

    expect((window as any).__FARM_SPA_ROUTER__).toBe(standIn);
    expect(standIn.currentPath).toBe("/loaded");
    await (window as any).__FARM_SPA_ROUTER__.prefetch("/b");
    expect(calls).toEqual(["/a", "/b"]);
    expect(realRouter.prefetch).toHaveBeenCalledWith("/b");
  });

  it("reads and writes the router's own members through the stand-in once it loads", async () => {
    const { standIn, realRouter } = createStandIn();
    expect("fetchPage" in standIn).toBe(false);
    await standIn.prefetch("/a");

    expect("fetchPage" in standIn).toBe(true);
    expect(standIn.fetchPage).toBe(realRouter.fetchPage);
    const wrapped = vi.fn();
    standIn.fetchPage = wrapped;
    expect(realRouter.fetchPage).toBe(wrapped);
  });

  it("loads the router when a watched link nears the viewport, then hands the link over", async () => {
    const { standIn, realRouter, load, observers } = createStandIn();
    const link = document.createElement("a");
    link.href = "/next";
    standIn.observeForPrefetch(link);
    expect(load).not.toHaveBeenCalled();

    const observer = observers[0]!;
    expect(observer.observed).toEqual([link]);
    observer.callback([{ isIntersecting: false, target: link }] as any, {} as any);
    expect(load).not.toHaveBeenCalled();
    observer.callback([{ isIntersecting: true, target: link }] as any, {} as any);
    await vi.waitFor(() => expect(realRouter.observeForPrefetch).toHaveBeenCalledWith(link));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("stops watching a link that is unobserved before the router loads", () => {
    const { standIn, load, observers } = createStandIn();
    const link = document.createElement("a");
    link.href = "/next";
    standIn.observeForPrefetch(link);
    standIn.unobserveForPrefetch(link);
    expect(observers[0]!.observed).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});
