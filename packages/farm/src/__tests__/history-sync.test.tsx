/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FARM_HISTORY_CHANGE_EVENT,
  notifyHistoryChange,
  subscribeHistoryChange,
  type FarmHistoryChangeDetail,
} from "../client/history-sync";
import { usePageState, useRouter } from "../client/router";
import { readPageState, SPARouter } from "../client/spa-router";
import { asString, useQueryState } from "../query/client";

let active: SPARouter | undefined;
const listeners: Array<() => void> = [];

/** Registers a listener the suite removes after each test. */
function listen(type: string, handler: EventListener): void {
  window.addEventListener(type, handler);
  listeners.push(() => window.removeEventListener(type, handler));
}
let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function mountRouter() {
  const fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify({ props: {}, modulePath: "/src/app/page.tsx" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchSpy);

  const router = new SPARouter({ scrollRestoration: false });
  active = router;
  (window as unknown as { __FARM_SPA_ROUTER__?: SPARouter }).__FARM_SPA_ROUTER__ = router;
  const navigationStates: string[] = [];
  // subscribeNavigation replays the current state, so drop that first entry.
  let seenInitial = false;
  router.subscribeNavigation((state) => {
    if (!seenInitial) {
      seenInitial = true;
      return;
    }
    navigationStates.push(state.state);
  });

  return {
    router,
    fetched: () => fetchSpy.mock.calls.map(([url]) => String(url)),
    navigationStates,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const remove of listeners.splice(0)) remove();
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  active?.destroy();
  active = undefined;
  delete (window as unknown as { __FARM_SPA_ROUTER__?: SPARouter }).__FARM_SPA_ROUTER__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("notifyHistoryChange", () => {
  it("emits the event with the page-state kind and never a popstate", async () => {
    const kinds: string[] = [];
    const popstate = vi.fn();
    listen(FARM_HISTORY_CHANGE_EVENT, (event) => {
      kinds.push((event as CustomEvent<FarmHistoryChangeDetail>).detail.kind);
    });
    listen("popstate", popstate);

    notifyHistoryChange("page-state");
    await settle();

    expect(kinds).toEqual(["page-state"]);
    expect(popstate).not.toHaveBeenCalled();
  });

  it("emits the event with the url-search kind when a Farm router is installed", async () => {
    mountRouter();
    const kinds: string[] = [];
    const popstate = vi.fn();
    listen(FARM_HISTORY_CHANGE_EVENT, (event) => {
      kinds.push((event as CustomEvent<FarmHistoryChangeDetail>).detail.kind);
    });
    listen("popstate", popstate);

    notifyHistoryChange("url-search");
    await settle();

    expect(kinds).toEqual(["url-search"]);
    expect(popstate).not.toHaveBeenCalled();
  });

  it("falls back to a synthetic popstate for url-search without a Farm router", async () => {
    const popstate = vi.fn();
    const historyChange = vi.fn();
    listen("popstate", popstate);
    listen(FARM_HISTORY_CHANGE_EVENT, historyChange);

    notifyHistoryChange("url-search");
    await settle();

    expect(popstate).toHaveBeenCalledTimes(1);
    expect(historyChange).not.toHaveBeenCalled();
  });

  it("does not fall back to popstate for page-state without a Farm router", async () => {
    const popstate = vi.fn();
    listen("popstate", popstate);

    notifyHistoryChange("page-state");
    await settle();

    expect(popstate).not.toHaveBeenCalled();
  });
});

describe("subscribeHistoryChange", () => {
  it("receives both real popstate and history change events, and detaches on cleanup", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeHistoryChange(listener);

    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(
      new CustomEvent<FarmHistoryChangeDetail>(FARM_HISTORY_CHANGE_EVENT, {
        detail: { kind: "page-state" },
      }),
    );
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(
      new CustomEvent<FarmHistoryChangeDetail>(FARM_HISTORY_CHANGE_EVENT, {
        detail: { kind: "page-state" },
      }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("page state writes do not navigate", () => {
  it("pushState stores state without fetching page data", async () => {
    const h = mountRouter();

    h.router.pushState({ modal: "cart" });
    await settle();

    expect(readPageState()).toEqual({ modal: "cart" });
    expect(h.fetched()).toEqual([]);
    expect(h.navigationStates).toEqual([]);
  });

  it("replaceState stores state without fetching page data", async () => {
    const h = mountRouter();

    h.router.replaceState({ drawer: "filters" });
    await settle();

    expect(readPageState()).toEqual({ drawer: "filters" });
    expect(h.fetched()).toEqual([]);
    expect(h.navigationStates).toEqual([]);
  });

  it("pushState with an href updates the URL without fetching page data", async () => {
    const h = mountRouter();

    h.router.pushState({ modal: "cart" }, "/?panel=open");
    await settle();

    expect(window.location.search).toBe("?panel=open");
    expect(readPageState()).toEqual({ modal: "cart" });
    expect(h.fetched()).toEqual([]);
    expect(h.navigationStates).toEqual([]);
  });

  it("keeps usePageState in sync when page state is written", async () => {
    const h = mountRouter();
    const seen: unknown[] = [];

    function Probe() {
      seen.push(usePageState());
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(createElement(Probe)));

    await act(async () => {
      h.router.pushState({ modal: "cart" });
      await settle();
    });

    expect(seen.at(-1)).toEqual({ modal: "cart" });
  });

  it("resyncs useQueryState when a page-state write changes the query string", async () => {
    const h = mountRouter();
    let panel: string | null = null;

    function Probe() {
      const [value] = useQueryState("panel", asString);
      panel = value;
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(createElement(Probe)));

    await act(async () => {
      h.router.pushState({ modal: "cart" }, "/?panel=open");
      await settle();
    });

    expect(window.location.search).toBe("?panel=open");
    expect(panel).toBe("open");
    expect(h.fetched()).toEqual([]);
  });

  it("still runs the navigation pipeline for a real back/forward event", async () => {
    const h = mountRouter();

    window.history.pushState({ path: "/next" }, "", "/next");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { path: "/next" } }));
      await settle();
    });

    expect(h.fetched().length).toBeGreaterThan(0);
    expect(h.navigationStates).toContain("loading");
  });
});

describe("route navigation history updates", () => {
  it("keeps useRouter state in sync after a completed SPA navigation", async () => {
    const h = mountRouter();
    delete (window as unknown as { __FARM_SPA_ROUTER__?: SPARouter }).__FARM_SPA_ROUTER__;
    const popstate = vi.fn();
    listen("popstate", popstate);
    let pathname = "";

    function Probe() {
      pathname = useRouter().pathname;
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(createElement(Probe)));

    await act(async () => {
      await h.router.navigate("/next", { scroll: false });
      await settle();
    });

    expect(pathname).toBe("/next");
    expect(popstate).not.toHaveBeenCalled();
    expect(h.fetched()).toHaveLength(1);
  });
});
