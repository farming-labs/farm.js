// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientCancellation } from "../client-cancellation";
import {
  createFarmDeploymentMismatchError,
  createFarmDeploymentRequestHeaders,
  isFarmDeploymentMismatchResponse,
} from "../deployment";
import {
  generateUniversalRouterStateProperties,
  generateUniversalRouterStateRuntime,
} from "../nitro/universal-build";

const source = readFileSync(new URL("../nitro/universal-build.ts", import.meta.url), "utf8");
const methods = (name: string) =>
  [...source.matchAll(new RegExp(`  ${name}: async function\\([^]*?\\n  },`, "g"))].map(
    ([method]) => method,
  );
const navigations = methods("navigate");
const loaders = methods("fetchPage");

afterEach(() => vi.unstubAllGlobals());

function redirectedResponse(opaque = true) {
  const response = new Response("redirected HTML must not be swapped");
  Object.defineProperty(response, opaque ? "type" : "redirected", {
    value: opaque ? "opaqueredirect" : true,
  });
  return response;
}

for (const [index, renderer] of ["html", "react"].entries()) {
  describe(`${renderer} production navigation redirects`, () => {
    function setup() {
      expect(navigations).toHaveLength(2);
      expect(loaders).toHaveLength(2);
      const window = {
        location: {
          href: "https://example.test/base/home",
          origin: "https://example.test",
          pathname: "/base/home",
          search: "",
          assign: vi.fn(),
          replace: vi.fn(),
          reload: vi.fn(),
        },
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
        `
          const isFarmExternalNavigationURL = () => false;
          const isFarmDocsPath = () => false;
          const matchRoute = () => null;
          const cancelPendingPageHydration = () => {};
          const activeRouteInterception = null;
          const matchInterceptedRouteSlot = () => null;
          ${generateUniversalRouterStateRuntime()}
          return ({
            ${generateUniversalRouterStateProperties()}
            prefetchCache: new Map(),
            ${loaders[index]}
            ${navigations[index]}
            saveScrollPosition() {},
          });
        `,
      )(
        window,
        runtime,
        createClientCancellation,
        createFarmDeploymentRequestHeaders,
        isFarmDeploymentMismatchResponse,
        createFarmDeploymentMismatchError,
      );
      const fetch = vi.fn().mockResolvedValue(redirectedResponse());
      vi.stubGlobal("fetch", fetch);
      const prefetch = () =>
        index === 1
          ? router.fetchPage("/base/old?x=1", undefined, false, false)
          : router.fetchPage("/base/old?x=1", false, false);
      return { router, window, runtime, fetch, prefetch };
    }

    it.each([true, false])(
      "does not cache or navigate speculative redirects (opaque: %s)",
      async (opaque) => {
        const { router, window, runtime, fetch, prefetch } = setup();
        fetch.mockResolvedValue(redirectedResponse(opaque));
        await expect(prefetch()).rejects.toMatchObject({ name: "FarmNavigationRedirect" });
        expect(router.prefetchCache.size).toBe(0);
        expect(router.pendingPrefetches.size).toBe(0);
        expect(window.location.assign).not.toHaveBeenCalled();
        expect(runtime.beginNavigation).not.toHaveBeenCalled();
        expect(fetch.mock.calls[0][1].redirect).toBe("manual");
      },
    );

    it.each(["push", "replace", "pop"])(
      "uses a document redirect for %s without swapping or reporting an error",
      async (action) => {
        const { router, window, runtime } = setup();
        await router.navigate("/base/old?x=1#details", { action });
        const method = action === "pop" ? "reload" : action === "replace" ? "replace" : "assign";
        expect(window.location[method as keyof typeof window.location]).toHaveBeenCalledTimes(1);
        if (action !== "pop") {
          expect(window.location[method as "replace" | "assign"]).toHaveBeenCalledWith(
            "https://example.test/base/old?x=1#details",
          );
        }
        expect(runtime.cancelNavigation).toHaveBeenCalledTimes(1);
        expect(runtime.failNavigation).not.toHaveBeenCalled();
        expect(runtime.markNavigationLoaded).not.toHaveBeenCalled();
        expect(router.activeNavigation).toBeNull();
        expect(router.currentPath).toBe("/base/home");
      },
    );

    it("shares a pending redirect without a second speculative request", async () => {
      const { router, fetch, prefetch, window } = setup();
      let resolve!: (response: Response) => void;
      fetch.mockImplementation(() => new Promise<Response>((done) => (resolve = done)));
      const pending = prefetch();
      const rejected = expect(pending).rejects.toMatchObject({ name: "FarmNavigationRedirect" });
      const navigate = router.navigate("/base/old?x=1#details");
      await vi.waitFor(() => expect(router.activeNavigation?.clientNavigation).toBeTruthy());
      resolve(redirectedResponse());
      await Promise.all([rejected, navigate]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://example.test/base/old?x=1#details",
      );
    });

    it("keeps the originally resolved relative URL if shallow history changes while loading", async () => {
      const { router, fetch, window } = setup();
      let resolve!: (response: Response) => void;
      fetch.mockImplementation(() => new Promise<Response>((done) => (resolve = done)));
      const navigation = router.navigate("old?x=1#details");
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      window.location.href = "https://example.test/another/location";
      resolve(redirectedResponse());
      await navigation;
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://example.test/base/old?x=1#details",
      );
    });

    it("does not redirect a superseded navigation when its response settles", async () => {
      const { router, fetch, window } = setup();
      let resolve!: (response: Response) => void;
      fetch.mockImplementation(() => new Promise<Response>((done) => (resolve = done)));
      const navigation = router.navigate("/base/old?x=1#details");
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      router.cancelActiveNavigation();
      resolve(redirectedResponse());
      await navigation;
      expect(window.location.assign).not.toHaveBeenCalled();
      expect(window.location.replace).not.toHaveBeenCalled();
      expect(window.location.reload).not.toHaveBeenCalled();
    });
  });
}
