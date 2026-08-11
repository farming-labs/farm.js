/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBlocker, useNavigation, useScrollRestoration } from "../client/router";
import {
  navigateTo,
  pushState,
  readPageState,
  replaceState,
  SPARouter,
} from "../client/spa-router";
import { createDeferredDataResponse, defer } from "../deferred";

describe("navigation state and blocking", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    window.history.replaceState(null, "", "/");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              props: {},
              modulePath: "/src/app/page.tsx",
              metadata: { title: "Next" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }

    container.remove();
    root = undefined;
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (document as any).startViewTransition;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it("blocks SPA navigation when a blocker returns true", async () => {
    const router = new SPARouter({ scrollRestoration: false });
    const blocker = vi.fn(() => true);
    const onNavigate = vi.fn();
    router.setNavigationHandler(onNavigate);
    router.addBlocker(blocker);

    await router.navigate("/blocked");

    expect(blocker).toHaveBeenCalledWith({
      from: "/",
      to: "/blocked",
      action: "push",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });

  it("stores page state in history without changing route data", () => {
    pushState({ modal: "cart" });
    expect(readPageState()).toEqual({ modal: "cart" });
    expect(window.location.pathname).toBe("/");

    replaceState({ drawer: "filters" }, "/products");
    expect(readPageState()).toEqual({ drawer: "filters" });
    expect(window.location.pathname).toBe("/products");
  });

  it("uses confirm-based blockers from React hooks", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    function App() {
      useBlocker({ when: true, message: "Leave this form?" });
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    await act(async () => {
      await navigateTo("/next");
    });

    expect(window.confirm).toHaveBeenCalledWith("Leave this form?");
    expect(fetch).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });

  it("exposes pending navigation state while a route transition loads", async () => {
    let releaseFetch!: () => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetch = () => {
            resolve(
              new Response(
                JSON.stringify({
                  props: {},
                  modulePath: "/src/app/reports/page.tsx",
                  metadata: { title: "Reports" },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          };
        }),
    );
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    function App() {
      const navigation = useNavigation();
      return createElement(
        "output",
        null,
        `${navigation.state}:${navigation.to?.pathname ?? ""}:${navigation.action ?? ""}`,
      );
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    let navigationPromise!: Promise<void>;
    await act(async () => {
      navigationPromise = navigateTo("/reports");
      await Promise.resolve();
    });

    expect(container.textContent).toBe("loading:/reports:push");

    await act(async () => {
      releaseFetch();
      await navigationPromise;
    });

    expect(container.textContent).toBe("idle::");
    expect(window.location.pathname).toBe("/reports");
  });

  it("wraps route commits in a view transition when requested", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const updateCallbacks: Array<() => Promise<void>> = [];
    const startViewTransition = vi.fn((callback: () => Promise<void>) => {
      updateCallbacks.push(callback);
      const updateCallbackDone = callback();
      return {
        updateCallbackDone,
        finished: updateCallbackDone,
      };
    });
    (document as any).startViewTransition = startViewTransition;

    const router = new SPARouter({ scrollRestoration: false });
    const onNavigate = vi.fn(async () => undefined);
    router.setNavigationHandler(onNavigate);

    await router.navigate("/gallery", { viewTransition: true, scroll: false });

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(updateCallbacks.length).toBe(1);
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        modulePath: "/src/app/page.tsx",
      }),
    );
    expect(window.location.pathname).toBe("/gallery");
  });

  it("commits server HTML routes through the navigation handler without reloading", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          props: {},
          modulePath: "/src/app/server/page.tsx",
          isClientComponent: false,
          renderPlan: {
            version: 1,
            output: "html",
            navigation: "html-fragment",
            hydration: "none",
            islandStrategy: null,
            cache: { mode: "dynamic" },
          },
          fragment: {
            html: '<div id="__farm_page__"><h1>Server page</h1></div>',
            layoutPatterns: ["/"],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const router = new SPARouter({ scrollRestoration: false });
    const onNavigate = vi.fn(async () => undefined);
    router.setNavigationHandler(onNavigate);

    await router.navigate("/server", { scroll: false });

    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        isClientComponent: false,
        fragment: expect.objectContaining({ layoutPatterns: ["/"] }),
      }),
    );
    expect(window.location.pathname).toBe("/server");
  });

  it("commits immediate route data while deferred fields keep streaming", async () => {
    const reviews = createControlledPromise<string[]>();
    vi.mocked(fetch).mockResolvedValueOnce(
      createDeferredDataResponse({
        props: {
          data: {
            product: { id: "p1" },
            reviews: defer(reviews.promise),
          },
        },
        modulePath: "/src/app/products/page.tsx",
        isClientComponent: true,
      }),
    );
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const router = new SPARouter({ scrollRestoration: false });
    const onNavigate = vi.fn(async () => undefined);
    router.setNavigationHandler(onNavigate);

    await router.navigate("/products", { scroll: false });

    const pageData = onNavigate.mock.calls[0]?.[0] as any;
    expect(pageData.props.data.product).toEqual({ id: "p1" });
    expect(pageData.props.data.reviews.status).toBe("pending");
    expect(fetch).toHaveBeenCalledWith(
      "/__farm/page-data?path=%2Fproducts",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const requestHeaders = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Headers;
    expect(requestHeaders.get("accept")).toBe("application/x-farm-deferred+json, application/json");

    reviews.resolve(["Excellent"]);
    await expect(pageData.props.data.reviews).resolves.toEqual(["Excellent"]);
  });

  it("reports stale prefetches without retrying or navigating", async () => {
    const mismatchListener = vi.fn();
    window.addEventListener("farm:deployment-mismatch", mismatchListener, { once: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "FARM_DEPLOYMENT_MISMATCH" }), {
        status: 409,
        headers: {
          "x-farm-deployment-id": "release-2",
          "x-farm-deployment-mismatch": "1",
        },
      }),
    );

    const router = new SPARouter({ deploymentId: "release-1" });
    await router.prefetch("/reports");

    expect(fetch).toHaveBeenCalledTimes(1);
    const requestHeaders = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Headers;
    expect(requestHeaders.get("x-farm-deployment-id")).toBe("release-1");
    expect(mismatchListener).toHaveBeenCalledTimes(1);
    const mismatchEvent = mismatchListener.mock.calls[0]?.[0];
    expect(mismatchEvent).toBeInstanceOf(CustomEvent);
    expect((mismatchEvent as CustomEvent).detail).toMatchObject({
      code: "FARM_DEPLOYMENT_MISMATCH",
      retryable: false,
      clientDeploymentId: "release-1",
      serverDeploymentId: "release-2",
    });
    expect(window.location.pathname).toBe("/");
  });

  it("restores registered nested scroll containers by key", () => {
    vi.useFakeTimers();
    sessionStorage.setItem("farm-scroll-/:sidebar", JSON.stringify({ x: 4, y: 120 }));

    function App() {
      const ref = useScrollRestoration<HTMLDivElement>("sidebar");
      return createElement("div", { ref });
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    const panel = container.querySelector("div") as HTMLDivElement;
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(panel.scrollLeft).toBe(4);
    expect(panel.scrollTop).toBe(120);
  });
});

function createControlledPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
