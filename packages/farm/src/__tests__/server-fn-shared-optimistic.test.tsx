// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, type UseMutationReturn } from "../mutation-client";
import { getFarmClientDataCache, normalizeFarmClientCacheKey } from "../client-cache";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (e: Error) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  getFarmClientDataCache().clear();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  getFarmClientDataCache().clear();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

function seedProducts(key: string, products: string[]) {
  getFarmClientDataCache().set(key, {
    data: { products },
    updatedAt: Date.now(),
    staleAt: Number.POSITIVE_INFINITY,
  });
}

describe("server-function shared-cache optimistic updates", () => {
  it("applies before the server responds, commits on success, and invalidates targets", async () => {
    const cache = getFarmClientDataCache();
    const key = normalizeFarmClientCacheKey(["products", "tools"]);
    seedProducts(key, ["hammer"]);
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(key, listener);

    const gate = deferred<{ ok: boolean }>();
    const serverFn = async () => gate.promise;

    let mutation!: UseMutationReturn<typeof serverFn>;
    function View() {
      mutation = useMutation(serverFn, {
        request: {
          optimistic: {
            update: [
              [
                ["products", "tools"],
                (current: any) => ({ products: [...(current?.products ?? []), "drill"] }),
              ],
            ],
            rollbackOnError: true,
          },
          invalidate: [["products", "tools"]],
        },
      });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    let settled: Promise<{ ok: boolean }>;
    await act(async () => {
      settled = mutation.mutateAsync();
      await Promise.resolve();
    });

    // The optimistic layer is visible to every consumer of the shared key
    // while the server function is still running.
    expect(cache.get<{ products: string[] }>(key)?.data.products).toEqual(["hammer", "drill"]);
    expect(listener).toHaveBeenCalled();
    expect(cache.isStale(key)).toBe(false);

    await act(async () => {
      gate.resolve({ ok: true });
      await settled;
    });

    // Committed data stays rendered; the invalidate target is stale so the
    // next read loads the canonical server list.
    expect(cache.get<{ products: string[] }>(key)?.data.products).toEqual(["hammer", "drill"]);
    expect(cache.isStale(key)).toBe(true);
    unsubscribe();
  });

  it("restores the previous entry on failure with rollbackOnError", async () => {
    const cache = getFarmClientDataCache();
    const key = normalizeFarmClientCacheKey(["products", "tools"]);
    seedProducts(key, ["hammer"]);

    const gate = deferred<never>();
    const serverFn = async () => gate.promise;

    let mutation!: UseMutationReturn<typeof serverFn>;
    function View() {
      mutation = useMutation(serverFn, {
        request: {
          optimistic: {
            update: [
              [
                ["products", "tools"],
                (current: any) => ({ products: [...(current?.products ?? []), "drill"] }),
              ],
            ],
            rollbackOnError: true,
          },
        },
      });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    await act(async () => {
      const settled = mutation.mutateAsync().catch(() => {});
      await Promise.resolve();
      expect(cache.get<{ products: string[] }>(key)?.data.products).toEqual(["hammer", "drill"]);
      gate.reject(new Error("rejected"));
      await settled;
    });

    expect(cache.get<{ products: string[] }>(key)?.data.products).toEqual(["hammer"]);
    expect(cache.isStale(key)).toBe(false);
  });

  it("marks the touched entry stale on failure without rollback", async () => {
    const cache = getFarmClientDataCache();
    const key = normalizeFarmClientCacheKey(["products", "tools"]);
    seedProducts(key, ["hammer"]);

    const serverFn = async () => {
      throw new Error("rejected");
    };

    let mutation!: UseMutationReturn<typeof serverFn>;
    function View() {
      mutation = useMutation(serverFn, {
        request: {
          optimistic: {
            update: [
              [
                ["products", "tools"],
                (current: any) => ({ products: [...(current?.products ?? []), "drill"] }),
              ],
            ],
          },
        },
      });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    await act(async () => {
      await expect(mutation.mutateAsync()).rejects.toThrow("rejected");
    });

    expect(cache.isStale(key)).toBe(true);
  });

  it("skips route-reference update tuples and unresolvable invalidate targets", async () => {
    const cache = getFarmClientDataCache();
    const key = normalizeFarmClientCacheKey(["products", "tools"]);
    seedProducts(key, ["hammer"]);

    const routeRef = Object.assign(async () => ({}), { __isRouteRef: true });
    const serverFn = async () => ({ ok: true });

    let mutation!: UseMutationReturn<typeof serverFn>;
    function View() {
      mutation = useMutation(serverFn, {
        request: {
          optimistic: {
            update: [[routeRef as any, {}, (current: any) => current]],
          },
          invalidate: [[routeRef as any]],
        },
      });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    await act(async () => {
      await mutation.mutateAsync();
    });

    expect(cache.get<{ products: string[] }>(key)?.data.products).toEqual(["hammer"]);
    expect(cache.isStale(key)).toBe(false);
    expect(mutation.status).toBe("success");
  });

  it("invalidates explicit key-object targets through the shared bus", async () => {
    const cache = getFarmClientDataCache();
    const key = normalizeFarmClientCacheKey(["cart", "u1"]);
    seedProducts(key, ["hammer"]);

    const serverFn = async () => ({ ok: true });
    let mutation!: UseMutationReturn<typeof serverFn>;
    function View() {
      mutation = useMutation(serverFn, {
        request: { invalidate: [{ key: ["cart", "u1"] }] },
      });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    await act(async () => {
      await mutation.mutateAsync();
    });

    expect(cache.isStale(key)).toBe(true);
  });

  it("leaves API-route targets to the API client's own optimistic engine", async () => {
    const cache = getFarmClientDataCache();
    const key = normalizeFarmClientCacheKey(["products", "tools"]);
    seedProducts(key, ["hammer"]);

    // API-route refs are marked by the client factory; simulate the marker the
    // lifecycle checks so the server-fn path must not run.
    const apiTarget = Object.assign(
      async (_variables: unknown, _request: unknown) => ({ data: { ok: true }, error: null }),
      { [Symbol.for("farm.api.route-ref")]: true },
    );

    let mutation!: UseMutationReturn<typeof apiTarget>;
    function View() {
      mutation = useMutation(apiTarget, {
        request: {
          optimistic: {
            update: [[["products", "tools"], (current: any) => ({ products: ["clobbered"] })]],
          },
        },
      });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));

    await act(async () => {
      await mutation.mutateAsync(undefined as never);
    });

    // The shared-cache fast path must not double-apply what the API client
    // already handles for its own targets.
    expect(cache.get<{ products: string[] }>(key)?.data.products).toEqual(["hammer"]);
  });
});
