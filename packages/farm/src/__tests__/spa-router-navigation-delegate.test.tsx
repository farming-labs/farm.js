/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link } from "../client/link";
import {
  delegateNavigation,
  type FarmNavigationDelegateContext,
} from "../client/navigation-delegate";
import { navigateTo, SPARouter } from "../client/spa-router";

const routers: SPARouter[] = [];
const removers: Array<() => void> = [];

function createRouter() {
  const router = new SPARouter({ scrollRestoration: false });
  routers.push(router);
  const fetchPageData = vi.fn(async () => ({ props: {}, modulePath: "/src/app/page.tsx" }));
  (router as unknown as { fetchPageData: typeof fetchPageData }).fetchPageData = fetchPageData;
  const render = vi.fn(async () => {});
  router.setNavigationHandler(render);
  (window as any).__FARM_SPA_ROUTER__ = router;
  return { router, fetchPageData, render };
}

function delegate(result: boolean | Promise<boolean> | (() => boolean | void) = true) {
  const seen: FarmNavigationDelegateContext[] = [];
  removers.push(
    delegateNavigation((context) => {
      seen.push(context);
      return typeof result === "function" ? result() : result;
    }),
  );
  return seen;
}

async function settle(assertion: () => void): Promise<void> {
  let error: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion();
      return;
    } catch (caught) {
      error = caught;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw error;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/notes?sort=new");
});

afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  for (const router of routers.splice(0)) router.destroy();
  delete (window as any).__FARM_SPA_ROUTER__;
  vi.restoreAllMocks();
});

describe("navigation delegates", () => {
  it("take a push or replace with the resolved URL, and the page stays as it is", async () => {
    const { router, fetchPageData, render } = createRouter();
    const seen = delegate(true);

    await router.navigate("12?tab=edit#title");
    await router.navigate("/settings", { replace: true });

    expect(seen).toEqual([
      {
        url: `${window.location.origin}/12?tab=edit#title`,
        from: "/notes?sort=new",
        to: "/12?tab=edit",
        action: "push",
      },
      {
        url: `${window.location.origin}/settings`,
        from: "/notes?sort=new",
        to: "/settings",
        action: "replace",
      },
    ]);
    expect(window.location.pathname + window.location.search).toBe("/notes?sort=new");
    expect(fetchPageData).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(router.getNavigationState().state).toBe("idle");
  });

  it("navigate in place when every delegate declines, a delegate throws, or it was removed", async () => {
    const { router, fetchPageData } = createRouter();
    const declined = delegate(false);
    const undecided = delegate(async () => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = delegate(() => {
      throw new Error("bridge gone");
    });

    await router.navigate("/a");
    expect([declined.length, undecided.length, failed.length]).toEqual([1, 1, 1]);
    expect(error).toHaveBeenCalledWith(
      "[Farm.js] A navigation delegate failed; navigating in place.",
      expect.any(Error),
    );
    expect(window.location.pathname).toBe("/a");

    const taken = delegate(true);
    removers.pop()!();
    await router.navigate("/b");
    expect(taken).toEqual([]);
    expect(window.location.pathname).toBe("/b");
    expect(fetchPageData).toHaveBeenCalledTimes(2);
  });

  it("run after blockers, and only a blocker-approved navigation is offered", async () => {
    const { router } = createRouter();
    const seen = delegate(true);
    let block = true;
    router.addBlocker(() => block);

    await router.navigate("/a");
    expect(seen).toEqual([]);
    block = false;
    await router.navigate("/a");
    expect(seen.map((context) => context.to)).toEqual(["/a"]);
  });

  it("are not offered refreshes, same-page hashes, back/forward or other origins", async () => {
    const { router, fetchPageData } = createRouter();
    const seen = delegate(true);
    // jsdom reports the document navigation to another origin as not implemented.
    vi.spyOn(console, "error").mockImplementation(() => {});

    await router.refresh();
    expect(fetchPageData).toHaveBeenCalledTimes(1);
    await router.navigate("#comments");
    expect(window.location.hash).toBe("#comments");
    await router.navigate("https://example.com/elsewhere");

    removers.pop()!();
    await router.navigate("/a");
    const popped = delegate(true);
    window.history.back();
    await settle(() => expect(window.location.pathname).toBe("/notes"));
    await settle(() => expect(fetchPageData).toHaveBeenCalledTimes(3));
    expect(seen).toEqual([]);
    expect(popped).toEqual([]);
  });

  it("apply to a router that starts after them, and to navigateTo and Link", async () => {
    const seen = delegate(true);
    const { fetchPageData } = createRouter();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(createElement(Link, { href: "/notes/7", prefetch: "none" })));

    await navigateTo("/notes/new", { replace: true });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    act(() => container.querySelector("a")!.dispatchEvent(click));
    await settle(() => expect(seen).toHaveLength(2));

    expect(click.defaultPrevented).toBe(true);
    expect(seen.map(({ to, action }) => [to, action])).toEqual([
      ["/notes/new", "replace"],
      ["/notes/7", "push"],
    ]);
    expect(fetchPageData).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
});
