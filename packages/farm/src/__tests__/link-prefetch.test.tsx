/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { Link, type LinkProps } from "../client/link";
import { installFarmLinkPrefetch } from "../client/link-prefetch";

type Router = {
  prefetch: ReturnType<typeof vi.fn>;
  observeForPrefetch: ReturnType<typeof vi.fn>;
  unobserveForPrefetch: ReturnType<typeof vi.fn>;
};

let router: Router;
let uninstall: (() => void) | undefined;

function createRouter(): Router {
  return {
    prefetch: vi.fn().mockResolvedValue(undefined),
    observeForPrefetch: vi.fn(),
    unobserveForPrefetch: vi.fn(),
  };
}

/** Server HTML for a `Link`, as a page that never hydrates ships it. */
function serverLink(props: Partial<LinkProps> = {}): string {
  return renderToString(
    createElement(Link, { href: "/about", ...props } as LinkProps, "About") as ReactElement,
  );
}

function mountServerHtml(html: string): HTMLAnchorElement {
  document.body.innerHTML = `<main>${html}</main>`;
  return document.querySelector("a")!;
}

function hover(anchor: Element, from: Element | null = document.body) {
  anchor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }));
}

function leave(anchor: Element, to: Element | null = document.body) {
  anchor.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: to }));
}

/** Lets MutationObserver records reach the installed observer. */
async function flushMutations() {
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  router = createRouter();
  (window as any).__FARM_SPA_ROUTER__ = router;
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.useRealTimers();
  document.body.innerHTML = "";
  delete (window as any).__FARM_SPA_ROUTER__;
});

describe("Link prefetch on a page that does not hydrate", () => {
  it("prefetches a default Link on hover after Link's 50ms delay", () => {
    const anchor = mountServerHtml(serverLink());
    uninstall = installFarmLinkPrefetch();

    hover(anchor);
    vi.advanceTimersByTime(49);
    expect(router.prefetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(router.prefetch).toHaveBeenCalledTimes(1);
    expect(router.prefetch).toHaveBeenCalledWith("/about");
  });

  it("watches a default Link for the viewport through the router", () => {
    const anchor = mountServerHtml(serverLink());
    uninstall = installFarmLinkPrefetch();

    expect(router.observeForPrefetch).toHaveBeenCalledTimes(1);
    expect(router.observeForPrefetch).toHaveBeenCalledWith(anchor);
  });

  it.each([
    ["intent", { hover: true, viewport: false, render: false }],
    ["hover", { hover: true, viewport: false, render: false }],
    ["viewport", { hover: false, viewport: true, render: false }],
    ["render", { hover: false, viewport: false, render: true }],
    ["none", { hover: false, viewport: false, render: false }],
    [false, { hover: false, viewport: false, render: false }],
  ] as const)("follows prefetch=%s as Link does", (prefetch, expected) => {
    const anchor = mountServerHtml(serverLink({ prefetch } as Partial<LinkProps>));
    uninstall = installFarmLinkPrefetch();

    expect(router.prefetch).toHaveBeenCalledTimes(expected.render ? 1 : 0);
    expect(router.observeForPrefetch).toHaveBeenCalledTimes(expected.viewport ? 1 : 0);
    router.prefetch.mockClear();
    hover(anchor);
    vi.advanceTimersByTime(50);
    expect(router.prefetch).toHaveBeenCalledTimes(expected.hover ? 1 : 0);
  });

  it("waits for the Link's own prefetchDelay", () => {
    const anchor = mountServerHtml(serverLink({ prefetch: "intent", prefetchDelay: 200 }));
    uninstall = installFarmLinkPrefetch();

    hover(anchor);
    vi.advanceTimersByTime(199);
    expect(router.prefetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(router.prefetch).toHaveBeenCalledTimes(1);
  });

  it("prefetches on focus and touch, as Link does", () => {
    const anchor = mountServerHtml(serverLink({ prefetch: "intent" }));
    uninstall = installFarmLinkPrefetch();

    anchor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.advanceTimersByTime(50);
    expect(router.prefetch).toHaveBeenCalledTimes(1);

    anchor.dispatchEvent(new Event("touchstart", { bubbles: true }));
    vi.advanceTimersByTime(50);
    expect(router.prefetch).toHaveBeenCalledTimes(2);
  });

  it("cancels when the pointer or focus leaves before the delay", () => {
    const anchor = mountServerHtml(serverLink({ prefetch: "intent" }));
    uninstall = installFarmLinkPrefetch();

    hover(anchor);
    leave(anchor);
    anchor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    anchor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    vi.advanceTimersByTime(100);
    expect(router.prefetch).not.toHaveBeenCalled();
  });

  it("keeps the pending prefetch while the pointer moves inside the link", () => {
    const anchor = mountServerHtml(serverLink({ prefetch: "intent" }));
    anchor.innerHTML = "<span>About</span>";
    const child = anchor.querySelector("span")!;
    uninstall = installFarmLinkPrefetch();

    hover(anchor);
    vi.advanceTimersByTime(25);
    leave(anchor, child);
    hover(child, anchor);
    vi.advanceTimersByTime(25);
    expect(router.prefetch).toHaveBeenCalledTimes(1);
  });

  it("picks up links a client navigation adds, and hands back the ones it removes", async () => {
    mountServerHtml("<p>Home</p>");
    uninstall = installFarmLinkPrefetch();

    const main = document.querySelector("main")!;
    main.innerHTML =
      serverLink({ href: "/users/1" }) + serverLink({ href: "/pricing", prefetch: "render" });
    await flushMutations();
    const watched = main.querySelector('a[href="/users/1"]');
    expect(router.observeForPrefetch).toHaveBeenCalledWith(watched);
    expect(router.prefetch).toHaveBeenCalledWith("/pricing");

    main.innerHTML = "<p>Next page</p>";
    await flushMutations();
    expect(router.unobserveForPrefetch).toHaveBeenCalledWith(watched);
  });

  it("leaves a moved link watched", async () => {
    const anchor = mountServerHtml(serverLink());
    uninstall = installFarmLinkPrefetch();

    document.body.append(anchor);
    await flushMutations();
    expect(router.unobserveForPrefetch).not.toHaveBeenCalled();
  });

  it("skips absolute URLs and anchors Link did not render", () => {
    document.body.innerHTML = `${serverLink({ href: "https://example.com/" as "/about" })}<a href="/plain">Plain</a>`;
    uninstall = installFarmLinkPrefetch();

    for (const anchor of document.querySelectorAll("a")) hover(anchor);
    vi.advanceTimersByTime(50);
    expect(router.prefetch).not.toHaveBeenCalled();
    expect(router.observeForPrefetch).not.toHaveBeenCalled();
  });

  it("does nothing without a router that prefetches", () => {
    (window as any).__FARM_SPA_ROUTER__ = { navigate: vi.fn() };
    const anchor = mountServerHtml(serverLink({ prefetch: "render" }));
    uninstall = installFarmLinkPrefetch();

    hover(anchor);
    expect(() => vi.advanceTimersByTime(50)).not.toThrow();
  });

  it("uses the router installed when the prefetch runs", () => {
    delete (window as any).__FARM_SPA_ROUTER__;
    const anchor = mountServerHtml(serverLink({ prefetch: "intent" }));
    uninstall = installFarmLinkPrefetch();

    hover(anchor);
    (window as any).__FARM_SPA_ROUTER__ = router;
    vi.advanceTimersByTime(50);
    expect(router.prefetch).toHaveBeenCalledWith("/about");
  });

  it("ignores a prefetch that throws or rejects", async () => {
    router.prefetch.mockImplementationOnce(() => {
      throw new Error("offline");
    });
    router.prefetch.mockRejectedValueOnce(new Error("offline"));
    const anchor = mountServerHtml(serverLink({ prefetch: "intent" }));
    uninstall = installFarmLinkPrefetch();

    hover(anchor);
    expect(() => vi.advanceTimersByTime(50)).not.toThrow();
    leave(anchor);
    hover(anchor);
    vi.advanceTimersByTime(50);
    await Promise.resolve();
    expect(router.prefetch).toHaveBeenCalledTimes(2);
  });

  it("removes its listeners, timers and watches when uninstalled", async () => {
    const anchor = mountServerHtml(serverLink());
    const stop = installFarmLinkPrefetch();

    hover(anchor);
    stop();
    vi.advanceTimersByTime(50);
    expect(router.prefetch).not.toHaveBeenCalled();
    expect(router.unobserveForPrefetch).toHaveBeenCalledWith(anchor);

    hover(anchor);
    vi.advanceTimersByTime(50);
    document.body.innerHTML = serverLink({ href: "/later" });
    await flushMutations();
    expect(router.prefetch).not.toHaveBeenCalled();
    expect(router.observeForPrefetch).toHaveBeenCalledTimes(1);
  });
});
