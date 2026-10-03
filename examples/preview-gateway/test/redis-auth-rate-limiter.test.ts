import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  readVercelClientAddress,
  RedisPreviewAuthExchangeRateLimiter,
} from "../lib/redis-auth-rate-limiter.ts";

const originalVercel = process.env.VERCEL;
const originalConsoleError = console.error;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  console.error = originalConsoleError;
});

test("logs Redis client errors for operators", () => {
  const logs: unknown[][] = [];
  console.error = (...args) => logs.push(args);
  const limiter = new RedisPreviewAuthExchangeRateLimiter("redis://127.0.0.1:6379");
  const redis = Reflect.get(limiter, "redis") as {
    disconnect(): void;
    emit(event: "error", error: Error): boolean;
  };
  const error = new Error("Redis unavailable");

  redis.emit("error", error);
  redis.disconnect();

  assert.deepEqual(logs, [["[farm preview] Auth exchange rate limiter Redis error.", error]]);
});

test("rejects client-supplied forwarding headers outside Vercel", () => {
  delete process.env.VERCEL;

  assert.throws(
    () =>
      readVercelClientAddress(
        new Headers({
          "x-forwarded-for": "203.0.113.10",
          "x-real-ip": "203.0.113.11",
          "x-vercel-forwarded-for": "203.0.113.12",
        }),
      ),
    /trusted Vercel runtime/i,
  );
});

test("uses Vercel's anti-spoofed client address", () => {
  process.env.VERCEL = "1";

  assert.equal(
    readVercelClientAddress(new Headers({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" })),
    "203.0.113.10",
  );
});

test("accepts Vercel's IPv6 client address", () => {
  process.env.VERCEL = "1";

  assert.equal(
    readVercelClientAddress(new Headers({ "x-forwarded-for": "2001:db8::10" })),
    "2001:db8::10",
  );
});

test("rejects a Vercel request without a client address", () => {
  process.env.VERCEL = "1";

  assert.throws(
    () =>
      readVercelClientAddress(
        new Headers({
          "x-real-ip": "203.0.113.11",
          "x-vercel-forwarded-for": "203.0.113.12",
        }),
      ),
    /client address/i,
  );
});

test("rejects a malformed Vercel client address", () => {
  process.env.VERCEL = "1";

  assert.throws(
    () => readVercelClientAddress(new Headers({ "x-forwarded-for": "not-an-ip" })),
    /valid client address/i,
  );
});
