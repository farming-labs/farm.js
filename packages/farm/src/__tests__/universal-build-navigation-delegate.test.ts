// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientCancellation } from "../client-cancellation";
import { getFarmIslandValueHeaders } from "../client/island-value-protocol";
import {
  delegateNavigation,
  runFarmNavigationDelegates,
  type FarmNavigationDelegateContext,
} from "../client/navigation-delegate";
import {
  createFarmDeploymentMismatchError,
  createFarmDeploymentRequestHeaders,
  isFarmDeploymentMismatchResponse,
} from "../deployment";
import {
  generateUniversalRouterStateProperties,
  generateUniversalRouterStateRuntime,
} from "../nitro/universal-build";

// The navigate methods the production client entries ship, run as emitted.
const source = readFileSync(new URL("../nitro/universal-build.ts", import.meta.url), "utf8");
const navigations = [...source.matchAll(/ {2}navigate: async function\([^]*?\n {2}},/g)].map(
  ([method]) => method,
);
const removers: Array<() => void> = [];

afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  vi.unstubAllGlobals();
});

function setup(index: number) {
  const window = {
    location: {
      href: "https://example.test/base/notes",
      origin: "https://example.test",
      pathname: "/base/notes",
      search: "",
      hash: "",
      assign: vi.fn(),
      replace: vi.fn(),
      reload: vi.fn(),
    },
    history: { state: null, back: vi.fn() },
  };
  const runtime = {
    beginNavigation: vi.fn(async () => ({ signal: new AbortController().signal })),
    cancelNavigation: vi.fn(),
    failNavigation: vi.fn(),
    markNavigationLoaded: vi.fn(),
  };
  const router = new Function(
    "window",
    "farmClientRuntime",
    "createClientCancellation",
    "createFarmDeploymentRequestHeaders",
    "isFarmDeploymentMismatchResponse",
    "createFarmDeploymentMismatchError",
    "getFarmIslandValueHeaders",
    "runFarmNavigationDelegates",
    `
      const isFarmExternalNavigationURL = (url, origin) => url.origin !== origin;
      const isFarmBlockedNavigationURL = () => false;
      const isFarmDocsPath = () => false;
      const matchRoute = () => null;
      const cancelPendingPageHydration = () => {};
      const activeRouteInterception = null;
      const matchInterceptedRouteSlot = () => null;
      ${generateUniversalRouterStateRuntime()}
      return ({
        ${generateUniversalRouterStateProperties()}
        prefetchCache: new Map(),
        fetchPage: async () => { throw new Error("stop after starting"); },
        ${navigations[index]}
        saveScrollPosition() {},
        revertBlockedPopState() {},
      });
    `,
  )(
    window,
    runtime,
    createClientCancellation,
    createFarmDeploymentRequestHeaders,
    isFarmDeploymentMismatchResponse,
    createFarmDeploymentMismatchError,
    getFarmIslandValueHeaders,
    runFarmNavigationDelegates,
  );
  router.currentPath = "/base/notes";
  vi.stubGlobal("console", { ...console, error: vi.fn() });
  return { router, window, runtime };
}

function delegate(result: boolean) {
  const seen: FarmNavigationDelegateContext[] = [];
  removers.push(
    delegateNavigation((context) => {
      seen.push(context);
      return result;
    }),
  );
  return seen;
}

it("covers both production client entries", () => {
  expect(navigations).toHaveLength(2);
});

for (const [index, renderer] of ["html", "react"].entries()) {
  describe(`${renderer} production navigation delegates`, () => {
    it("take push and replace without loading the page", async () => {
      const { router, window, runtime } = setup(index);
      const seen = delegate(true);

      await router.navigate("7?tab=edit#title");
      await router.navigate("/base/settings", { replace: true });

      expect(seen).toEqual([
        {
          url: "https://example.test/base/7?tab=edit#title",
          from: "/base/notes",
          to: "/base/7?tab=edit",
          action: "push",
        },
        {
          url: "https://example.test/base/settings",
          from: "/base/notes",
          to: "/base/settings",
          action: "replace",
        },
      ]);
      expect(runtime.beginNavigation).not.toHaveBeenCalled();
      expect(window.location.assign).not.toHaveBeenCalled();
      expect(router.currentPath).toBe("/base/notes");
      expect(router.activeNavigation).toBeNull();
    });

    it("let the router navigate when they decline", async () => {
      const { router, runtime } = setup(index);
      const seen = delegate(false);

      await router.navigate("/base/7");

      expect(seen).toHaveLength(1);
      expect(runtime.beginNavigation).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["back/forward", "https://example.test/base/7", { action: "pop", popState: null }, 1],
      ["a refresh", "/base/notes", { replace: true, refresh: true }, 1],
      // A document navigation, which a WebView's own navigation callback sees.
      ["another origin", "https://other.test/", {}, 0],
    ] as const)("are not offered %s", async (_name, href, options, loads) => {
      const { router, runtime } = setup(index);
      const seen = delegate(true);

      await router.navigate(href, options);

      expect(seen).toEqual([]);
      expect(runtime.beginNavigation).toHaveBeenCalledTimes(loads);
    });

    it("are not offered a blocked navigation", async () => {
      const { router, runtime } = setup(index);
      const seen = delegate(true);
      router.addBlocker(() => true);

      await router.navigate("/base/8");

      expect(seen).toEqual([]);
      expect(runtime.beginNavigation).not.toHaveBeenCalled();
    });
  });
}
