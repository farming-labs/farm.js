import { afterEach, describe, expect, it } from "vitest";
import { subscribeFarmCacheInvalidation } from "../cache-invalidation";
import { getFarmClientDataCache } from "../client-cache";
import { farmIslandsLazyActionInterceptor } from "../islands-action-call";
import { farmIslandsActionInterceptor } from "../islands-action-client";
// What a page that runs a server query has loaded: the runtime that keeps the query making a call.
import "../server-query-runtime";
import { FARM_SERVER_QUERY_RESULT_VERSION } from "../server-query-protocol";

const call = { id: "action-id", args: [] };

describe.each([
  ["islands mode's action interceptor", farmIslandsLazyActionInterceptor],
  ["the action interceptor other renderers install", farmIslandsActionInterceptor],
])("%s", (_name, interceptor) => {
  afterEach(() => {
    getFarmClientDataCache().delete("todos");
  });

  it("returns the value of Farm's result, and drops the keys the action invalidated", async () => {
    const dropped: string[] = [];
    const unsubscribe = subscribeFarmCacheInvalidation((key) => dropped.push(key));
    try {
      const value = await interceptor(call, async () => ({
        __farmAction: { invalidations: ["todos"] },
        value: { saved: true },
      }));
      expect(value).toEqual({ saved: true });
      expect(dropped).toContain("todos");
    } finally {
      unsubscribe();
    }
  });

  it("passes a plain result through", async () => {
    expect(await interceptor(call, async () => 5)).toBe(5);
  });

  it("throws a declared failure as the ServerFnFailure it was", async () => {
    const failure = interceptor(call, async () => ({
      __farmAction: {
        invalidations: [],
        error: { name: "ServerFnFailure", code: "TAKEN", status: 409, message: "Taken", data: 1 },
      },
    }));
    await expect(failure).rejects.toMatchObject({
      name: "ServerFnFailure",
      code: "TAKEN",
      status: 409,
      data: 1,
      message: "Taken",
    });
  });

  it("throws what the RSC engine throws for a failure it does not declare", async () => {
    const failure = interceptor(call, async () => {
      throw new Error("Server action failed: 500");
    });
    await expect(failure).rejects.toMatchObject({
      name: "ServerActionError",
      message: "Server function failed",
    });
  });

  it("sends the call when it is made", () => {
    let sent = false;
    void interceptor(call, async () => {
      sent = true;
      return 1;
    });
    expect(sent).toBe(true);
  });

  it("takes the server query making the call when it is made, not when its result arrives", async () => {
    const state = (
      globalThis as Record<symbol, { active: { provisionalKey: string; owner: object }[] }>
    )[Symbol.for("farm.serverQueryClientState")]!;
    const result = (data: string[]) => ({
      __farmAction: { invalidations: [] },
      value: {
        __farmServerQuery: {
          version: FARM_SERVER_QUERY_RESULT_VERSION,
          key: "todos",
          staleTime: 60_000,
          updatedAt: Date.now(),
        },
        data,
      },
    });

    // A query that a newer one has replaced: what its call returns does not fill the cache.
    state.active.push({ provisionalKey: "todos", owner: {} });
    let respond!: (value: unknown) => void;
    let pending: Promise<unknown>;
    try {
      pending = interceptor(call, () => new Promise((resolve) => (respond = resolve)));
    } finally {
      state.active.pop();
    }
    respond(result(["stale"]));
    expect(await pending).toEqual(["stale"]);
    expect(getFarmClientDataCache().get("todos")).toBeUndefined();

    // A call no query made fills it.
    expect(await interceptor(call, async () => result(["fresh"]))).toEqual(["fresh"]);
    expect(getFarmClientDataCache().get("todos")?.data).toEqual(["fresh"]);
  });
});
