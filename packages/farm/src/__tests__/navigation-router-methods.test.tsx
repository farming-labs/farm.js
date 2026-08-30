/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";
import { useRouter } from "../navigation";

describe("navigation useRouter methods", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let router: SPARouter;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    router = new SPARouter({ scrollRestoration: false });
    (window as Window & { __FARM_SPA_ROUTER__?: SPARouter }).__FARM_SPA_ROUTER__ = router;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root?.unmount());
    router.destroy();
    container.remove();
    delete (window as Window & { __FARM_SPA_ROUTER__?: SPARouter }).__FARM_SPA_ROUTER__;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    vi.restoreAllMocks();
  });

  function renderHook() {
    let value!: ReturnType<typeof useRouter>;
    function Probe() {
      value = useRouter();
      return null;
    }
    root = createRoot(container);
    act(() => root.render(createElement(Probe)));
    return () => value;
  }

  it("delegates prefetch and refresh to the installed SPA router", async () => {
    const prefetch = vi.spyOn(router, "prefetch").mockResolvedValue();
    const refresh = vi.spyOn(router, "refresh").mockResolvedValue();
    const getRouter = renderHook();

    await getRouter().prefetch("/reports");
    await getRouter().refresh();

    expect(prefetch).toHaveBeenCalledWith("/reports");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
