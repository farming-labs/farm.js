/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAPIClient } from "../api/client";
import { createRouteDataCacheKey, applyFarmCacheInvalidations } from "../cache";
import { getFarmClientDataCache } from "../client-cache";
import type { ServerQuery } from "../server-query";
import {
  beginFarmServerQueryAction,
  completeFarmServerQueryAction,
  prefetchServerQuery,
  useServerQuery,
} from "../server-query-client";
import { createFarmServerQueryResult } from "../server-query-protocol";

type Product = { id: string; version: number };
type ProductAPI = {
  products: {
    get: {
      __types: {
        body: never;
        query: never;
        response: Product;
      };
    };
  };
};

function createTransportedQuery(
  handler: (input: { id: string }) => Product | Promise<Product>,
  staleTime: number | false = 10_000,
): ServerQuery<{ id: string }, Product> {
  return (async (input: { id: string }) => {
    const invocation = beginFarmServerQueryAction("product-query", [input]);
    const data = await handler(input);
    return completeFarmServerQueryAction(
      invocation,
      createFarmServerQueryResult(data, {
        key: createRouteDataCacheKey(["product", input.id]),
        staleTime,
        updatedAt: Date.now(),
      }),
    );
  }) as ServerQuery<{ id: string }, Product>;
}

describe("server query client", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    getFarmClientDataCache().clear();
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container.remove();
    root = undefined;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("deduplicates prefetches and serves them to every mounted consumer", async () => {
    let calls = 0;
    const product = createTransportedQuery(async ({ id }) => {
      calls++;
      await Promise.resolve();
      return { id, version: calls };
    });

    const [first, second] = await Promise.all([
      prefetchServerQuery(product, { id: "123" }),
      prefetchServerQuery(product, { id: "123" }),
    ]);
    expect(first).toEqual({ id: "123", version: 1 });
    expect(second).toEqual(first);

    function ProductView() {
      const query = useServerQuery(product, { id: "123" });
      return createElement("span", null, query.data?.version ?? "pending");
    }

    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement("div", null, createElement(ProductView), createElement(ProductView)),
      );
    });

    expect(container.textContent).toBe("11");
    expect(calls).toBe(1);
  });

  it("shares structured entries with the API client cache", async () => {
    const product = createTransportedQuery(({ id }) => ({ id, version: 1 }));
    await prefetchServerQuery(product, { id: "123" });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const api = createAPIClient<ProductAPI>({ baseURL: "https://farm.test" });
    const result = await api.products.get(undefined, {
      cache: {
        key: ["product", "123"],
        policy: "cache-first",
        staleTime: 10_000,
      },
    });

    expect(result.data).toEqual({ id: "123", version: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns stale data while revalidating in the background", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const product = createTransportedQuery(async ({ id }) => {
      calls++;
      if (calls === 2) await gate;
      return { id, version: calls };
    }, 100);

    await prefetchServerQuery(product, { id: "123" });
    vi.advanceTimersByTime(101);

    function ProductView() {
      const query = useServerQuery(product, { id: "123" });
      return createElement("span", null, `${query.data?.version}:${query.fetching}`);
    }

    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(ProductView));
    });
    expect(container.textContent).toBe("1:true");

    await act(async () => {
      release();
      await gate;
    });
    expect(container.textContent).toBe("2:false");
    expect(calls).toBe(2);
  });

  it("refetches mounted queries after a shared structured invalidation", async () => {
    let calls = 0;
    const product = createTransportedQuery(({ id }) => ({ id, version: ++calls }));

    function ProductView() {
      const query = useServerQuery(product, { id: "123" });
      return createElement("span", null, query.data?.version ?? "pending");
    }

    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(ProductView));
    });
    expect(container.textContent).toBe("1");

    await act(async () => {
      applyFarmCacheInvalidations([createRouteDataCacheKey(["product", "123"])]);
    });

    expect(container.textContent).toBe("2");
    expect(calls).toBe(2);
  });
});
