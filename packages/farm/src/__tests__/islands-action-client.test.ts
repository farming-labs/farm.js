import { describe, expect, it } from "vitest";
import { subscribeFarmCacheInvalidation } from "../cache-invalidation";
import { farmIslandsActionInterceptor } from "../islands-action-client";

const call = { id: "action-id", args: [] };

describe("islands mode's action interceptor", () => {
  it("returns the value of Farm's result, and drops the keys the action invalidated", async () => {
    const dropped: string[] = [];
    const unsubscribe = subscribeFarmCacheInvalidation((key) => dropped.push(key));
    try {
      const value = await farmIslandsActionInterceptor(call, async () => ({
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
    expect(await farmIslandsActionInterceptor(call, async () => 5)).toBe(5);
  });

  it("throws a declared failure as the ServerFnFailure it was", async () => {
    const failure = farmIslandsActionInterceptor(call, async () => ({
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
    const failure = farmIslandsActionInterceptor(call, async () => {
      throw new Error("Server action failed: 500");
    });
    await expect(failure).rejects.toMatchObject({
      name: "ServerActionError",
      message: "Server function failed",
    });
  });
});
