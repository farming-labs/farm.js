import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startScrollRestorationRuntime } from "./client.js";
import type { ScrollRestorationNavigationEvent, ScrollRestorationRuntime } from "./types.js";

const PREFIX = "farm-scroll-restore";
let sequence = 0;

function navigation(
  action: ScrollRestorationNavigationEvent["action"],
  to: string,
): ScrollRestorationNavigationEvent {
  const url = new URL(to, "http://localhost");
  return {
    id: `navigation:${++sequence}`,
    to: { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash },
    action,
  };
}

describe("startScrollRestorationRuntime", () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  let runtime: ScrollRestorationRuntime | null = null;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();

  function setScroll(y: number): void {
    Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  }

  /** Start on `path`, as if the tab had loaded it. */
  function start(path = "/"): ScrollRestorationRuntime {
    window.history.replaceState(null, "", path);
    runtime = startScrollRestorationRuntime({ storageKeyPrefix: PREFIX }, window);
    return runtime;
  }

  /** One client navigation, the way core drives the hooks. */
  function go(action: ScrollRestorationNavigationEvent["action"], to: string): void {
    const event = navigation(action, to);
    runtime?.saveForNavigation(event);
    runtime?.restoreForNavigation(event);
  }

  beforeEach(() => {
    for (const key of ["scrollTo", "scrollX", "scrollY"]) {
      descriptors.set(key, Object.getOwnPropertyDescriptor(window, key));
    }
    scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
    setScroll(0);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    runtime?.close();
    runtime = null;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(window, key, descriptor);
      else delete (window as unknown as Record<string, unknown>)[key];
    }
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("saves the page being left on navigation.before", () => {
    start("/");
    setScroll(300);
    runtime?.saveForNavigation(navigation("push", "/about"));

    expect(window.sessionStorage.getItem(`${PREFIX}:/`)).toBe('{"x":0,"y":300}');
  });

  it("restores the first page the tab loaded on Back", () => {
    start("/posts/7");
    setScroll(900);
    go("push", "/about");
    go("pop", "/posts/7");

    expect(scrollTo).toHaveBeenLastCalledWith(0, 900);
  });

  it("restores the page being left on Forward", () => {
    start("/");
    setScroll(1200);
    go("push", "/about");
    setScroll(300);
    go("pop", "/");
    expect(scrollTo).toHaveBeenLastCalledWith(0, 1200);

    go("pop", "/about");
    expect(scrollTo).toHaveBeenLastCalledWith(0, 300);
  });

  it("keeps a position per query string", () => {
    start("/search?q=a");
    setScroll(800);
    go("push", "/search?q=b");
    setScroll(300);
    go("pop", "/search?q=a");

    expect(scrollTo).toHaveBeenLastCalledWith(0, 800);
    expect(window.sessionStorage.getItem(`${PREFIX}:/search?q=b`)).toBe('{"x":0,"y":300}');
  });

  it("does not restore for push or replace navigations", () => {
    start("/");
    window.sessionStorage.setItem(`${PREFIX}:/posts/7`, '{"x":0,"y":420}');
    go("push", "/posts/7");
    go("replace", "/posts/7");

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("leaves a destination hash to core", () => {
    start("/");
    window.sessionStorage.setItem(`${PREFIX}:/posts/7`, '{"x":0,"y":420}');
    go("pop", "/posts/7#comments");

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing when nothing was saved for the destination", () => {
    start("/");
    go("pop", "/posts/7");

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("stops saving and restoring after close", () => {
    start("/");
    window.sessionStorage.setItem(`${PREFIX}:/posts/7`, '{"x":0,"y":420}');
    runtime?.close();
    setScroll(300);
    go("pop", "/posts/7");

    expect(window.sessionStorage.getItem(`${PREFIX}:/`)).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("never throws when storage or scrollTo is hostile", () => {
    const hostileWindow = {
      location: new URL("http://localhost/"),
      scrollX: 0,
      scrollY: 120,
      scrollTo() {
        throw new Error("denied");
      },
      get sessionStorage(): never {
        throw new Error("denied");
      },
    } as unknown as Window & typeof globalThis;
    const hostile = startScrollRestorationRuntime({ storageKeyPrefix: PREFIX }, hostileWindow);

    expect(() => hostile.saveForNavigation(navigation("push", "/about"))).not.toThrow();
    expect(() => hostile.restoreForNavigation(navigation("pop", "/"))).not.toThrow();
    hostile.close();
  });
});
