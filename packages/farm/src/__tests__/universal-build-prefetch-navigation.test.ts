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
const methods = [...source.matchAll(/  fetchPage: async function\([^]*?\n  },/g)].map(([method]) =>
  new Function(`return \`${method}\`;`)(),
);

afterEach(() => vi.unstubAllGlobals());

for (const [index, renderer] of ["html", "react"].entries()) {
  describe(`${renderer} production prefetch ownership`, () => {
    function setup() {
      expect(methods).toHaveLength(2);
      const window = {
        location: { pathname: "/", search: "", assign: vi.fn() },
        __FARM_DEPLOYMENT_ID__: "one",
        dispatchEvent: vi.fn(),
      };
      const router = new Function(
        "window",
        "createClientCancellation",
        "createFarmDeploymentRequestHeaders",
        "isFarmDeploymentMismatchResponse",
        "createFarmDeploymentMismatchError",
        `
        ${generateUniversalRouterStateRuntime()}
        return ({${generateUniversalRouterStateProperties()} prefetchCache: new Map(), ${methods[index]}});
      `,
      )(
        window,
        createClientCancellation,
        createFarmDeploymentRequestHeaders,
        isFarmDeploymentMismatchResponse,
        createFarmDeploymentMismatchError,
      );
      const requests: Array<{
        resolve(response: Response): void;
        reject(error: Error): void;
        options: RequestInit;
      }> = [];
      const fetch = vi.fn(
        (_url, options) =>
          new Promise<Response>((resolve, reject) => requests.push({ resolve, reject, options })),
      );
      vi.stubGlobal("fetch", fetch);
      const page = (
        url = "/about",
        {
          prefetch = false,
          fresh = false,
          signal,
          intercept,
        }: { prefetch?: boolean; fresh?: boolean; signal?: AbortSignal; intercept?: string } = {},
      ) =>
        index === 1
          ? router.fetchPage(url, intercept, fresh, !prefetch, signal)
          : router.fetchPage(url, fresh, !prefetch, signal);
      return { router, window, requests, fetch, page };
    }

    it("shares pending HTML, releases the record, and reuses the completed prefetch", async () => {
      const { page, requests, fetch, router } = setup();
      const preload = page("/about", { prefetch: true });
      const navigation = page();
      expect(fetch).toHaveBeenCalledTimes(1);
      requests[0].resolve(new Response("about"));
      expect(await preload).toBe("about");
      expect(await navigation).toBe("about");
      expect(router.pendingPrefetches.size).toBe(0);
      expect(await page()).toBe("about");
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("cancels a waiting navigation without aborting its prefetch", async () => {
      const { page, requests, fetch, router } = setup();
      const preload = page("/about", { prefetch: true });
      const controller = new AbortController();
      const navigation = page("/about", { signal: controller.signal });
      controller.abort(new DOMException("superseded", "AbortError"));
      await expect(navigation).rejects.toMatchObject({ name: "AbortError" });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(requests[0].options.signal).toBeUndefined();
      requests[0].resolve(new Response("about"));
      await preload;
      expect(router.readFreshPrefetch("/about")).toBe("about");
    });

    it("retries failed prefetches for navigation and cleans up failed work", async () => {
      const { page, requests, fetch, router } = setup();
      const preload = page("/about", { prefetch: true });
      const failed = expect(preload).rejects.toThrow("offline");
      const navigation = page();
      requests[0].reject(new Error("offline"));
      await failed;
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      requests[1].resolve(new Response("retry"));
      expect(await navigation).toBe("retry");
      expect(router.pendingPrefetches.size).toBe(0);
    });

    it("refresh bypasses pending work and the old response cannot repopulate the cache", async () => {
      const { page, requests, fetch, router } = setup();
      const preload = page("/about", { prefetch: true });
      const fresh = page("/about", { fresh: true });
      expect(fetch).toHaveBeenCalledTimes(2);
      requests[1].resolve(new Response("fresh"));
      await fresh;
      requests[0].resolve(new Response("old"));
      await preload;
      expect(router.readFreshPrefetch("/about")).not.toBe("old");
      expect(router.pendingPrefetches.size).toBe(0);
    });

    it("cache clear prevents late prefetch writes", async () => {
      const { page, requests, router } = setup();
      const preload = page("/about", { prefetch: true });
      router.clearCache();
      requests[0].resolve(new Response("old"));
      await preload;
      expect(router.prefetchCache.size).toBe(0);
      expect(router.pendingPrefetches.size).toBe(0);
    });

    it("does not share work across deployment identities", async () => {
      const { page, requests, window, fetch } = setup();
      const preload = page("/about", { prefetch: true });
      window.__FARM_DEPLOYMENT_ID__ = "two";
      const navigation = page();
      expect(fetch).toHaveBeenCalledTimes(2);
      requests[1].resolve(new Response("new release"));
      requests[0].resolve(new Response("old release"));
      await Promise.all([preload, navigation]);
    });

    it("deduplicates simultaneous prefetches and releases failed HTTP responses", async () => {
      const { page, requests, fetch, router } = setup();
      const first = page("/about", { prefetch: true });
      const second = page("/about", { prefetch: true });
      const results = Promise.allSettled([first, second]);
      expect(fetch).toHaveBeenCalledTimes(1);
      requests[0].resolve(new Response("failed", { status: 500 }));
      expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
      expect(router.pendingPrefetches.size).toBe(0);
      expect(router.prefetchCache.size).toBe(0);
      const retry = page("/about", { prefetch: true });
      requests[1].resolve(new Response("retry"));
      expect(await retry).toBe("retry");
    });

    it("a cleared record cannot remove a replacement prefetch or publish old HTML", async () => {
      const { page, requests, router } = setup();
      const old = page("/about", { prefetch: true });
      router.clearPrefetchedPath("/about");
      const replacement = page("/about", { prefetch: true });
      requests[0].resolve(new Response("old"));
      await old;
      expect(router.pendingPrefetches.size).toBe(1);
      expect(router.prefetchCache.size).toBe(0);
      requests[1].resolve(new Response("new"));
      await replacement;
      expect(router.pendingPrefetches.size).toBe(0);
      expect(router.readFreshPrefetch("/about")).toBe("new");
    });

    it("recovers deployment mismatches for waiting navigation, not background prefetch", async () => {
      const { page, requests, window, fetch } = setup();
      vi.stubGlobal(
        "CustomEvent",
        class {
          constructor(
            readonly type: string,
            readonly init: unknown,
          ) {}
        },
      );
      const preload = page("/about", { prefetch: true });
      const navigation = page();
      const result = Promise.allSettled([preload, navigation]);
      requests[0].resolve(
        new Response(null, {
          status: 409,
          headers: { "x-farm-deployment-id": "two", "x-farm-deployment-mismatch": "1" },
        }),
      );
      expect((await result).map((value) => value.status)).toEqual(["rejected", "rejected"]);
      expect(window.location.assign).toHaveBeenCalledExactlyOnceWith("/about");
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("does not start work for an already cancelled navigation", async () => {
      const { page, fetch } = setup();
      const controller = new AbortController();
      controller.abort();
      await expect(page("/about", { signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    if (index === 1)
      it("keeps interception contexts separate", async () => {
        const { page, requests, fetch } = setup();
        const preload = page("/about", { prefetch: true });
        const navigation = page("/about", { intercept: "/gallery" });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(new Headers(requests[1].options.headers).get("X-Farm-Intercept-From")).toBe(
          "/gallery",
        );
        requests[0].resolve(new Response("ordinary"));
        requests[1].resolve(new Response("intercepted"));
        expect(await preload).toBe("ordinary");
        expect(await navigation).toBe("intercepted");
      });
  });
}
