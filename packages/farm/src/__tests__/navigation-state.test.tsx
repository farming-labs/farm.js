/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBlocker, useScrollRestoration } from "../client/router";
import { navigateTo, pushState, readPageState, replaceState, SPARouter } from "../client/spa-router";

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
      vi.fn(async () =>
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
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
