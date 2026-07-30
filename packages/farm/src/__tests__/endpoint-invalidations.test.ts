import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  createFarmCacheKey,
  createRouteDataCacheKey,
  createRouteDataCacheTag,
  getFarmDataCache,
} from "../cache";
import {
  decodeFarmCacheInvalidations,
  FARM_CACHE_INVALIDATION_HEADER,
} from "../cache-invalidation";
import { createEndpoint } from "../api/endpoint";
import { invokeAPIRouteEndpoint } from "../api/runtime";

describe("endpoint invalidations", () => {
  afterEach(() => {
    getFarmDataCache().clear();
  });

  it("invalidates server keys and paths and exposes client key metadata", async () => {
    const productKey = ["product", "123"] as const;
    const routeCacheKey = createFarmCacheKey(["route-data", productKey]);
    const pathCacheKey = "products-page";
    const cache = getFarmDataCache();

    cache.set(
      routeCacheKey,
      { id: "123", name: "Old" },
      {
        tags: [createRouteDataCacheTag(productKey)],
      },
    );
    cache.set(pathCacheKey, "<html>old</html>", {
      paths: ["/products"],
    });

    const withTenant = async () => ({
      tenantId: "tenant-1",
    });
    const endpoint = createEndpoint(
      {
        method: "PATCH",
        body: z.object({
          id: z.string(),
          name: z.string(),
        }),
        middleware: [withTenant],
        invalidates: ({ body, context, result }) => {
          expectTypeOf(body).toEqualTypeOf<{
            id: string;
            name: string;
          }>();
          expectTypeOf(context.tenantId).toEqualTypeOf<string>();
          expectTypeOf(result).toEqualTypeOf<unknown>();
          expect(context.tenantId).toBe("tenant-1");

          return [{ key: ["product", body.id] }, { path: "/products" }, { tag: "products" }];
        },
      },
      async ({ body }) => ({
        id: body.id,
        name: body.name,
      }),
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://farm.test/api/products/123", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "123",
          name: "New",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(cache.getEntry(routeCacheKey)).toBeUndefined();
    expect(cache.getEntry(pathCacheKey)).toBeUndefined();
    expect(
      decodeFarmCacheInvalidations(response.headers.get(FARM_CACHE_INVALIDATION_HEADER)),
    ).toEqual([createRouteDataCacheKey(productKey)]);
  });

  it("does not invalidate when middleware prevents handler execution", async () => {
    const endpoint = createEndpoint(
      {
        method: "POST",
        middleware: [async () => false],
        invalidates: [{ key: ["products"] }],
      },
      async () => ({ created: true }),
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://farm.test/api/products", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get(FARM_CACHE_INVALIDATION_HEADER)).toBeNull();
  });

  it("does not invalidate after an error response", async () => {
    const endpoint = createEndpoint(
      {
        method: "POST",
        invalidates: [{ key: ["products"] }],
      },
      async () =>
        new Response(JSON.stringify({ error: "Conflict" }), {
          status: 409,
          headers: {
            "content-type": "application/json",
          },
        }),
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://farm.test/api/products", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get(FARM_CACHE_INVALIDATION_HEADER)).toBeNull();
  });

  it("does not invalidate after a declared endpoint failure", async () => {
    const key = ["products", "list"] as const;
    const cacheKey = createFarmCacheKey(["route-data", key]);
    const cache = getFarmDataCache();
    cache.set(cacheKey, [{ id: "existing" }], {
      tags: [createRouteDataCacheTag(key)],
    });
    const endpoint = createEndpoint(
      {
        method: "POST",
        errors: {
          conflict: {
            status: 409,
            schema: z.object({
              existingId: z.string(),
            }),
          },
        },
        invalidates: [{ key }],
      },
      async ({ fail }) =>
        fail("conflict", {
          existingId: "existing",
        }),
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://farm.test/api/products", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(cache.getEntry(cacheKey)?.value).toEqual([{ id: "existing" }]);
    expect(response.headers.get(FARM_CACHE_INVALIDATION_HEADER)).toBeNull();
  });

  it("applies declared invalidations for direct server endpoint calls", async () => {
    const key = ["products", "list"] as const;
    const cacheKey = createFarmCacheKey(["route-data", key]);
    const cache = getFarmDataCache();
    cache.set(cacheKey, [{ id: "old" }], {
      tags: [createRouteDataCacheTag(key)],
    });
    const endpoint = createEndpoint(
      "/api/products",
      {
        method: "POST",
        invalidates: [{ key }],
      },
      async () => ({ created: true }),
    );

    await expect(endpoint()).resolves.toEqual({ created: true });
    expect(cache.getEntry(cacheKey)).toBeUndefined();
  });
});
