import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { generateServiceWorker } from "./build";

function imageWorker(cached?: Response) {
  const cache = {
    match: vi.fn(async () => cached),
    put: vi.fn(async (_request: Request, response: Response) => {
      await response.arrayBuffer();
    }),
    keys: vi.fn(async (): Promise<Request[]> => []),
    delete: vi.fn(async () => true),
  };
  const caches = { open: vi.fn(async () => cache) };
  const network = new Response("network image", {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=300" },
  });
  const fetch = vi.fn(async () => network);
  const listeners = new Map<string, (event: any) => void>();
  runInNewContext(
    generateServiceWorker({
      basePath: "/",
      cacheId: "runtime-cache-test",
      precacheUrls: [],
      staticRoutes: {},
      offlineRoute: false,
      update: "prompt",
      images: { strategy: "swr", limit: 1, ttlMs: 60_000 },
    }),
    {
      caches,
      fetch,
      Headers,
      Response,
      URL,
      self: {
        location: { origin: "https://example.test" },
        addEventListener: (type: string, listener: (event: any) => void) =>
          listeners.set(type, listener),
      },
    },
  );
  const dispatch = (headers?: HeadersInit) => {
    const request = new Request("https://example.test/photo.png", { headers });
    Object.defineProperty(request, "destination", { value: "image" });
    let response!: Promise<Response>;
    let lifetime!: Promise<unknown>;
    listeners.get("fetch")!({
      request,
      respondWith: (value: Promise<Response>) => (response = value),
      waitUntil: (value: Promise<unknown>) => (lifetime = value),
    });
    return { response, lifetime, request };
  };
  return { cache, caches, fetch, network, dispatch, listeners };
}

describe("generated service worker runtime image caching", () => {
  it.each(["open", "match", "put", "keys", "trim-match", "delete"])(
    "preserves a successful network response when cache %s fails",
    async (stage) => {
      const worker = imageWorker();
      const failure = new DOMException("Cache storage unavailable", "QuotaExceededError");
      if (stage === "open") worker.caches.open.mockRejectedValue(failure);
      else if (stage === "match") worker.cache.match.mockRejectedValue(failure);
      else if (stage === "put") worker.cache.put.mockRejectedValue(failure);
      else if (stage === "keys") worker.cache.keys.mockRejectedValue(failure);
      else {
        worker.cache.keys.mockResolvedValue([
          new Request("https://example.test/old.png"),
          new Request("https://example.test/photo.png"),
        ]);
        if (stage === "trim-match") {
          worker.cache.match.mockResolvedValueOnce(undefined).mockRejectedValue(failure);
        } else worker.cache.delete.mockRejectedValue(failure);
      }

      const { response, lifetime } = worker.dispatch();
      await expect(response).resolves.toBe(worker.network);
      expect(await (await response).text()).toBe("network image");
      await lifetime;
      expect(worker.fetch).toHaveBeenCalledOnce();
    },
  );

  it("stores public images without consuming the returned response", async () => {
    const worker = imageWorker();
    const { response, lifetime, request } = worker.dispatch();
    expect(await (await response).text()).toBe("network image");
    await lifetime;
    expect(worker.cache.put).toHaveBeenCalledWith(request, expect.any(Response));
    expect(worker.cache.put.mock.calls[0][1].headers.get("x-farm-pwa-cached-at")).toBeTruthy();
    expect(worker.cache.keys).toHaveBeenCalledOnce();
  });

  it.each(["pending", "rejected"])(
    "does not wait for %s cleanup of a failed cache write",
    async (cleanup) => {
      const worker = imageWorker();
      const clone = worker.network.clone();
      vi.spyOn(worker.network, "clone").mockReturnValue(clone);
      const cancel = vi.spyOn(clone.body!, "cancel");
      if (cleanup === "pending") cancel.mockReturnValue(new Promise(() => {}));
      else cancel.mockRejectedValue(new Error("Cleanup failed"));
      worker.cache.put.mockRejectedValue(new DOMException("Quota exceeded", "QuotaExceededError"));

      const { response, lifetime } = worker.dispatch();
      await expect(response).resolves.toBe(worker.network);
      expect(cancel).toHaveBeenCalledOnce();
      expect(await (await response).text()).toBe("network image");
      await lifetime;
    },
  );

  it("returns a newer image instead of stale data when its cache write fails", async () => {
    const cached = new Response("old image", { headers: { "x-farm-pwa-cached-at": "1" } });
    const worker = imageWorker(cached);
    worker.cache.put.mockRejectedValue(new Error("Cache write failed"));
    const { response, lifetime } = worker.dispatch();
    await expect(response).resolves.toBe(worker.network);
    await lifetime;
  });

  it("keeps a fresh cached response available when background caching fails", async () => {
    const cached = new Response("cached image", {
      headers: { "x-farm-pwa-cached-at": String(Date.now()) },
    });
    const worker = imageWorker(cached);
    worker.cache.put.mockRejectedValue(new Error("Cache write failed"));
    const { response, lifetime } = worker.dispatch();
    await expect(response).resolves.toBe(cached);
    await lifetime;
    expect(worker.fetch).toHaveBeenCalledOnce();
  });

  it("does not suppress install-time precache failures", async () => {
    const worker = imageWorker();
    const failure = new DOMException("Cache storage unavailable", "QuotaExceededError");
    worker.caches.open.mockRejectedValue(failure);
    let lifetime!: Promise<unknown>;
    worker.listeners.get("install")!({
      waitUntil: (value: Promise<unknown>) => (lifetime = value),
    });
    await expect(lifetime).rejects.toBe(failure);
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it.each(["private", "no-store", "no-cache"])("does not store %s images", async (policy) => {
    const worker = imageWorker();
    worker.network.headers.set("cache-control", policy);
    const { response, lifetime } = worker.dispatch();
    await expect(response).resolves.toBe(worker.network);
    await lifetime;
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it("bypasses Cache Storage for authorized image requests", async () => {
    const worker = imageWorker();
    const { response, lifetime } = worker.dispatch({ authorization: "Bearer example" });
    await expect(response).resolves.toBe(worker.network);
    await lifetime;
    expect(worker.caches.open).not.toHaveBeenCalled();
  });

  it("preserves a real network failure when there is no cached image", async () => {
    const worker = imageWorker();
    const failure = new TypeError("Network unavailable");
    worker.fetch.mockRejectedValue(failure);
    const { response, lifetime } = worker.dispatch();
    await expect(response).rejects.toBe(failure);
    await lifetime;
    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it("returns a stale cached image when the network is unavailable", async () => {
    const cached = new Response("cached image", { headers: { "x-farm-pwa-cached-at": "1" } });
    const worker = imageWorker(cached);
    worker.fetch.mockRejectedValue(new TypeError("Network unavailable"));
    const { response, lifetime } = worker.dispatch();
    await expect(response).resolves.toBe(cached);
    await lifetime;
  });
});
