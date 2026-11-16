// @vitest-environment node

import { describe, expect, it } from "vitest";
import { memoryRateLimitStorage, middleware } from "../middleware/chain";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";

/**
 * The default rate-limit bucket names the route the router serves and the limit's own policy.
 * It used to name the raw request path, so `/api/login/`, `/api/%6Cogin` or `/%61pi/login`
 * reached the same handler with a fresh bucket, and two limits on one path shared a single
 * counter and window: each request counted twice against the first limit's window.
 */
function createRunner(modules: Array<{ path: string; chain: ReturnType<typeof middleware> }>) {
  return createProductionMiddlewareRunner({
    modules: modules.map(({ path, chain }) => ({ path, module: { default: chain } })),
  });
}

async function status(
  runner: ReturnType<typeof createRunner>,
  pathname: string,
  clientAddress = "203.0.113.10",
): Promise<number> {
  const result = await runner(new Request(`https://app.test${pathname}`, { method: "POST" }), {
    clientAddress,
  });
  return result.response?.status ?? 200;
}

describe("the default rate-limit bucket", () => {
  it("counts every spelling of a route against one bucket", async () => {
    const runner = createRunner([
      {
        path: "/api",
        chain: middleware().rateLimit({
          requests: 2,
          window: "1m",
          storage: memoryRateLimitStorage(),
        }),
      },
    ]);

    expect(await status(runner, "/api/login")).toBe(200);
    expect(await status(runner, "/api/login")).toBe(200);
    for (const spelling of [
      "/api/login",
      "/api/login/",
      "/api/%6Cogin",
      "/api/logi%6E",
      "/%61pi/login",
    ]) {
      expect({ spelling, status: await status(runner, spelling) }).toEqual({
        spelling,
        status: 429,
      });
    }
    // Another caller and another route keep their own buckets.
    expect(await status(runner, "/api/login", "198.51.100.77")).toBe(200);
    expect(await status(runner, "/api/logout")).toBe(200);
  });

  it("keeps each of two limits on one path to its own count and window", async () => {
    const storage = memoryRateLimitStorage();
    const runner = createRunner([
      { path: "/", chain: middleware().rateLimit({ requests: 100, window: "1m", storage }) },
      { path: "/api/login", chain: middleware().rateLimit({ requests: 3, window: "1h", storage }) },
    ]);

    const statuses = [];
    for (let attempt = 0; attempt < 4; attempt += 1)
      statuses.push(await status(runner, "/api/login"));
    expect(statuses).toEqual([200, 200, 200, 429]);

    const limited = await createRunner([
      { path: "/", chain: middleware().rateLimit({ requests: 100, window: "1m", storage }) },
      { path: "/api/login", chain: middleware().rateLimit({ requests: 3, window: "1h", storage }) },
    ])(new Request("https://app.test/api/login", { method: "POST" }), {
      clientAddress: "203.0.113.10",
    });
    // The strict limit's own window, not the generous limit's minute.
    expect(Number(limited.response?.headers.get("retry-after"))).toBeGreaterThan(60);
  });

  it("counts a request once when two limits share a policy", async () => {
    const storage = memoryRateLimitStorage();
    const chain = () => middleware().rateLimit({ requests: 2, window: "1m", storage });
    const runner = createRunner([
      { path: "/", chain: chain() },
      { path: "/api", chain: chain() },
    ]);

    expect(await status(runner, "/api/login")).toBe(200);
    expect(await status(runner, "/api/login")).toBe(200);
    expect(await status(runner, "/api/login")).toBe(429);
  });
});
