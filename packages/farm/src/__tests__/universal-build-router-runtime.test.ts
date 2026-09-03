// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { FARM_HISTORY_CHANGE_EVENT } from "../client/history-sync";
import {
  createFarmDeploymentMismatchError,
  createFarmDeploymentRequestHeaders,
  isFarmDeploymentMismatchResponse,
} from "../deployment";
import {
  generateRuntimePathMatcherSource,
  generateUniversalRouterStateRuntime,
  generateUniversalRouterStateProperties,
} from "../nitro/universal-build";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateUniversalRouterStateProperties", () => {
  // Shared by both production runtime variants (node and edge templates).
  const runtime = generateUniversalRouterStateProperties();

  it("announces page-state writes on the dedicated history channel", () => {
    // The runtime's own popstate listener performs a full navigation, so a
    // synthetic popstate here reintroduces #420 in production builds (#424).
    expect(runtime).not.toContain("new PopStateEvent");
    expect(runtime).toContain(`new CustomEvent("${FARM_HISTORY_CHANGE_EVENT}"`);
    expect(runtime).toContain('kind: "page-state"');
  });

  it("keeps the page-state write API intact", () => {
    expect(runtime).toContain("pushState: function(state, href)");
    expect(runtime).toContain("replaceState: function(state, href)");
    expect(runtime).toContain("writePageState: function(action, state, href)");
  });

  it("aborts superseded navigations without letting them reset current state", () => {
    const createRouter = new Function(
      "window",
      "IDLE_NAVIGATION_STATE",
      "createNavigationLocation",
      `return ({${runtime}});`,
    ) as (
      windowValue: { location: { pathname: string; search: string } },
      idleState: object,
      createLocation: (url: URL) => object,
    ) => {
      activeNavigation: { id: number; controller: AbortController } | null;
      finishNavigation(navigation: { id: number; controller: AbortController }): void;
      getNavigationState(): { state: string };
      startNavigation(
        from: string,
        to: URL,
        action: string,
      ): { id: number; controller: AbortController };
    };
    const router = createRouter(
      { location: { pathname: "/start", search: "" } },
      { state: "idle", pending: false },
      (url) => ({ href: url.href }),
    );

    const first = router.startNavigation("/start", new URL("https://example.test/slow"), "push");
    const second = router.startNavigation("/start", new URL("https://example.test/fast"), "push");

    expect(first.controller.signal.aborted).toBe(true);
    expect(router.activeNavigation?.id).toBe(second.id);
    router.finishNavigation(first);
    expect(router.getNavigationState().state).toBe("loading");
    router.finishNavigation(second);
    expect(router.getNavigationState().state).toBe("idle");
  });

  it("invalidates plain and interception-qualified prefetch entries together", () => {
    const createRouter = new Function(
      "window",
      "IDLE_NAVIGATION_STATE",
      "createNavigationLocation",
      `return ({${runtime} prefetchCache: new Map([
        ["/reports", "plain"],
        ["/reports\\nintercept:/dashboard", "intercepted"],
        ["/settings", "other"],
      ])});`,
    ) as (
      windowValue: { location: { pathname: string; search: string } },
      idleState: object,
      createLocation: (url: URL) => object,
    ) => {
      clearPrefetchedPath(url: string): void;
      prefetchCache: Map<string, string>;
    };
    const router = createRouter(
      { location: { pathname: "/", search: "" } },
      { state: "idle", pending: false },
      (url) => ({ href: url.href }),
    );

    router.clearPrefetchedPath("/reports");

    expect([...router.prefetchCache.keys()]).toEqual(["/settings"]);
  });

  it("restores a blocked pop without assuming indexed entries are contiguous", () => {
    const history = {
      state: null as Record<string, unknown> | null,
      go: vi.fn(),
      pushState: vi.fn((state: Record<string, unknown>) => {
        history.state = state;
      }),
      replaceState: vi.fn((state: Record<string, unknown>) => {
        history.state = state;
      }),
    };
    const windowValue = {
      history,
      location: {
        href: "https://example.test/",
        origin: "https://example.test",
        pathname: "/",
        search: "",
      },
    };
    const createRouter = new Function(
      "window",
      "document",
      "IDLE_NAVIGATION_STATE",
      "createNavigationLocation",
      "createHistoryState",
      "readHistoryIndex",
      "FARM_PAGE_STATE_KEY",
      "FARM_HISTORY_INDEX_KEY",
      "URL",
      "CustomEvent",
      `return ({${runtime}});`,
    );
    const createHistoryState = (path: string, pageState: unknown, currentState?: unknown) => ({
      ...(currentState && typeof currentState === "object" ? currentState : {}),
      path,
      __farmPageState: pageState,
    });
    const readHistoryIndex = (state: unknown) => {
      if (!state || typeof state !== "object") return null;
      const value = (state as Record<string, unknown>).__farmHistoryIndex;
      return typeof value === "number" ? value : null;
    };
    const router = createRouter(
      windowValue,
      { documentElement: { dataset: {} } },
      { state: "idle" },
      (url: URL) => ({ href: url.href }),
      createHistoryState,
      readHistoryIndex,
      "__farmPageState",
      "__farmHistoryIndex",
      URL,
      Event,
    );

    router.initializeHistory();
    router.writeHistoryEntry("push", "/edit", null, "https://example.test/edit");
    router.revertBlockedPopState("/edit");

    expect(history.go).not.toHaveBeenCalled();
    expect(history.pushState).toHaveBeenLastCalledWith(
      expect.objectContaining({ __farmHistoryIndex: 1, path: "/edit" }),
      "",
      "/edit",
    );
  });

  it("accepts only safe integer history indexes", () => {
    const getReader = new Function(
      `${generateUniversalRouterStateRuntime()}; return readHistoryIndex;`,
    ) as () => (state: unknown) => number | null;
    const readHistoryIndex = getReader();

    expect(readHistoryIndex({ __farmHistoryIndex: 2 })).toBe(2);
    expect(readHistoryIndex({ __farmHistoryIndex: 1.5 })).toBeNull();
    expect(readHistoryIndex({ __farmHistoryIndex: Number.POSITIVE_INFINITY })).toBeNull();
    expect(readHistoryIndex({ __farmHistoryIndex: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
  });

  it("restores registered scroll elements with the current query string", () => {
    expect(runtime).toContain(
      "this.restoreScrollElement(window.location.pathname + window.location.search, key, element)",
    );
    expect(runtime).not.toContain(
      "this.restoreScrollElement(window.location.pathname, key, element)",
    );
  });
});

describe("generated deployment navigation guard", () => {
  const createGuard = () =>
    new Function(
      "createFarmDeploymentMismatchError",
      "createFarmDeploymentRequestHeaders",
      "isFarmDeploymentMismatchResponse",
      `${generateUniversalRouterStateRuntime()}; return fetchFarmNavigationDocument;`,
    )(
      createFarmDeploymentMismatchError,
      createFarmDeploymentRequestHeaders,
      isFarmDeploymentMismatchResponse,
    ) as (url: string, headers: HeadersInit, recover?: boolean) => Promise<Response>;

  it("reports a prefetched deployment mismatch without navigating", async () => {
    const assign = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      __FARM_DEPLOYMENT_ID__: "release-1",
      dispatchEvent,
      location: { assign },
    });
    vi.stubGlobal(
      "CustomEvent",
      class {
        constructor(
          readonly type: string,
          readonly init: { detail: unknown },
        ) {}
      },
    );
    const response = new Response(null, {
      status: 409,
      headers: {
        "x-farm-deployment-id": "release-2",
        "x-farm-deployment-mismatch": "1",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(createGuard()("/reports", { Accept: "text/html" }, false)).rejects.toMatchObject({
      name: "FarmDeploymentMismatchError",
      clientDeploymentId: "release-1",
      serverDeploymentId: "release-2",
    });

    const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(requestHeaders.get("x-farm-deployment-id")).toBe("release-1");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("navigates to the requested URL when recovery is enabled", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      __FARM_DEPLOYMENT_ID__: "release-1",
      dispatchEvent: vi.fn(),
      location: { assign },
    });
    vi.stubGlobal(
      "CustomEvent",
      class {
        constructor(
          readonly type: string,
          readonly init: { detail: unknown },
        ) {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 409,
          headers: {
            "x-farm-deployment-id": "release-2",
            "x-farm-deployment-mismatch": "1",
          },
        }),
      ),
    );

    await expect(createGuard()("/reports", { Accept: "text/html" })).rejects.toMatchObject({
      name: "FarmDeploymentMismatchError",
    });
    expect(assign).toHaveBeenCalledWith("/reports");
  });

  it("clears older prefetched HTML after a deployment mismatch", () => {
    const getHandler = new Function(
      `${generateUniversalRouterStateRuntime()}; return clearFarmPrefetchCacheOnDeploymentMismatch;`,
    ) as () => (router: { prefetchCache: Map<string, string> }, error: Error) => void;
    const clearOnMismatch = getHandler();
    const router = {
      prefetchCache: new Map([
        ["/reports", "old release"],
        ["/settings", "old release"],
      ]),
    };

    clearOnMismatch(
      router,
      Object.assign(new Error("mismatch"), { name: "FarmDeploymentMismatchError" }),
    );

    expect(router.prefetchCache.size).toBe(0);
  });
});

describe("generateRuntimePathMatcherSource", () => {
  const matcher = generateRuntimePathMatcherSource();

  it("decodes every segment kind through the guarded helper", () => {
    // Catch-all segments went through a bare decodeURIComponent, so a
    // malformed percent-encoded path threw URIError out of route matching in
    // deployed apps (#502).
    expect(matcher).toContain("map(decodeRouteSegment)");
    expect(matcher).not.toContain("map(decodeURIComponent)");
    // The only decodeURIComponent left is the one inside the guard's try.
    expect(matcher.split("decodeURIComponent(").length - 1).toBe(1);
    expect(matcher).toContain("function decodeRouteSegment(segment)");
  });
});
