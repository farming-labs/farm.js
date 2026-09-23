// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { FARM_HISTORY_CHANGE_EVENT } from "../client/history-sync";
import {
  createFarmDeploymentMismatchError,
  createFarmDeploymentRequestHeaders,
  isFarmDeploymentMismatchResponse,
} from "../deployment";
import {
  generateConfiguredResponseHeadersRuntimeSource,
  generateRedirectInterpolationSource,
  generateRuntimePathMatcherSource,
  generateUniversalRouterStateRuntime,
  generateUniversalRouterStateProperties,
} from "../nitro/universal-build";
import {
  compileConfigRoutePattern,
  interpolateConfigRouteDestination,
  resolveConfigRoutePathname,
} from "../plugins/route-pattern";
import { resolveFarmI18nConfig } from "../i18n/config";

describe("generateConfiguredResponseHeadersRuntimeSource", () => {
  it("preserves handler and configured Set-Cookie fields separately", () => {
    const source = generateConfiguredResponseHeadersRuntimeSource();
    const applyConfiguredResponseHeaders = new Function(
      "configuredHeaderRoutes",
      "matchRuntimePathPattern",
      "appendFarmLinkHeader",
      `${source}; return applyConfiguredResponseHeaders;`,
    )(
      [
        {
          source: "/account",
          headers: [
            { key: "Set-Cookie", value: "theme=dark; Path=/" },
            { key: "set-cookie", value: "locale=en; Path=/" },
          ],
        },
      ],
      (source: string, pathname: string) => source === pathname,
      (headers: Headers, value: string) => headers.append("Link", value),
    ) as (response: Response, pathname: string) => Response;
    const handlerHeaders = new Headers();
    handlerHeaders.append("Set-Cookie", "session=abc; Path=/; HttpOnly");

    const response = applyConfiguredResponseHeaders(
      new Response("ok", { headers: handlerHeaders }),
      "/account",
    );

    expect(response.headers.getSetCookie()).toEqual([
      "session=abc; Path=/; HttpOnly",
      "theme=dark; Path=/",
      "locale=en; Path=/",
    ]);
  });

  it("does not duplicate an existing configured cookie", () => {
    const source = generateConfiguredResponseHeadersRuntimeSource();
    const applyConfiguredResponseHeaders = new Function(
      "configuredHeaderRoutes",
      "matchRuntimePathPattern",
      "appendFarmLinkHeader",
      `${source}; return applyConfiguredResponseHeaders;`,
    )(
      [
        {
          source: "/account",
          headers: [{ key: "Set-Cookie", value: "theme=dark; Path=/" }],
        },
      ],
      () => true,
      (headers: Headers, value: string) => headers.append("Link", value),
    ) as (response: Response, pathname: string) => Response;

    const response = applyConfiguredResponseHeaders(
      new Response("ok", { headers: { "Set-Cookie": "theme=dark; Path=/" } }),
      "/account",
    );

    expect(response.headers.getSetCookie()).toEqual(["theme=dark; Path=/"]);
  });
});

describe("configured response headers locale-prefix parity (production fetch entry)", () => {
  // The production fetch entry must strip the locale/base prefix before matching
  // configured header routes, mirroring the dev reference implementation in
  // plugins/headers.ts (resolveConfigRoutePathname) and the documented contract
  // that "/fr/legacy" matches a "/legacy" rule "in development and production
  // equally". Before the fix, the production call site passed the raw,
  // locale-prefixed pathname to applyConfiguredResponseHeaders, so route-scoped
  // (non-catch-all) header rules silently failed for non-default-locale
  // requests in production. This is the configured-headers counterpart of the
  // redirect/rewrite interpolation parity test below.
  const matcherSource = generateRuntimePathMatcherSource();
  const headersSource = generateConfiguredResponseHeadersRuntimeSource();
  const prod = new Function(
    "configuredHeaderRoutes",
    "appendFarmLinkHeader",
    `${matcherSource}\n${headersSource}\nreturn { matchRuntimePathPattern, applyConfiguredResponseHeaders };`,
  ) as (
    configuredHeaderRoutes: Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>,
    appendFarmLinkHeader: (headers: Headers, value: string) => void,
  ) => {
    matchRuntimePathPattern: (pattern: string, pathname: string) => Record<string, string> | null;
    applyConfiguredResponseHeaders: (response: Response, pathname: string) => Response;
  };

  function appendFarmLinkHeader(headers: Headers, value: string): void {
    const existing = headers.get("Link");
    if (existing) {
      if (!existing.includes(value)) headers.set("Link", `${existing}, ${value}`);
    } else {
      headers.set("Link", value);
    }
  }

  const i18n = resolveFarmI18nConfig(
    {
      locales: ["en", "fr"],
      defaultLocale: "en",
      routing: "prefix-except-default",
    },
    { root: "/tmp/farm-config-headers-parity", mode: "development" },
  );

  function runProduction(
    routes: Array<{ source: string; headers: Array<{ key: string; value: string }> }>,
    requestPathname: string,
  ): Response {
    // Mirror the production fetch entry: only the call site strips the
    // locale/base prefix before matching. applyConfiguredResponseHeaders itself
    // is prefix-unaware, so the strip must happen at the call site, exactly as
    // the sibling redirects/rewrites path uses getFarmRoutePathname.
    const routePathname = resolveConfigRoutePathname(requestPathname, i18n).pathname;
    const runtime = prod(routes, appendFarmLinkHeader);
    return runtime.applyConfiguredResponseHeaders(new Response("ok"), routePathname);
  }

  function runDevelopment(
    routes: Array<{ source: string; headers: Array<{ key: string; value: string }> }>,
    requestPathname: string,
  ): Record<string, string> {
    // Mirrors plugins/headers.ts: strip the locale, then match each route's
    // compiled regex against the unprefixed pathname.
    const routePathname = resolveConfigRoutePathname(requestPathname, i18n).pathname;
    const applied: Record<string, string> = {};
    for (const route of routes) {
      const compiled = compileConfigRoutePattern(route.source);
      if (!compiled.regex.test(routePathname)) continue;
      for (const header of route.headers) {
        applied[header.key.toLowerCase()] = header.value;
      }
    }
    return applied;
  }

  const cases: Array<{
    source: string;
    headerKey: string;
    headerValue: string;
    requestPathname: string;
    expectedApplied: boolean;
    // Whether the raw, locale-prefixed pathname still matches the source
    // without stripping (true only for root catch-alls that consume the
    // locale segment, or for unprefixed default-locale requests).
    rawMatches: boolean;
  }> = [
    {
      source: "/dashboard",
      headerKey: "content-security-policy",
      headerValue: "default-src 'self'",
      requestPathname: "/fr/dashboard",
      expectedApplied: true,
      rawMatches: false,
    },
    {
      source: "/api/billing/:id",
      headerKey: "x-billing",
      headerValue: "restricted",
      requestPathname: "/fr/api/billing/42",
      expectedApplied: true,
      rawMatches: false,
    },
    {
      source: "/docs/:path*",
      headerKey: "x-docs",
      headerValue: "yes",
      requestPathname: "/fr/docs/start",
      expectedApplied: true,
      rawMatches: false,
    },
    {
      source: "/dashboard",
      headerKey: "x-default-locale",
      headerValue: "still-unprefixed",
      requestPathname: "/dashboard",
      expectedApplied: true,
      rawMatches: true,
    },
    // A root catch-all source still matches a locale-prefixed pathname even
    // without stripping (the catch-all consumes the locale segment), so it
    // must keep working after the fix — guards against regressing
    // globally-scoped headers.
    {
      source: "/:path*",
      headerKey: "x-global",
      headerValue: "global",
      requestPathname: "/fr/anything",
      expectedApplied: true,
      rawMatches: true,
    },
    // A route-specific source must NOT match a locale-prefixed path for an
    // unrelated route, confirming matching stays scoped after the strip.
    {
      source: "/dashboard",
      headerKey: "x-no-match",
      headerValue: "no",
      requestPathname: "/fr/profile",
      expectedApplied: false,
      rawMatches: false,
    },
  ];

  for (const {
    source,
    headerKey,
    headerValue,
    requestPathname,
    expectedApplied,
    rawMatches,
  } of cases) {
    const label = expectedApplied ? "applies" : "does not apply";
    it(`production ${label} ${headerKey} for ${source} against ${requestPathname} in parity with dev`, () => {
      const routes = [{ source, headers: [{ key: headerKey, value: headerValue }] }];
      const runtime = prod(routes, appendFarmLinkHeader);

      // Pre-fix behavior: feeding the RAW locale-prefixed pathname to the
      // production matcher reproduces the bug for route-specific sources
      // (rawMatches === false) while catch-alls/unprefixed requests already
      // matched (rawMatches === true).
      const broken = runtime.applyConfiguredResponseHeaders(new Response("ok"), requestPathname);
      expect(broken.headers.get(headerKey)).toBe(rawMatches ? headerValue : null);

      // Fixed behavior: the production call site strips the locale/base prefix
      // before matching, so the configured header is applied iff the route
      // actually matches the locale-stripped pathname.
      const response = runProduction(routes, requestPathname);
      expect(response.headers.get(headerKey)).toBe(expectedApplied ? headerValue : null);

      // Production must match the development reference's decision exactly.
      const devValue = runDevelopment(routes, requestPathname)[headerKey] ?? null;
      expect(devValue).toBe(expectedApplied ? headerValue : null);
      expect(response.headers.get(headerKey)).toBe(devValue);
    });
  }

  it("matches the exact dev fixture: /fr/docs/start against /docs/:path* sets x-docs", () => {
    // Direct mirror of the dev test pinned in config-route-plugins.test.ts
    // ("matches locale-prefixed config routes and localizes their destinations"),
    // but exercised against the production-emitted applyConfiguredResponseHeaders.
    const routes = [{ source: "/docs/:path*", headers: [{ key: "x-docs", value: "yes" }] }];
    const response = runProduction(routes, "/fr/docs/start");
    expect(response.headers.get("x-docs")).toBe("yes");
  });
});

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
    expect(runtime).toContain('state, url, "page-state"');
  });

  it("announces ordinary route history writes to client hooks", () => {
    expect(runtime).toContain('changeKind = "url-search"');
    expect(runtime).toContain("detail: { kind: changeKind }");
  });

  it("keeps the page-state write API intact", () => {
    expect(runtime).toContain("pushState: function(state, href)");
    expect(runtime).toContain("replaceState: function(state, href)");
    expect(runtime).toContain("writePageState: function(action, state, href)");
    expect(runtime).toContain("writeURLSearch: function(action, href)");
    expect(runtime).toContain("url.pathname + url.search + url.hash");
  });

  it("keeps shallow query writes inside universal router bookkeeping", () => {
    const history = {
      state: { __farmPageState: { draft: true }, __farmHistoryIndex: 2 },
      pushState: vi.fn((state: Record<string, unknown>) => {
        history.state = state as typeof history.state;
      }),
      replaceState: vi.fn((state: Record<string, unknown>) => {
        history.state = state as typeof history.state;
      }),
    };
    const windowValue = {
      history,
      dispatchEvent: vi.fn(),
      location: {
        href: "https://example.test/start",
        origin: "https://example.test",
        pathname: "/start",
        search: "",
      },
    };
    const createRouter = new Function(
      "window",
      "IDLE_NAVIGATION_STATE",
      "createHistoryState",
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
    const router = createRouter(
      windowValue,
      { state: "idle" },
      createHistoryState,
      "__farmPageState",
      "__farmHistoryIndex",
      URL,
      Event,
    );
    router.currentHistoryIndex = 2;

    router.writeURLSearch("push", "/start?q=value#details");

    expect(history.pushState).toHaveBeenCalledWith(
      expect.objectContaining({
        __farmPageState: { draft: true },
        __farmHistoryIndex: 3,
        path: "/start?q=value#details",
      }),
      "",
      expect.any(URL),
    );
    expect(router.currentHistoryIndex).toBe(3);
    expect(router.currentPath).toBe("/start?q=value");
    expect(windowValue.dispatchEvent).not.toHaveBeenCalled();

    history.state = { __farmPageState: { draft: true }, __farmHistoryIndex: 2 };
    router.currentHistoryIndex = 2;
    router.writeURLSearch("replace", "/start?q=replaced#details");

    expect(history.replaceState).toHaveBeenCalledWith(
      expect.objectContaining({
        __farmPageState: { draft: true },
        __farmHistoryIndex: 2,
        path: "/start?q=replaced#details",
      }),
      "",
      expect.any(URL),
    );
    expect(router.currentHistoryIndex).toBe(2);
    expect(router.currentPath).toBe("/start?q=replaced");
  });

  it("checks blocker activity before prompting on unload", () => {
    expect(runtime).toContain("shouldBlockUnload: function()");
    expect(runtime).toContain("return result === true");
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
      dispatchEvent: vi.fn(),
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

describe("generateUniversalRouterStateRuntime", () => {
  it("recognizes digit-bearing schemes in the generated click runtime", () => {
    const getGuard = new Function(
      `${generateUniversalRouterStateRuntime()}; return hasAbsoluteNavigationHref;`,
    ) as () => (href: string) => boolean;
    const hasAbsoluteNavigationHref = getGuard();

    expect(hasAbsoluteNavigationHref("custom2app:open")).toBe(true);
    expect(hasAbsoluteNavigationHref("custom-app:open")).toBe(true);
    expect(hasAbsoluteNavigationHref("//cdn.example.test/file")).toBe(true);
    expect(hasAbsoluteNavigationHref("/reports")).toBe(false);
  });
});

describe("generateRuntimePathMatcherSource", () => {
  const matcher = generateRuntimePathMatcherSource();

  it("decodes every segment kind through the guarded helper", () => {
    // Catch-all segments went through a bare decodeURIComponent, so a
    // malformed percent-encoded path threw URIError out of route matching in
    // deployed apps (#502).
    expect(matcher).toContain("splitRuntimePath(pathname).map(decodeRouteSegment)");
    expect(matcher).not.toContain("map(decodeURIComponent)");
    // The only decodeURIComponent left is the one inside the guard's try.
    expect(matcher.split("decodeURIComponent(").length - 1).toBe(1);
    expect(matcher).toContain("function decodeRouteSegment(segment)");
    expect(matcher).toContain("segment !== pathnameSegment");
    expect(matcher).toContain('matched[name] = consumedSegments.join("/")');

    const matchRuntimePathPattern = new Function(
      matcher + "; return matchRuntimePathPattern;",
    )() as (pattern: string, pathname: string) => Record<string, string> | null;
    expect(matchRuntimePathPattern("/café", "/caf%C3%A9")).toEqual({});
    expect(matchRuntimePathPattern("/a%20b", "/a%2520b")).toEqual({});
  });

  it("returns null when no backtracking split lets the following segment match", () => {
    // Regression guard for the non-terminal catch-all backtracking path: when
    // no split of the catch-all lets a later segment match, the matcher must
    // still return null rather than over-matching.
    const matchRuntimePathPattern = new Function(
      matcher + "; return matchRuntimePathPattern;",
    )() as (pattern: string, pathname: string) => Record<string, string> | null;

    expect(matchRuntimePathPattern("/docs/:slug*/missing", "/docs/a/asset")).toBeNull();
  });

  it("memoizes failed matcher states across multiple non-terminal catch-alls", () => {
    const marker =
      "function matchFromUncached(patternIndex, pathIndex, params, catchAllParamSegments) {";
    const instrumented =
      "let uncachedStateVisits = 0;\n" +
      matcher.replace(marker, `${marker}\nuncachedStateVisits += 1;`);
    expect(instrumented).not.toBe(`let uncachedStateVisits = 0;\n${matcher}`);
    const runtime = new Function(
      instrumented +
        "; return { matchRuntimePathPattern, getUncachedStateVisits: () => uncachedStateVisits };",
    )() as {
      matchRuntimePathPattern: (pattern: string, pathname: string) => Record<string, string> | null;
      getUncachedStateVisits: () => number;
    };
    const pattern = "/root/:a*/x/:b*/x/:c*/x/:d*/missing";
    const pathname = `/root/${Array.from({ length: 24 }, () => "x").join("/")}/asset`;

    expect(runtime.matchRuntimePathPattern(pattern, pathname)).toBeNull();
    const stateUpperBound =
      pattern.split("/").filter(Boolean).length * pathname.split("/").filter(Boolean).length;
    expect(runtime.getUncachedStateVisits()).toBeLessThanOrEqual(stateUpperBound);
  });

  it("decodes each request segment once before backtracking", () => {
    const instrumented =
      "let decodeCalls = 0;\n" +
      matcher.replace(
        "function decodeRouteSegment(segment) {",
        "function decodeRouteSegment(segment) { decodeCalls += 1;",
      );
    const runtime = new Function(
      instrumented + "; return { matchRuntimePathPattern, getDecodeCalls: () => decodeCalls };",
    )() as {
      matchRuntimePathPattern: (pattern: string, pathname: string) => Record<string, string> | null;
      getDecodeCalls: () => number;
    };
    const pathname = `/docs/${Array.from({ length: 40 }, (_, index) => `part-${index}`).join("/")}`;

    expect(runtime.matchRuntimePathPattern("/docs/:slug*/missing", pathname)).toBeNull();
    expect(runtime.getDecodeCalls()).toBe(pathname.split("/").filter(Boolean).length);
  });
});

describe("generateRedirectInterpolationSource", () => {
  // The production redirect/rewrite interpolator must agree with the development
  // path (plugins/route-pattern.ts) exactly, including numbered captures like
  // $1 — the config docs promise they work "in development and production".
  const prod = new Function(
    generateRuntimePathMatcherSource() +
      "\n" +
      generateRedirectInterpolationSource() +
      "; return { matchRuntimePathPattern, interpolateRedirectDestination };",
  )() as {
    matchRuntimePathPattern: (p: string, path: string) => Record<string, string> | null;
    interpolateRedirectDestination: (dest: string, params: Record<string, string>) => string;
  };

  function runProduction(source: string, destination: string, pathname: string): string | null {
    const params = prod.matchRuntimePathPattern(source, pathname);
    return params ? prod.interpolateRedirectDestination(destination, params) : null;
  }

  function runDevelopment(source: string, destination: string, pathname: string): string | null {
    const compiled = compileConfigRoutePattern(source);
    const match = pathname.match(compiled.regex);
    return match ? interpolateConfigRouteDestination(destination, match, compiled.tokens) : null;
  }

  const cases: Array<{ source: string; destination: string; pathname: string; expected: string }> =
    [
      { source: "/old/:id", destination: "/new/$1", pathname: "/old/42", expected: "/new/42" },
      {
        source: "/docs/:path*",
        destination: "/help/$1",
        pathname: "/docs/a/b/c",
        expected: "/help/a/b/c",
      },
      {
        source: "/files/*",
        destination: "/assets/$1",
        pathname: "/files/x/y",
        expected: "/assets/x/y",
      },
      {
        source: "/a/:x/:y/*",
        destination: "/z/$3/$2/$1",
        pathname: "/a/1/2/w/q",
        expected: "/z/w/q/2/1",
      },
      // Non-terminal catch-alls (e.g. /docs/:slug*/asset/*) were matched by the
      // development plugin but silently dropped by the production matcher, which
      // consumed every remaining segment without backtracking. Production must
      // mirror the greedy (.*) backtracking emitted by route-pattern.ts.
      {
        source: "/docs/:slug*/asset/*",
        destination: "/new/:slug*/copy/*",
        pathname: "/docs/guides/start/asset/logo.svg",
        expected: "/new/guides/start/copy/logo.svg",
      },
      {
        source: "/docs/:slug*/asset",
        destination: "/new/:slug*/copy",
        pathname: "/docs/guides/start/asset",
        expected: "/new/guides/start/copy",
      },
      {
        source: "/x/*/y",
        destination: "/z/$1",
        pathname: "/x/a/b/y",
        expected: "/z/a/b",
      },
      {
        source: "/api/:version*/assets/*",
        destination: "/internal/:version*/files/*",
        pathname: "/api/v1/public/assets/logo.svg",
        expected: "/internal/v1/public/files/logo.svg",
      },
      // Greedy catch-alls backtrack to the latest split, matching route-pattern.ts.
      {
        source: "/docs/:slug*/asset/*",
        destination: "/new/:slug*/copy/*",
        pathname: "/docs/asset/asset/logo.svg",
        expected: "/new/asset/copy/logo.svg",
      },
      // Out-of-range numbered captures collapse to "" in both paths.
      { source: "/only/:id", destination: "/x/$9", pathname: "/only/7", expected: "/x/" },
      // Named and numbered references can be mixed in one destination.
      {
        source: "/e/:name",
        destination: "/e/:name-$1",
        pathname: "/e/foo",
        expected: "/e/foo-foo",
      },
    ];

  for (const { source, destination, pathname, expected } of cases) {
    it(`interpolates ${destination} for ${source} in parity with development`, () => {
      const production = runProduction(source, destination, pathname);
      expect(production).toBe(expected);
      // Production must match what the development redirect plugin produces.
      expect(production).toBe(runDevelopment(source, destination, pathname));
    });
  }
});
