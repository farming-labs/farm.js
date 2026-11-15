/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";
import { createDeferredDataResponse, defer } from "../deferred";
import * as deferred from "../deferred";

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function pageResponse(title = "Destination") {
  return Response.json({ props: {}, modulePath: "/page.js", metadata: { title } });
}

describe("navigation during prefetch", () => {
  let router: SPARouter;
  let requests: Array<ReturnType<typeof gate<Response>> & { init?: RequestInit }>;
  let render: ReturnType<typeof vi.fn>;
  let fetchPageData: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.replaceState(null, "", "/start");
    document.body.innerHTML = "";
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const request = { ...gate<Response>(), init };
        requests.push(request);
        return request.promise;
      }),
    );
    router = new SPARouter({ scrollRestoration: false });
    render = vi.fn(async () => {});
    router.setNavigationHandler(render);
    fetchPageData = vi.spyOn(router as any, "fetchPageData");
  });

  afterEach(() => {
    router.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function navigate(href = "/destination", options = {}) {
    const calls = fetchPageData.mock.calls.length;
    const done = router.navigate(href, { scroll: false, ...options });
    await vi.waitFor(() => expect(fetchPageData).toHaveBeenCalledTimes(calls + 1));
    return { done };
  }

  it("uses one JSON request when navigation catches an in-flight prefetch", async () => {
    const prefetched = router.prefetch("/destination");
    const navigation = await navigate();
    expect(fetch).toHaveBeenCalledTimes(1);
    requests[0].resolve(pageResponse());
    await Promise.all([prefetched, navigation.done]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("Destination");
    expect(window.location.pathname).toBe("/destination");
    expect((router as any).pendingPrefetches.size).toBe(0);
  });

  it("reuses an already-completed prefetch without another request", async () => {
    const prefetched = router.prefetch("/destination");
    requests[0].resolve(pageResponse());
    await prefetched;
    await (
      await navigate()
    ).done;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("shares prefetch work while its JSON body is still being decoded", async () => {
    const body = gate<{ props: {}; modulePath: string }>();
    const response = pageResponse();
    const json = vi.spyOn(response, "json").mockImplementation(() => body.promise);
    const prefetched = router.prefetch("/destination");
    requests[0].resolve(response);
    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    const navigation = await navigate();
    expect(fetch).toHaveBeenCalledTimes(1);
    body.resolve({ props: {}, modulePath: "/page.js" });
    await Promise.all([prefetched, navigation.done]);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("lets a newer navigation to the same URL reuse the surviving prefetch", async () => {
    const prefetched = router.prefetch("/destination");
    const first = await navigate();
    const second = await navigate();
    await first.done;
    expect(fetch).toHaveBeenCalledTimes(1);
    requests[0].resolve(pageResponse());
    await Promise.all([prefetched, second.done]);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("cancels a waiting navigation without cancelling the prefetch", async () => {
    const prefetched = router.prefetch("/destination");
    const first = await navigate();
    const navigationSignal = (router as any).activeNavigation.controller.signal as AbortSignal;
    const removed = vi.spyOn(navigationSignal, "removeEventListener");
    const second = await navigate("/other");
    await first.done;
    expect(navigationSignal.aborted).toBe(true);
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(requests[0].init?.signal?.aborted).not.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    requests[1].resolve(pageResponse("Other"));
    await second.done;
    requests[0].resolve(pageResponse("Old"));
    await prefetched;
    expect(render).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("Other");
    expect(window.location.pathname).toBe("/other");
  });

  it("keeps a refresh independent and prevents older prefetch cache writes", async () => {
    const prefetched = router.prefetch("/destination");
    const navigation = await navigate("/destination", { refresh: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    requests[1].resolve(pageResponse("Fresh"));
    await navigation.done;
    requests[0].resolve(pageResponse("Old"));
    await prefetched;
    const cached = (router as any).cache.get("/destination\nintercept:/start");
    expect(cached.data.metadata.title).toBe("Fresh");
    expect(document.title).toBe("Fresh");
  });

  for (const context of ["layout", "interception"] as const) {
    it(`does not share data across a different ${context} context`, async () => {
      const prefetched = router.prefetch("/destination");
      if (context === "layout") {
        document.body.innerHTML =
          '<div data-farm-layout-boundary="true" data-farm-layout-pattern="/changed"></div>';
      } else {
        window.history.replaceState(null, "", "/other-origin");
      }
      const navigation = await navigate();
      expect(fetch).toHaveBeenCalledTimes(2);
      requests[1].resolve(pageResponse("New context"));
      requests[0].resolve(pageResponse("Old context"));
      await Promise.all([prefetched, navigation.done]);
      expect(document.title).toBe("New context");
    });
  }

  for (const failure of ["network", "http", "json"] as const) {
    it(`retries navigation independently after a ${failure} prefetch failure`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const prefetched = router.prefetch("/destination");
      const navigation = await navigate();
      if (failure === "network") requests[0].reject(new Error("offline"));
      else requests[0].resolve(new Response("broken", { status: failure === "http" ? 500 : 200 }));
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1].init?.signal).toBeInstanceOf(AbortSignal);
      requests[1].resolve(pageResponse("Recovered"));
      await Promise.all([prefetched, navigation.done]);
      expect(document.title).toBe("Recovered");
      expect((router as any).pendingPrefetches.size).toBe(0);
    });
  }

  it("keeps deferred stream ownership independent and does not wait for deferred values", async () => {
    const slowValue = gate<string>();
    const prefetched = router.prefetch("/destination");
    const navigation = await navigate();
    requests[0].resolve(
      createDeferredDataResponse({
        props: { slow: defer(slowValue.promise) },
        modulePath: "/page.js",
      }),
    );
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].init?.signal).toBeInstanceOf(AbortSignal);
    requests[1].resolve(pageResponse("Independent"));
    await Promise.all([prefetched, navigation.done]);
    expect(document.title).toBe("Independent");
    expect((router as any).pendingPrefetches.size).toBe(0);
    slowValue.resolve("complete");
  });

  it("releases cache-clear waiters and ignores pre-clear responses", async () => {
    const prefetched = router.prefetch("/destination");
    const navigation = await navigate();
    router.clearCache();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    requests[1].resolve(pageResponse("After clear"));
    await navigation.done;
    requests[0].resolve(pageResponse("Before clear"));
    await prefetched;
    const cached = (router as any).cache.get("/destination\nintercept:/start");
    expect(cached.data.metadata.title).toBe("After clear");
    expect((router as any).pendingPrefetches.size).toBe(0);
  });

  it("does not repopulate a cleared cache when a deferred prefetch finishes late", async () => {
    const completed = gate<void>();
    const read = deferred.readDeferredDataResponse;
    vi.spyOn(deferred, "readDeferredDataResponse").mockImplementation((response, options) =>
      read(response, {
        ...options,
        onComplete() {
          options?.onComplete?.();
          completed.resolve();
        },
      }),
    );
    const value = gate<string>();
    const prefetched = router.prefetch("/destination");
    requests[0].resolve(
      createDeferredDataResponse({ props: { slow: defer(value.promise) }, modulePath: "/page.js" }),
    );
    await prefetched;
    const write = vi.spyOn(router as any, "cachePageData");
    router.clearCache();
    value.resolve("late");
    await completed.promise;
    expect(write).not.toHaveBeenCalled();
    expect((router as any).cache.size).toBe(0);
  });

  it("releases waiters on destroy without caching late results", async () => {
    const prefetched = router.prefetch("/destination");
    const navigation = await navigate();
    router.destroy();
    await navigation.done;
    expect((router as any).pendingPrefetches.size).toBe(0);
    requests[0].resolve(pageResponse());
    await prefetched;
    await router.prefetch("/after-destroy");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    expect((router as any).cache.size).toBe(0);
  });
});
