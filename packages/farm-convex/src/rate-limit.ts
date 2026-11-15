import { createAdapterCaller } from "./adapter-client.js";

import type { RateLimitIncrementResult, RateLimitStorage } from "@farm.js/core/middleware";
import type { ConvexAdapterOptions } from "./types.js";

function checkWindow(windowMs: number): void {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new TypeError("Rate-limit windowMs must be a positive safe integer.");
  }
}

export function convexRateLimitStorage(options: ConvexAdapterOptions = {}): RateLimitStorage {
  const caller = createAdapterCaller(options);
  return {
    increment(key, windowMs) {
      checkWindow(windowMs);
      return caller.mutation<RateLimitIncrementResult>("incrementRateLimit", { key, windowMs });
    },
    get: (key) =>
      caller.query<RateLimitIncrementResult | null>("readRateLimit", { key, now: Date.now() }),
  };
}
