import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startScrollRestorationRuntime } from "./client.js";
import type {
  ResolvedScrollRestorationOptions,
  ScrollRestorationNavigationEvent,
  ScrollRestorationRuntime,
} from "./types.js";

function baseOptions(
  overrides: Partial<ResolvedScrollRestorationOptions> = {},
): ResolvedScrollRestorationOptions {
  return { storageKeyPrefix: "farm-scroll-restore", ...overrides };
}

function navEvent(
  overrides: Partial<ScrollRestorationNavigationEvent> = {},
): ScrollRestorationNavigationEvent {
  return {
    id: "navigation:1",
    from: { href: "http://localhost/", pathname: "/", search: "", hash: "" },
    to: { href: "http://localhost/posts/7", pathname: "/posts/7", search: "", hash: "" },
    action: "pop",
    ...overrides,
  };
}

describe("startScrollRestorationRuntime", () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  let originalScrollTo: unknown;
  let originalScrollX: PropertyDescriptor | undefined;
  let originalScrollY: PropertyDescriptor | undefined;
  let originalSessionStorage: unknown;
  let runtime: ScrollRestorationRuntime | null = null;

  function setScroll(x: number, y: number): void {
    Object.defineProperty(window, "scrollX", { configurable: true, value: x });
    Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  }

  function start(
    options: ResolvedScrollRestorationOptions = baseOptions(),
    target: Window & typeof globalThis = window,
  ): ScrollRestorationRuntime {
    runtime = startScrollRestorationRuntime(options, target);
    return runtime;
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    window.sessionStorage.clear();
    scrollTo = vi.fn();
    originalScrollTo = (window as unknown as Record<string, unknown>).scrollTo;
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    originalScrollX = Object.getOwnPropertyDescriptor(window, "scrollX");
    originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
    originalSessionStorage = window.sessionStorage;
    setScroll(0, 0);
  });

  afterEach(() => {
    runtime?.close();
    runtime = null;
    Object.defineProperty(window, "scrollTo", { configurable: true, value: originalScrollTo });
    if (originalScrollX === undefined)
      delete (window as unknown as Record<string, unknown>).scrollX;
    else Object.defineProperty(window, "scrollX", originalScrollX);
    if (originalScrollY === undefined)
      delete (window as unknown as Record<string, unknown>).scrollY;
    else Object.defineProperty(window, "scrollY", originalScrollY);
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage,
    });
    document.body.innerHTML = "";
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("saves the from-page position on navigation.before", () => {
    start();
    setScroll(0, 300);

    runtime?.saveForNavigation(
      navEvent({
        action: "push",
        to: { href: "http://localhost/about", pathname: "/about", search: "", hash: "" },
      }),
    );

    expect(window.sessionStorage.getItem("farm-scroll-restore:/")).toBe('{"x":0,"y":300}');
  });

  it("restores the saved position on rendered for a pop navigation", () => {
    start();
    window.sessionStorage.setItem("farm-scroll-restore:/posts/7", '{"x":0,"y":420}');

    runtime?.restoreForNavigation(navEvent({ action: "pop" }));

    expect(scrollTo).toHaveBeenCalledWith(0, 420);
  });

  it("does not restore for push or replace navigations", () => {
    start();
    window.sessionStorage.setItem("farm-scroll-restore:/posts/7", '{"x":0,"y":420}');

    runtime?.restoreForNavigation(navEvent({ action: "push" }));
    runtime?.restoreForNavigation(navEvent({ action: "replace", id: "navigation:2" }));

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not restore when the destination has a hash", () => {
    start();
    window.sessionStorage.setItem("farm-scroll-restore:/posts/7", '{"x":0,"y":420}');

    runtime?.restoreForNavigation(
      navEvent({
        action: "pop",
        to: {
          href: "http://localhost/posts/7#comments",
          pathname: "/posts/7",
          search: "",
          hash: "#comments",
        },
      }),
    );

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing when nothing was saved for the destination", () => {
    start();

    runtime?.restoreForNavigation(navEvent({ action: "pop" }));

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("skips the save and the restore for an opted-out link", () => {
    start();
    setScroll(0, 300);
    window.sessionStorage.setItem("farm-scroll-restore:/posts/7", '{"x":0,"y":420}');
    document.body.innerHTML = `<a href="/posts/7" data-farm-scroll-restore="off">Read</a>`;
    const anchor = document.querySelector("a") as HTMLAnchorElement;
    anchor.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

    runtime?.saveForNavigation(navEvent({ action: "push" }));
    expect(window.sessionStorage.getItem("farm-scroll-restore:/")).toBeNull();

    runtime?.restoreForNavigation(navEvent({ action: "pop" }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not let an opt-out leak to a different destination", () => {
    start();
    setScroll(0, 300);
    window.sessionStorage.setItem("farm-scroll-restore:/other", '{"x":0,"y":55}');
    document.body.innerHTML = `<a href="/posts/7" data-farm-scroll-restore="off">Read</a>`;
    const anchor = document.querySelector("a") as HTMLAnchorElement;
    anchor.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

    runtime?.saveForNavigation(
      navEvent({
        action: "push",
        to: { href: "http://localhost/other", pathname: "/other", search: "", hash: "" },
      }),
    );
    expect(window.sessionStorage.getItem("farm-scroll-restore:/")).toBe('{"x":0,"y":300}');

    runtime?.restoreForNavigation(
      navEvent({
        action: "pop",
        id: "navigation:2",
        to: { href: "http://localhost/other", pathname: "/other", search: "", hash: "" },
      }),
    );
    expect(scrollTo).toHaveBeenCalledWith(0, 55);
  });

  it("keys by route pattern plus params when the session carries a route", () => {
    start();
    window.sessionStorage.setItem('farm-scroll-restore:/posts/[id]#{"id":"7"}', '{"x":0,"y":500}');

    runtime?.restoreForNavigation(
      navEvent({ action: "pop", route: { pattern: "/posts/[id]", params: { id: "7" } } }),
    );
    expect(scrollTo).toHaveBeenCalledWith(0, 500);

    // The next save uses the pattern key, not the pathname.
    setScroll(0, 610);
    runtime?.saveForNavigation(
      navEvent({
        action: "push",
        id: "navigation:2",
        to: { href: "http://localhost/about", pathname: "/about", search: "", hash: "" },
      }),
    );
    expect(window.sessionStorage.getItem('farm-scroll-restore:/posts/[id]#{"id":"7"}')).toBe(
      '{"x":0,"y":610}',
    );
  });

  it("discards a recorded opt-out so a later restore proceeds", () => {
    start();
    window.sessionStorage.setItem("farm-scroll-restore:/posts/7", '{"x":0,"y":420}');
    document.body.innerHTML = `<a href="/posts/7" data-farm-scroll-restore="off">Read</a>`;
    const anchor = document.querySelector("a") as HTMLAnchorElement;
    anchor.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

    runtime?.saveForNavigation(navEvent({ action: "push" }));
    runtime?.discard("navigation:1");
    runtime?.restoreForNavigation(navEvent({ action: "pop" }));

    expect(scrollTo).toHaveBeenCalledWith(0, 420);
  });

  it("stops everything after close", () => {
    start();
    setScroll(0, 300);
    runtime?.close();

    document.body.innerHTML = `<a href="/posts/7" data-farm-scroll-restore="off">Read</a>`;
    const anchor = document.querySelector("a") as HTMLAnchorElement;
    anchor.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    runtime?.saveForNavigation(navEvent({ action: "push" }));
    expect(window.sessionStorage.getItem("farm-scroll-restore:/")).toBeNull();

    window.sessionStorage.setItem("farm-scroll-restore:/posts/7", '{"x":0,"y":420}');
    runtime?.restoreForNavigation(navEvent({ action: "pop" }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("never throws when storage is hostile", () => {
    const hostileWindow = {
      location: new URL("http://localhost/"),
      scrollX: 0,
      scrollY: 120,
      scrollTo: vi.fn(),
      addEventListener: () => {},
      removeEventListener: () => {},
      get sessionStorage(): never {
        throw new Error("denied");
      },
    } as unknown as Window & typeof globalThis;
    const hostile = start(baseOptions(), hostileWindow);

    expect(() => hostile.saveForNavigation(navEvent({ action: "push" }))).not.toThrow();
    expect(() => hostile.restoreForNavigation(navEvent({ action: "pop" }))).not.toThrow();
    hostile.close();
  });
});
