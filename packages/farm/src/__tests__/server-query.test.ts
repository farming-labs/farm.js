import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  createFarmCacheKey,
  createRouteDataCacheTag,
  getFarmDataCache,
  invalidate,
} from "../cache";
import { runWithServerActionRequest } from "../server-action-security";
import { createServerMiddleware } from "../server-fn";
import { createServerQuery } from "../server-query";
import { isFarmServerQueryResult } from "../server-query-protocol";
import { _runWithCurrentRequest } from "../server/request";

describe("createServerQuery", () => {
  afterEach(() => {
    getFarmDataCache().clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("infers validated input, middleware context, and output", async () => {
    const session = createServerMiddleware({
      async handler({ next }) {
        return next({ context: { userId: "user-1" } });
      },
    });
    const product = createServerQuery({
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string(), owner: z.string() }),
      middleware: [session],
      key: ({ input, context }) => ["product", context.userId, input.id],
      async handler({ input, context }) {
        expectTypeOf(input).toEqualTypeOf<{ id: string }>();
        expectTypeOf(context.userId).toEqualTypeOf<string>();
        return { id: input.id, owner: context.userId };
      },
    });

    expectTypeOf(product).returns.resolves.toEqualTypeOf<{ id: string; owner: string }>();
    await expect(product({ id: "123" })).resolves.toEqual({ id: "123", owner: "user-1" });
    await expect(product({ id: 123 } as any)).rejects.toBeTruthy();
  });

  it("deduplicates matching calls inside one render request without retaining them", async () => {
    let calls = 0;
    const product = createServerQuery({
      input: z.object({ id: z.string() }),
      key: ({ input }) => ["request-product", input.id],
      async handler({ input }) {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { id: input.id, calls };
      },
    });

    const firstRequest = new Request("https://farm.test/products/123");
    const first = await _runWithCurrentRequest(firstRequest, () =>
      Promise.all([product({ id: "123" }), product({ id: "123" })]),
    );
    const second = await _runWithCurrentRequest(new Request(firstRequest), () =>
      product({ id: "123" }),
    );

    expect(first).toEqual([
      { id: "123", calls: 1 },
      { id: "123", calls: 1 },
    ]);
    expect(second).toEqual({ id: "123", calls: 2 });
  });

  it("reuses the route data cache and structured invalidation keys", async () => {
    let calls = 0;
    const key = ["shared-product", "123"] as const;
    const cacheKey = createFarmCacheKey(["route-data", key]);
    const product = createServerQuery({
      input: z.object({ id: z.string() }),
      key: () => key,
      staleTime: "30s",
      async handler({ input }) {
        calls++;
        return { id: input.id, source: `query-${calls}` };
      },
    });

    getFarmDataCache().set(
      cacheKey,
      { id: "123", source: "route" },
      { tags: [createRouteDataCacheTag(key)], revalidate: 30 },
    );

    await expect(product({ id: "123" })).resolves.toEqual({ id: "123", source: "route" });
    expect(calls).toBe(0);

    invalidate(key);
    await expect(product({ id: "123" })).resolves.toEqual({ id: "123", source: "query-1" });
    expect(calls).toBe(1);
  });

  it("applies its output schema to a value route data stored under its key", async () => {
    // Route data has no output schema: a route can cache a full database row under the key a
    // narrower query shares. The query's output contract still decides what reaches the browser.
    const key = ["user", "u1"] as const;
    const cacheKey = createFarmCacheKey(["route-data", key]);
    const handler = vi.fn(async () => ({ id: "u1", name: "Ada" }));
    const user = createServerQuery({
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string(), name: z.string() }),
      key: () => key,
      staleTime: "5m",
      handler,
    });

    getFarmDataCache().set(
      cacheKey,
      { id: "u1", name: "Ada", passwordHash: "secret-hash" },
      { tags: [createRouteDataCacheTag(key)], revalidate: 300 },
    );
    await expect(user({ id: "u1" })).resolves.toEqual({ id: "u1", name: "Ada" });
    expect(handler).not.toHaveBeenCalled();

    // A stored value the schema rejects is refused rather than sent.
    getFarmDataCache().set(cacheKey, { id: "u1" }, { tags: [createRouteDataCacheTag(key)] });
    await expect(user({ id: "u1" })).rejects.toThrow();
  });

  it("honors subsecond stale times without rounding them to one second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let calls = 0;
    const query = createServerQuery({
      key: () => ["subsecond"],
      staleTime: "250ms",
      async handler() {
        return ++calls;
      },
    });

    await expect(query()).resolves.toBe(1);
    vi.setSystemTime(249);
    await expect(query()).resolves.toBe(1);
    vi.setSystemTime(250);
    await expect(query()).resolves.toBe(2);
  });

  it("returns transport metadata only during a server action call", async () => {
    const product = createServerQuery({
      input: z.object({ id: z.string() }),
      key: ({ input }) => ["transport-product", input.id],
      staleTime: "5s",
      async handler({ input }) {
        return { id: input.id };
      },
    });

    await expect(product({ id: "123" })).resolves.toEqual({ id: "123" });

    const request = new Request("https://farm.test/products/123", { method: "POST" });
    const transported = await runWithServerActionRequest(request, () => product({ id: "123" }));

    expect(isFarmServerQueryResult(transported)).toBe(true);
    expect(transported).toMatchObject({
      __farmServerQuery: { staleTime: 5000 },
      data: { id: "123" },
    });
  });

  it("rejects invalid keys and stale times", async () => {
    expect(() =>
      createServerQuery({
        key: () => ["invalid"],
        staleTime: "tomorrow" as any,
        async handler() {
          return true;
        },
      }),
    ).toThrow("staleTime");

    const query = createServerQuery({
      key: () => "",
      async handler() {
        return true;
      },
    });
    await expect(query()).rejects.toThrow("key must return");
  });
});
