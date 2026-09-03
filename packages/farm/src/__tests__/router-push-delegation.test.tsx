/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "../client/router";
import { pushState as pushFarmPageState, readPageState, SPARouter } from "../client/spa-router";
import { setFarmBasePath } from "../base-path";

let router: SPARouter | undefined;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;

function renderHook() {
  let api!: ReturnType<typeof useRouter>;
  function Probe() {
    api = useRouter();
    return null;
  }
  root = createRoot(container);
  act(() => root?.render(createElement(Probe)));
  return () => api;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  setFarmBasePath("/");
  window.history.replaceState(null, "", "/");
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  setFarmBasePath("/");
  if (root) act(() => root?.unmount());
  container.remove();
  root = undefined;
  router?.destroy();
  router = undefined;
  delete (window as unknown as { __FARM_SPA_ROUTER__?: SPARouter }).__FARM_SPA_ROUTER__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installRouter() {
  router = new SPARouter({ scrollRestoration: false });
  (window as unknown as { __FARM_SPA_ROUTER__?: SPARouter }).__FARM_SPA_ROUTER__ = router;
  return router;
}

describe("useRouter push/replace delegation", () => {
  it("delegates push to the installed router with the push action", async () => {
    const spa = installRouter();
    const navigate = vi.spyOn(spa, "navigate").mockResolvedValue();
    const getApi = renderHook();

    act(() => getApi().push("/about"));
    await settle();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/about", { replace: false });
    // The URL must not be rewritten before the router (and its blockers) run.
    expect(window.location.pathname).toBe("/");
  });

  it("delegates replace to the installed router", async () => {
    const spa = installRouter();
    const navigate = vi.spyOn(spa, "navigate").mockResolvedValue();
    const getApi = renderHook();

    act(() => getApi().replace("/pricing"));
    await settle();

    expect(navigate).toHaveBeenCalledWith("/pricing", { replace: true });
  });

  it("uses the configured app base path without duplicating it", async () => {
    setFarmBasePath("/console");
    const spa = installRouter();
    const navigate = vi.spyOn(spa, "navigate").mockResolvedValue();
    const getApi = renderHook();

    act(() => {
      getApi().push("/reports");
      getApi().replace("/console/settings");
    });
    await settle();

    expect(navigate).toHaveBeenNthCalledWith(1, "/console/reports", { replace: false });
    expect(navigate).toHaveBeenNthCalledWith(2, "/console/settings", { replace: true });
  });

  it("leaves the URL unchanged when a blocker cancels the navigation", async () => {
    const spa = installRouter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const removeBlocker = spa.addBlocker(() => true);
    const getApi = renderHook();

    act(() => getApi().push("/about"));
    await settle();

    expect(window.location.pathname).toBe("/");
    removeBlocker();
  });

  it("preserves Farm page history state across delegated pushes", async () => {
    const spa = installRouter();
    vi.spyOn(spa, "navigate").mockResolvedValue();
    pushFarmPageState({ modal: "open" });
    const getApi = renderHook();

    act(() => getApi().push("/about"));
    await settle();

    expect(readPageState()).toEqual({ modal: "open" });
  });

  it("falls back to a direct history write plus synthetic popstate without a router", async () => {
    const popstate = vi.fn();
    window.addEventListener("popstate", popstate);
    const getApi = renderHook();

    act(() => getApi().push("/about"));
    await settle();

    window.removeEventListener("popstate", popstate);
    expect(window.location.pathname).toBe("/about");
    expect(popstate).toHaveBeenCalledTimes(1);
  });
});
