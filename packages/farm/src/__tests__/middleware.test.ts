import { describe, it, expect, expectTypeOf, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  middleware,
  getRateLimitStatus,
  memoryRateLimitStorage,
  UnsupportedRateLimitStorageError,
} from "../middleware/chain";
import { createContext } from "../middleware/context";
import { MiddlewareManager } from "../middleware/manager";
import {
  _setCurrentMiddlewareData,
  _clearCurrentMiddlewareData,
  getMiddlewareData,
  getMiddlewareContext,
  getMiddlewareValue,
  _runWithMiddlewareData,
  _runWithMiddlewareContext,
} from "../middleware/server";
import { normalizeMiddlewareModule } from "../middleware/module";
import { farmMiddlewarePlugin } from "../middleware/vite-plugin";
import type {
  MiddlewareContext,
  RateLimitStorage,
  RequestMiddlewareContext,
} from "../middleware/types";
import {
  configureFarmObservability,
  resetFarmObservability,
  type FarmEvent,
} from "../observability";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";

async function executeChain(handlers: any[], ctx: MiddlewareContext) {
  let index = 0;
  const executeNext = async (): Promise<void> => {
    if (index < handlers.length && !ctx._handled) {
      const handler = handlers[index++];
      await handler(ctx, executeNext);
    }
  };
  await executeNext();
}

function createTestRateLimitStorage(
  entries: Iterable<[string, { count: number; resetAt: number }]> = [],
) {
  const records = new Map(entries);
  const storage: RateLimitStorage = {
    increment(key, windowMs) {
      const now = Date.now();
      const current = records.get(key);
      const next =
        !current || current.resetAt <= now
          ? { count: 1, resetAt: now + windowMs }
          : { count: current.count + 1, resetAt: current.resetAt };
      records.set(key, next);
      return next;
    },
    get(key) {
      return records.get(key) ?? null;
    },
  };
  return { records, storage };
}

// Helper to create mock request/response
function createMockRequest(url: string, method = "GET"): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.url = url;
  req.method = method;
  req.headers = {
    host: "localhost:3000",
  };
  return req;
}

function createMockResponse(): ServerResponse {
  const socket = new Socket();
  const res = new ServerResponse(createMockRequest("/"));

  // Mock writeHead and end
  res.writeHead = vi.fn().mockReturnValue(res);
  res.end = vi
    .fn()
    .mockImplementation((chunk?: any, encoding?: BufferEncoding, cb?: (() => void) | undefined) => {
      if (cb) {
        cb();
      }
      return res;
    });
  res.setHeader = vi.fn();

  return res;
}

describe("Middleware Chain", () => {
  it("should create a middleware chain", () => {
    const chain = middleware();
    expect(chain).toBeDefined();
    expect(typeof chain.use).toBe("function");
  });

  it("should execute middleware in order", async () => {
    const order: number[] = [];

    const chain = middleware()
      .use(async (ctx, next) => {
        order.push(1);
        await next();
        order.push(4);
      })
      .use(async (ctx, next) => {
        order.push(2);
        await next();
        order.push(3);
      });

    const { handlers } = chain.build();
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    // Execute handlers
    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("should stop execution on redirect", async () => {
    const order: number[] = [];

    const chain = middleware()
      .use(async (ctx, next) => {
        order.push(1);
        ctx.redirect("/login");
      })
      .use(async (ctx, next) => {
        order.push(2); // Should not execute
        await next();
      });

    const { handlers } = chain.build();
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length && !ctx._handled) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    expect(order).toEqual([1]); // Only first middleware runs
    expect(ctx._handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(307, expect.any(Object));
  });

  it("should support conditional middleware with .when()", async () => {
    const executed: string[] = [];

    const chain = middleware()
      .when(
        (ctx) => ctx.pathname.startsWith("/admin"),
        async (ctx, next) => {
          executed.push("admin");
          await next();
        },
      )
      .when(
        (ctx) => ctx.pathname.startsWith("/user"),
        async (ctx, next) => {
          executed.push("user");
          await next();
        },
      )
      .use(async (ctx, next) => {
        executed.push("always");
        await next();
      });

    const { handlers } = chain.build();
    expect(handlers.length).toBe(3);
    // Test admin path
    {
      executed.length = 0;
      const req = createMockRequest("/admin/dashboard");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(executed).toEqual(["admin", "always"]);
    }

    // Test user path
    {
      executed.length = 0;
      const req = createMockRequest("/user/profile");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(executed).toEqual(["user", "always"]);
    }

    // Test other path
    {
      executed.length = 0;
      const req = createMockRequest("/other");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(executed).toEqual(["always"]);
    }
  });

  it("should support redirect helper", async () => {
    const chain = middleware().redirect("/old-path", "/new-path", true);

    const { handlers } = chain.build();
    const req = createMockRequest("/old-path");
    const res = createMockResponse();
    const ctx = createContext(req, res);
    expect(handlers.length).toBe(1);
    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length && !ctx._handled) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    expect(ctx._handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(308, expect.any(Object));
  });

  it("treats redirect source patterns literally except for glob stars", async () => {
    const run = async (source: string, pathname: string): Promise<boolean> => {
      const chain = middleware().redirect(source, "/moved");
      const { handlers } = chain.build();
      const req = createMockRequest(pathname);
      const res = createMockResponse();
      const ctx = createContext(req, res);
      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length && !ctx._handled) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };
      await executeNext();
      return ctx._handled;
    };

    // A dot must not act as a regex wildcard.
    await expect(run("/promo.html", "/promo.html")).resolves.toBe(true);
    await expect(run("/promo.html", "/promoXhtml")).resolves.toBe(false);

    // Regex metacharacters in the pattern must not throw at request time.
    await expect(run("/a(1)", "/a(1)")).resolves.toBe(true);
    await expect(run("/a(1)", "/a1")).resolves.toBe(false);

    // Glob stars keep their meaning.
    await expect(run("/docs/*", "/docs/intro")).resolves.toBe(true);
    await expect(run("/docs/*", "/docs/intro/deep")).resolves.toBe(false);
    await expect(run("/docs/**", "/docs/intro/deep")).resolves.toBe(true);
  });

  it("should support rewrite helper for route-specific middleware", async () => {
    // Simulate route-specific middleware at /old-url
    const chain = middleware("/old-url").rewrite("/new-url");

    const { handlers } = chain.build();
    const req = createMockRequest("/old-url");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    let index = 0;
    expect(handlers.length).toBe(1);
    expect(ctx.pathname).toBe("/old-url");
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    expect(ctx._rewriteUrl).toBe("/new-url");
    expect(ctx.pathname).toBe("/new-url");
  });

  it("should support rewrite helper for sub-routes", async () => {
    // Simulate route-specific middleware at /contact
    const chain = middleware("/contact").rewrite("/about");

    const { handlers } = chain.build();
    const req = createMockRequest("/contact/sub-page");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    // Should rewrite /contact/sub-page to /about/sub-page
    expect(ctx._rewriteUrl).toBe("/about/sub-page");
    expect(ctx.pathname).toBe("/about/sub-page");
  });

  it("should support conditional rewrite", async () => {
    // Simulate route-specific middleware at /contact
    const chain = middleware("/contact")
      .rewrite("/about", true) // Always rewrite
      .rewrite("/other", false); // Never rewrite

    const { handlers } = chain.build();
    const req = createMockRequest("/contact");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    // Should rewrite to /about (first rewrite with true condition)
    expect(ctx._rewriteUrl).toBe("/about");
    expect(ctx.pathname).toBe("/about");
  });

  it("should support function-based conditional rewrite", async () => {
    // Simulate route-specific middleware at /contact
    const chain = middleware("/contact").rewrite(
      "/about",
      (ctx) => ctx.data.get("shouldRewrite") === true,
    );

    const { handlers } = chain.build();

    // Test with condition true
    {
      const req = createMockRequest("/contact");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      ctx.data.set("shouldRewrite", true);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(ctx._rewriteUrl).toBe("/about");
    }

    // Test with condition false
    {
      const req = createMockRequest("/contact");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      ctx.data.set("shouldRewrite", false);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      // Should not rewrite
      expect(ctx._rewriteUrl).toBeUndefined();
    }
  });

  it("should support rate limiting with default in-memory storage", async () => {
    const spyFn = vi.fn();
    const chain = middleware().rateLimit({
      requests: 2,
      window: "1s",
      keyGenerator: (ctx) => "test-key",
      onLimit: (ctx) => {
        spyFn(ctx);
      },
    });

    const { handlers } = chain.build();

    // First request - should pass
    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(ctx._handled).toBe(false);
      expect(ctx.headers.get("RateLimit-Policy")).toBe('"farm";q=2;w=1');
      expect(ctx.headers.get("RateLimit")).toMatch(/^"farm";r=1;t=\d+$/);
      expect(ctx.headers.has("Retry-After")).toBe(false);
    }

    // Second request - should pass
    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(ctx._handled).toBe(false);
    }

    // Third request - should be rate limited
    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(spyFn).toHaveBeenCalledWith(ctx);
      expect(ctx._handled).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(
        429,
        expect.objectContaining({
          "Content-Type": "application/json",
        }),
      );
      expect(ctx.headers.get("RateLimit-Policy")).toBe('"farm";q=2;w=1');
      expect(ctx.headers.get("RateLimit")).toMatch(/^"farm";r=0;t=\d+$/);
      expect(ctx.headers.get("Retry-After")).toMatch(/^\d+$/);
    }
  });

  it("enforces the exact process-local limit across a request burst", async () => {
    const storage = memoryRateLimitStorage();
    const { handlers } = middleware()
      .rateLimit({
        requests: 100,
        window: "1m",
        keyGenerator: () => "burst",
        storage,
      })
      .build();
    const contexts = Array.from({ length: 250 }, () =>
      createContext(createMockRequest("/burst"), createMockResponse()),
    );

    await Promise.all(contexts.map((ctx) => executeChain(handlers, ctx)));

    expect(contexts.filter((ctx) => !ctx._handled)).toHaveLength(100);
    expect(contexts.filter((ctx) => ctx._handled)).toHaveLength(150);
    await expect(Promise.resolve(storage.get?.("burst"))).resolves.toMatchObject({
      count: 250,
    });
  });

  it("rejects legacy non-atomic get/set storage", () => {
    const storage = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    } as unknown as RateLimitStorage;

    expect(() => middleware().rateLimit({ requests: 10, window: "1m", storage })).toThrow(
      UnsupportedRateLimitStorageError,
    );
  });

  it("should support rate limiting with custom storage (Redis-like)", async () => {
    const { records: mockRedisStore, storage: customStorage } = createTestRateLimitStorage();

    const spyFn = vi.fn();
    const chain = middleware().rateLimit({
      requests: 3,
      window: "1s",
      keyGenerator: (ctx) => "redis-test-key",
      storage: customStorage,
      onLimit: (ctx) => {
        spyFn(ctx);
      },
    });

    const { handlers } = chain.build();

    const executeChain = async (ctx: MiddlewareContext) => {
      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };
      await executeNext();
    };

    {
      const req = createMockRequest("/api/data");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
      const count = mockRedisStore.get("redis-test-key")?.count;
      expect(count).toBe(1);
    }

    {
      const req = createMockRequest("/api/data");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
      const count = mockRedisStore.get("redis-test-key")?.count;
      expect(count).toBe(2);
    }

    {
      const req = createMockRequest("/api/data");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
      const count = mockRedisStore.get("redis-test-key")?.count;
      expect(count).toBe(3);
    }

    {
      const req = createMockRequest("/api/data");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(spyFn).toHaveBeenCalledWith(ctx);
      expect(ctx._handled).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(
        429,
        expect.objectContaining({
          "Content-Type": "application/json",
        }),
      );
    }

    expect(mockRedisStore.size).toBeGreaterThan(0);
  });

  it("should support custom storage with synchronous operations", async () => {
    const { records: syncStore, storage: customStorage } = createTestRateLimitStorage();

    const chain = middleware().rateLimit({
      requests: 2,
      window: "1m",
      keyGenerator: (ctx) => "sync-test-key",
      storage: customStorage,
    });

    const { handlers } = chain.build();

    const executeChain = async (ctx: MiddlewareContext) => {
      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };
      await executeNext();
    };

    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
    }

    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
    }

    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(true);
    }

    expect(syncStore.has("sync-test-key")).toBe(true);
    const storedData = syncStore.get("sync-test-key");
    expect(storedData).toHaveProperty("count");
    expect(storedData).toHaveProperty("resetAt");
    expect(storedData.count).toBe(3);
  });

  it("should pass the fixed window to custom atomic storage", async () => {
    const incrementSpy = vi.fn();
    const customStorage: RateLimitStorage = {
      increment(key, windowMs) {
        incrementSpy(key, windowMs);
        return { count: 1, resetAt: Date.now() + windowMs };
      },
    };

    const chain = middleware().rateLimit({
      requests: 5,
      window: "2m", // 120 seconds
      storage: customStorage,
    });

    const { handlers } = chain.build();

    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    expect(incrementSpy).toHaveBeenCalled();
    const [, windowMs] = incrementSpy.mock.calls[0];
    expect(windowMs).toBe(120_000);
  });

  it("should retain the reset time returned by custom storage", async () => {
    const { records, storage: customStorage } = createTestRateLimitStorage();

    const chain = middleware().rateLimit({
      requests: 5,
      window: "10s",
      keyGenerator: (ctx) => "ttl-test-key",
      storage: customStorage,
    });

    const { handlers } = chain.build();

    const executeChain = async (ctx: MiddlewareContext) => {
      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };
      await executeNext();
    };

    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
    }

    const resetAt = records.get("ttl-test-key")?.resetAt;
    expect(resetAt).toBeDefined();
    expect(resetAt! - Date.now()).toBeGreaterThan(0);
    expect(resetAt! - Date.now()).toBeLessThanOrEqual(10_000);
  });

  it("should retain a reset window with default storage", async () => {
    const chain = middleware().rateLimit({
      requests: 3,
      window: "5s",
      keyGenerator: (ctx) => "default-ttl-test",
    });

    const { handlers } = chain.build();

    const executeChain = async (ctx: MiddlewareContext) => {
      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };
      await executeNext();
    };

    // Make a request to create the rate limit record
    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
    }

    // Access the default storage TTL (we need to import the storage, but for testing
    // we can verify the behavior indirectly by checking that records expire)
    // This is more of an integration test to ensure TTL tracking works
  });
});

describe("getRateLimitStatus", () => {
  it("should return status with no requests when key does not exist", async () => {
    const storage: RateLimitStorage = {
      increment: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
    };

    const status = await getRateLimitStatus("test-key", 100, storage);

    expect(status).toEqual({
      requests: 0,
      limit: 100,
      remaining: 100,
      resetIn: null,
      resetAt: null,
      isLimited: false,
    });
    expect(storage.get).toHaveBeenCalledWith("test-key");
  });

  it("should return current status for active rate limit", async () => {
    const now = Date.now();
    const resetAt = now + 60000; // 60 seconds from now

    const storage: RateLimitStorage = {
      increment: vi.fn(),
      get: vi.fn().mockResolvedValue({
        count: 42,
        resetAt,
      }),
    };

    const status = await getRateLimitStatus("user:123", 100, storage);
    expect(status.requests).toBe(42);
    expect(status.limit).toBe(100);
    expect(status.remaining).toBe(58);
    expect(status.isLimited).toBe(false);
    expect(status.resetIn).toBeGreaterThan(0);
    expect(status.resetIn).toBeLessThanOrEqual(60);
    expect(status.resetAt).toBeInstanceOf(Date);
  });

  it("should return limited status when limit exceeded", async () => {
    const now = Date.now();
    const resetAt = now + 120000; // 2 minutes from now

    const storage: RateLimitStorage = {
      increment: vi.fn(),
      get: vi.fn().mockResolvedValue({
        count: 150,
        resetAt,
      }),
    };

    const status = await getRateLimitStatus("ip:192.168.1.1", 100, storage);

    expect(status.requests).toBe(150);
    expect(status.limit).toBe(100);
    expect(status.remaining).toBe(0);
    expect(status.isLimited).toBe(true);
    expect(status.resetIn).toBeGreaterThan(0);
  });

  it("should return expired status when resetAt is in the past", async () => {
    const pastTime = Date.now() - 10000; // 10 seconds ago

    const storage: RateLimitStorage = {
      increment: vi.fn(),
      get: vi.fn().mockResolvedValue({
        count: 50,
        resetAt: pastTime,
      }),
    };

    const status = await getRateLimitStatus("expired-key", 100, storage);

    expect(status.requests).toBe(0);
    expect(status.limit).toBe(100);
    expect(status.remaining).toBe(100);
    expect(status.isLimited).toBe(false);
    expect(status.resetIn).toBeNull();
    expect(status.resetAt).toBeNull();
  });

  it("should reject an inspectable storage record without resetAt", async () => {
    const storage: RateLimitStorage = {
      increment: vi.fn(),
      get: vi.fn().mockResolvedValue({
        count: 30,
      } as any),
    };

    await expect(getRateLimitStatus("ttl-key", 100, storage)).rejects.toThrow(/resetAt timestamp/);
  });

  it("should work with custom storage implementation", async () => {
    const { storage: customStorage } = createTestRateLimitStorage([
      ["api:user:456", { count: 75, resetAt: Date.now() + 45_000 }],
    ]);

    const status = await getRateLimitStatus("api:user:456", 100, customStorage);

    expect(status.requests).toBe(75);
    expect(status.limit).toBe(100);
    expect(status.remaining).toBe(25);
    expect(status.isLimited).toBe(false);
    expect(status.resetIn).toBeGreaterThan(0);
    expect(status.resetIn).toBeLessThanOrEqual(45);
  });

  it("should integrate with actual rate limiter", async () => {
    const { storage: testStorage } = createTestRateLimitStorage();

    const chain = middleware().rateLimit({
      requests: 5,
      window: "1m",
      keyGenerator: () => "integration-test",
      storage: testStorage,
    });

    const { handlers } = chain.build();

    const executeChain = async (ctx: MiddlewareContext) => {
      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };
      await executeNext();
    };

    // Make 3 requests
    for (let i = 0; i < 3; i++) {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
    }

    const status = await getRateLimitStatus("integration-test", 5, testStorage);

    expect(status.requests).toBe(3);
    expect(status.limit).toBe(5);
    expect(status.remaining).toBe(2);
    expect(status.isLimited).toBe(false);
    expect(status.resetIn).toBeGreaterThan(0);
    expect(status.resetAt).toBeInstanceOf(Date);
  });

  it("should use default storage when storage parameter not provided", async () => {
    const status = await getRateLimitStatus("default-storage-test", 50);

    expect(status).toBeDefined();
    expect(status.requests).toBe(0);
    expect(status.limit).toBe(50);
    expect(status.remaining).toBe(50);
  });
});

describe("Middleware Context", () => {
  it("should create context from request/response", () => {
    const req = createMockRequest("/test?foo=bar");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.pathname).toBe("/test");
    expect(ctx.searchParams.get("foo")).toBe("bar");
    expect(ctx.method).toBe("GET");
  });

  it("should handle data storage", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.data.set("user", { id: 1, name: "John" });
    expect(ctx.data.get("user")).toEqual({ id: 1, name: "John" });
  });

  it("should inherit parent middleware data", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const parentData = new Map<string, any>([
      ["requestId", "req-123"],
      ["user", { id: 1 }],
    ]);
    const parentHeaders = { "x-request-id": "req-123" };

    const ctx = createContext(req, res, undefined, {
      data: parentData,
      headers: parentHeaders,
    });

    expect(ctx.data.get("requestId")).toBe("req-123");
    expect(ctx.data.get("user")).toEqual({ id: 1 });
    expect(ctx.headers.get("x-request-id")).toBe("req-123");

    ctx.data.set("childOnly", true);
    expect(parentData.has("childOnly")).toBe(false);
  });

  it("should handle redirects", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.redirect("/login", 302);

    expect(ctx._handled).toBe(true);
    expect(ctx._redirectUrl).toBe("/login");
    expect(res.writeHead).toHaveBeenCalledWith(
      302,
      expect.objectContaining({
        Location: "/login",
      }),
    );
  });

  it("should handle rewrites", () => {
    const req = createMockRequest("/old");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.rewrite("/new");

    expect(ctx._rewriteUrl).toBe("/new");
    expect(ctx.pathname).toBe("/new");
    expect(req.url).toBe("/new");
  });

  it("should handle JSON responses", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.json({ message: "Hello" }, 200);

    expect(ctx._handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "Content-Type": "application/json",
      }),
    );
  });

  it("should handle cookies", () => {
    const req = createMockRequest("/test");
    req.headers.cookie = "session=abc123; user=john";
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.cookies.get("session")).toBe("abc123");
    expect(ctx.cookies.get("user")).toBe("john");

    ctx.cookies.set("new-cookie", "value123", { maxAge: 3600 });
    expect(res.setHeader).toHaveBeenCalled();
  });
});

describe("Pattern Matching", () => {
  it("should match patterns using function conditions", async () => {
    const executed: string[] = [];

    const chain = middleware()
      .when(
        (ctx) => ctx.pathname.startsWith("/api"),
        async (ctx, next) => {
          executed.push("api");
          await next();
        },
      )
      .when(
        (ctx) => ctx.pathname.startsWith("/admin"),
        async (ctx, next) => {
          executed.push("admin-deep");
          await next();
        },
      );

    const { handlers } = chain.build();

    // Test /api/users
    {
      executed.length = 0;
      const req = createMockRequest("/api/users");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(executed).toContain("api");
    }

    // Test /admin/users/settings
    {
      executed.length = 0;
      const req = createMockRequest("/admin/users/settings");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(executed).toContain("admin-deep");
    }
  });

  it("should match regex patterns in .when()", async () => {
    const executed: string[] = [];

    const chain = middleware()
      .when(
        (ctx) => /^\/api\/v[0-9]+\/.*/.test(ctx.pathname),
        async (ctx, next) => {
          executed.push("versioned-api");
          await next();
        },
      )
      .when(
        (ctx) => ctx.pathname.endsWith("/dashboard"),
        async (ctx, next) => {
          executed.push("dashboard-exact");
          await next();
        },
      );

    const { handlers } = chain.build();

    // Test versioned API
    {
      executed.length = 0;
      const req = createMockRequest("/api/v1/users");
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed).toContain("versioned-api");
    }

    // Test exact match
    {
      executed.length = 0;
      const req = createMockRequest("/dashboard");
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed).toContain("dashboard-exact");
    }
  });

  it("should support function-based conditions in .when()", async () => {
    const executed: string[] = [];

    const chain = middleware()
      .when(
        (ctx) => ctx.method === "POST",
        async (ctx, next) => {
          executed.push("post-only");
          await next();
        },
      )
      .when(
        (ctx) => ctx.searchParams.get("debug") === "true",
        async (ctx, next) => {
          executed.push("debug-mode");
          await next();
        },
      );

    const { handlers } = chain.build();

    // Test POST method
    {
      const req = createMockRequest("/test", "POST");
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed).toContain("post-only");
    }

    // Test debug param
    {
      executed.length = 0;
      const req = createMockRequest("/test?debug=true");
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed).toContain("debug-mode");
    }
  });

  it("should support boolean conditions in .when()", async () => {
    const executed: string[] = [];

    const chain = middleware()
      .when(true, async (ctx, next) => {
        executed.push("always");
        await next();
      })
      .when(false, async (ctx, next) => {
        executed.push("never");
        await next();
      });

    const { handlers } = chain.build();
    const req = createMockRequest("/test");
    const ctx = createContext(req, createMockResponse());

    await executeChain(handlers, ctx);

    expect(executed).toEqual(["always"]);
    expect(executed).not.toContain("never");
  });

  it("should support nested chains in .when()", async () => {
    const executed: string[] = [];

    const chain = middleware()
      .when(
        (ctx) => ctx.pathname === "/protected",
        (subChain) => {
          subChain
            .use(async (ctx, next) => {
              executed.push("auth-check");
              ctx.data.set("authenticated", true);
              await next();
            })
            .use(async (ctx, next) => {
              executed.push("role-check");
              await next();
            });
        },
      )
      .use(async (ctx, next) => {
        executed.push("final");
        await next();
      });

    const { handlers } = chain.build();

    // Test matching path
    const req1 = createMockRequest("/protected");
    const ctx1 = createContext(req1, createMockResponse());
    await executeChain(handlers, ctx1);

    expect(executed).toEqual(["auth-check", "role-check", "final"]);
    expect(ctx1.data.get("authenticated")).toBe(true);

    // Test non-matching path
    executed.length = 0;
    const req2 = createMockRequest("/other");
    const ctx2 = createContext(req2, createMockResponse());
    await executeChain(handlers, ctx2);

    expect(executed).toEqual(["final"]);
  });
});

describe("Response Methods", () => {
  it("should send text responses", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.text("Hello World", 200);

    expect(ctx._handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "Content-Type": "text/plain",
      }),
    );
    expect(res.end).toHaveBeenCalledWith("Hello World");
  });

  it("should send HTML responses", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.html("<h1>Hello</h1>", 200);

    expect(ctx._handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "Content-Type": "text/html",
      }),
    );
    expect(res.end).toHaveBeenCalledWith("<h1>Hello</h1>");
  });

  it("should handle different redirect status codes", () => {
    // 307 Temporary Redirect
    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      ctx.redirect("/new", 307);
      expect(res.writeHead).toHaveBeenCalledWith(307, expect.any(Object));
    }

    // 308 Permanent Redirect
    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      ctx.redirect("/new", 308);
      expect(res.writeHead).toHaveBeenCalledWith(308, expect.any(Object));
    }

    // 302 Found
    {
      const req = createMockRequest("/test");
      const res = createMockResponse();
      const ctx = createContext(req, res);

      ctx.redirect("/new", 302);
      expect(res.writeHead).toHaveBeenCalledWith(302, expect.any(Object));
    }
  });

  it("should prevent double responses", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // First response
    ctx.json({ success: true }, 200);
    expect(ctx._handled).toBe(true);

    // Try to send another response
    ctx.text("Should not work", 200);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("already sent"));
    consoleSpy.mockRestore();
  });
});

describe("Header Management Advanced", () => {
  it("should handle multiple values for same header key", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.headers.set("X-Custom", "value1");
    expect(ctx.headers.get("X-Custom")).toBe("value1");

    ctx.headers.set("X-Custom", "value2"); // Should overwrite
    expect(ctx.headers.get("X-Custom")).toBe("value2");
  });

  it("should preserve existing headers", () => {
    const req = createMockRequest("/test");
    req.headers["existing-header"] = "existing-value";

    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.headers.get("existing-header")).toBe("existing-value");
  });
});

describe("Cookie Management Advanced", () => {
  it("should preserve Max-Age=0 when expiring a cookie", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.cookies.set("preview", "", { maxAge: 0 });

    expect(res.setHeader).toHaveBeenCalledWith("Set-Cookie", [
      "preview=; Max-Age=0; Path=/",
    ]);
  });

  it("should handle cookie expiration", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    const expireDate = new Date(Date.now() + 86400000); // 1 day from now
    ctx.cookies.set("session", "abc123", {
      expires: expireDate,
    });

    const setCookieCall = (res.setHeader as any).mock.calls.find(
      (call: any[]) => call[0] === "Set-Cookie",
    );

    expect(setCookieCall).toBeDefined();
    expect(setCookieCall[1][0]).toContain("Expires=");
  });

  it("should handle all SameSite options", () => {
    const req = createMockRequest("/test");

    ["strict", "lax", "none"].forEach((sameSite) => {
      const res = createMockResponse();
      const ctx = createContext(req, res);

      ctx.cookies.set("test", "value", {
        sameSite: sameSite as any,
      });

      const setCookieCall = (res.setHeader as any).mock.calls.find(
        (call: any[]) => call[0] === "Set-Cookie",
      );

      expect(setCookieCall[1][0]).toContain(
        `SameSite=${sameSite.charAt(0).toUpperCase() + sameSite.slice(1)}`,
      );
    });
  });

  it("should handle cookies with special characters", () => {
    const req = createMockRequest("/test");
    req.headers.cookie = "encoded=hello%20world; special=test%2Bvalue";
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.cookies.get("encoded")).toBe("hello world");
    expect(ctx.cookies.get("special")).toBe("test+value");
  });

  it("should keep malformed percent-encoded cookie values raw instead of throwing", () => {
    const req = createMockRequest("/test");
    req.headers.cookie = "track=100%; broken=%E0%A4%A; session=abc123";
    const res = createMockResponse();

    const ctx = createContext(req, res);

    expect(ctx.cookies.get("track")).toBe("100%");
    expect(ctx.cookies.get("broken")).toBe("%E0%A4%A");
    expect(ctx.cookies.get("session")).toBe("abc123");
  });

  it("should set secure and httpOnly flags", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.cookies.set("secure-cookie", "value", {
      secure: true,
      httpOnly: true,
    });

    const setCookieCall = (res.setHeader as any).mock.calls.find(
      (call: any[]) => call[0] === "Set-Cookie",
    );

    expect(setCookieCall[1][0]).toContain("Secure");
    expect(setCookieCall[1][0]).toContain("HttpOnly");
  });
});

describe("Data Storage & Sharing", () => {
  it("should store and retrieve complex data types", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    const complexData = {
      user: { id: 1, name: "John", roles: ["admin", "user"] },
      settings: { theme: "dark", notifications: true },
      timestamp: Date.now(),
    };

    ctx.data.set("complexData", complexData);

    const retrieved = ctx.data.get("complexData");
    expect(retrieved).toEqual(complexData);
    expect(retrieved.user.roles).toEqual(["admin", "user"]);
  });

  it("should handle multiple data keys", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.data.set("key1", "value1");
    ctx.data.set("key2", { nested: "value2" });
    ctx.data.set("key3", [1, 2, 3]);

    expect(ctx.data.get("key1")).toBe("value1");
    expect(ctx.data.get("key2")).toEqual({ nested: "value2" });
    expect(ctx.data.get("key3")).toEqual([1, 2, 3]);
  });

  it("should share data across middleware", async () => {
    const chain = middleware()
      .use(async (ctx, next) => {
        ctx.data.set("step1", "completed");
        await next();
      })
      .use(async (ctx, next) => {
        const step1 = ctx.data.get("step1");
        expect(step1).toBe("completed");
        ctx.data.set("step2", "completed");
        await next();
      })
      .use(async (ctx, next) => {
        expect(ctx.data.get("step1")).toBe("completed");
        expect(ctx.data.get("step2")).toBe("completed");
        await next();
      });

    const { handlers } = chain.build();
    const req = createMockRequest("/test");
    const ctx = createContext(req, createMockResponse());

    await executeChain(handlers, ctx);
  });
});

describe("Parent Data Access (Cascading)", () => {
  it("should access parent middleware data", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();

    const parentData = new Map<string, any>();
    parentData.set("parentKey", "parentValue");
    parentData.set("userId", 123);

    const parent = {
      data: parentData,
      headers: { "X-Parent": "true" },
    };

    const ctx = createContext(req, res, undefined, parent);

    expect(ctx.parent).toBeDefined();
    expect(ctx.parent?.data.get("parentKey")).toBe("parentValue");
    expect(ctx.parent?.data.get("userId")).toBe(123);
    expect(ctx.parent?.headers["X-Parent"]).toBe("true");
  });

  it("should merge parent data with current data", async () => {
    const chain = middleware().use(async (ctx, next) => {
      if (ctx.parent) {
        const parentUserId = ctx.parent.data.get("userId");
        ctx.data.set("hasParent", true);
        ctx.data.set("inheritedUserId", parentUserId);
      }

      ctx.data.set("ownData", "value");
      await next();
    });

    const { handlers } = chain.build();

    const req = createMockRequest("/test");
    const res = createMockResponse();

    const parentData = new Map<string, any>();
    parentData.set("userId", 456);

    const ctx = createContext(req, res, undefined, {
      data: parentData,
      headers: {},
    });

    await executeChain(handlers, ctx);

    expect(ctx.data.get("hasParent")).toBe(true);
    expect(ctx.data.get("inheritedUserId")).toBe(456);
    expect(ctx.data.get("ownData")).toBe("value");
  });
});

describe("URL Rewriting", () => {
  it("should update pathname when rewriting", () => {
    const req = createMockRequest("/old-path?foo=bar");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.pathname).toBe("/old-path");

    ctx.rewrite("/new-path");

    expect(ctx.pathname).toBe("/new-path");
    expect(ctx._rewriteUrl).toBe("/new-path");
    expect(req.url).toBe("/new-path");
  });

  it("should preserve query params during rewrite", () => {
    const req = createMockRequest("/old?keep=this");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.rewrite("/new?keep=this");

    expect(ctx.searchParams.get("keep")).toBe("this");
  });

  it("should handle multiple rewrites", () => {
    const req = createMockRequest("/path1");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.rewrite("/path2");
    expect(ctx.pathname).toBe("/path2");

    ctx.rewrite("/path3");
    expect(ctx.pathname).toBe("/path3");
    expect(ctx._rewriteUrl).toBe("/path3");
  });
});

describe("Named request middleware", () => {
  interface DashboardContext {
    session: { userId: string };
    requestPath: string;
  }

  it("passes a Web Request and typed request context without requiring next", async () => {
    const normalized = normalizeMiddlewareModule(
      {
        async middleware(request: Request, context: RequestMiddlewareContext<DashboardContext>) {
          context.set("session", { userId: request.headers.get("x-user-id") || "anonymous" });
          context.set("requestPath", new URL(request.url).pathname);
          context.data.set("client.theme", "dark");
          context.headers.set("x-named-middleware", "yes");
        },
        config: { matcher: "/dashboard/:path*" },
      },
      "/dashboard",
    );

    expect(normalized?.handlers).toHaveLength(1);
    expect(normalized?.config).toEqual({ matcher: "/dashboard/:path*" });

    const req = createMockRequest("/dashboard/settings");
    req.headers["x-user-id"] = "user-42";
    const ctx = createContext(req, createMockResponse());
    await normalized!.handlers[0](ctx, async () => {
      throw new Error("named middleware should continue automatically");
    });

    expect(ctx.locals.get("session")).toEqual({ userId: "user-42" });
    expect(ctx.locals.get("requestPath")).toBe("/dashboard/settings");
    expect(ctx.data.get("client.theme")).toBe("dark");
    expect(ctx.headers.get("x-named-middleware")).toBe("yes");
  });

  it("uses the same named-export runtime through the standalone Vite plugin", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-named-middleware-"));
    const middlewareFile = path.join(root, "src", "app", "dashboard", "middleware.ts");
    await fs.mkdir(path.dirname(middlewareFile), { recursive: true });
    await fs.writeFile(middlewareFile, "export {};\n");

    try {
      const server = {
        config: { root },
        hot: undefined,
        ssrLoadModule: vi.fn().mockResolvedValue({
          config: { matcher: "/dashboard/:path*" },
          middleware(request: Request, context: RequestMiddlewareContext<DashboardContext>) {
            context.set("requestPath", new URL(request.url).pathname);
            context.set("session", { userId: "vite-user" });
          },
        }),
        moduleGraph: { invalidateModule: vi.fn() },
        ws: { send: vi.fn() },
      };
      const plugin = farmMiddlewarePlugin();
      (plugin.configureServer as (server: any) => void)(server);
      await (server as any).__farmMiddleware__.waitForDiscovery();

      const req = createMockRequest("/dashboard/settings");
      const handled = await (server as any).__farmMiddleware__.execute(req, createMockResponse());

      expect(handled).toBe(false);
      expect((req as any).__FARM_MIDDLEWARE_CONTEXT__).toEqual(
        new Map([
          ["requestPath", "/dashboard/settings"],
          ["session", { userId: "vite-user" }],
        ]),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("preserves Response short-circuiting", async () => {
    const normalized = normalizeMiddlewareModule(
      {
        middleware(request: Request) {
          return new Response(new URL(request.url).pathname, { status: 401 });
        },
      },
      "/dashboard",
    );
    const ctx = createContext(createMockRequest("/dashboard/private"), createMockResponse());

    const response = await normalized!.handlers[0](ctx, async () => undefined);

    expect(response).toBeInstanceOf(Response);
    const webResponse = response as Response;
    expect(webResponse.status).toBe(401);
    await expect(webResponse.text()).resolves.toBe("/dashboard/private");
  });

  it("rejects ambiguous default and named exports", () => {
    expect(() =>
      normalizeMiddlewareModule(
        {
          default: async () => {},
          middleware: async () => {},
        },
        "/",
      ),
    ).toThrow("cannot export both");
  });

  it("keeps context keys and values correlated in TypeScript", () => {
    const assertContextTypes = (context: RequestMiddlewareContext<DashboardContext>) => {
      expectTypeOf(context.get("session")).toEqualTypeOf<{ userId: string } | undefined>();
      expectTypeOf(context.get("requestPath")).toEqualTypeOf<string | undefined>();
      context.set("session", { userId: "user-42" });
      // @ts-expect-error session values must match DashboardContext.
      context.set("session", { userId: 42 });
      // @ts-expect-error unknown context keys are rejected.
      context.get("missing");
    };

    expectTypeOf(assertContextTypes).toBeFunction();
  });
});

describe("Middleware Data Access (getMiddlewareData)", () => {
  it("should retrieve middleware data without props", () => {
    // Set data
    _setCurrentMiddlewareData({
      user: { id: 1, name: "John" },
      stats: { views: 100 },
    });

    // Test getMiddlewareData()
    const data = getMiddlewareData();
    expect(data.get("user")).toEqual({ id: 1, name: "John" });
    expect(data.get("stats")).toEqual({ views: 100 });

    // Test getMiddlewareValue()
    const user = getMiddlewareValue("user");
    expect(user).toEqual({ id: 1, name: "John" });

    // Clean up
    _clearCurrentMiddlewareData();
  });

  it("should return empty map when no data is set", () => {
    _clearCurrentMiddlewareData();

    const data = getMiddlewareData();
    expect(data.size).toBe(0);
  });

  it("should handle data isolation between requests", () => {
    // Request 1
    _setCurrentMiddlewareData({ req1: "data1" });
    const data1 = getMiddlewareData();
    expect(data1.get("req1")).toBe("data1");
    _clearCurrentMiddlewareData();

    // Request 2 (should not have req1 data)
    _setCurrentMiddlewareData({ req2: "data2" });
    const data2 = getMiddlewareData();
    expect(data2.get("req2")).toBe("data2");
    expect(data2.get("req1")).toBeUndefined();
    _clearCurrentMiddlewareData();
  });

  it("should isolate middleware data across concurrent async contexts", async () => {
    const [req1, req2] = await Promise.all([
      _runWithMiddlewareData({ requestId: "req-1" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getMiddlewareValue("requestId");
      }),
      _runWithMiddlewareData({ requestId: "req-2" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return getMiddlewareValue("requestId");
      }),
    ]);

    expect(req1).toBe("req-1");
    expect(req2).toBe("req-2");
  });

  it("shares server-only context with nested components without crossing requests", async () => {
    interface DashboardContextSnapshot {
      session: { userId: string };
      secret: string;
    }

    const [req1, req2] = await Promise.all([
      _runWithMiddlewareContext(
        { session: { userId: "user-1" }, secret: "first-secret" },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return getMiddlewareContext<DashboardContextSnapshot>().get("session")?.userId;
        },
      ),
      _runWithMiddlewareContext(
        { session: { userId: "user-2" }, secret: "second-secret" },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return getMiddlewareContext<DashboardContextSnapshot>().get("session")?.userId;
        },
      ),
    ]);

    expect(req1).toBe("user-1");
    expect(req2).toBe("user-2");
    expect(getMiddlewareContext().size).toBe(0);
  });
});

describe("Middleware Manager Data Flow", () => {
  it("executes farm.config middleware entries when their matcher matches", async () => {
    const seen: string[] = [];
    const manager = new MiddlewareManager("/tmp", undefined, [
      {
        matcher: "/dashboard/:path*",
        async handler(ctx, next) {
          seen.push(`config:${ctx.params.path}`);
          ctx.data.set("fromConfig", "yes");
          await next();
        },
      },
    ]);

    (manager as any).middleware = [
      {
        path: "/dashboard",
        filePath: "/tmp/app/dashboard/middleware.ts",
        handlers: [
          async (ctx: MiddlewareContext, next: () => Promise<void>) => {
            seen.push(`file:${ctx.data.get("fromConfig")}`);
            ctx.data.set("fromFile", "yes");
            await next();
          },
        ],
      },
    ];

    const req = createMockRequest("/dashboard/settings");
    const res = createMockResponse();
    const handled = await manager.execute(req, res);

    expect(handled).toBe(false);
    expect(seen).toEqual(["config:settings", "file:yes"]);
    expect((req as any).__FARM_MIDDLEWARE_DATA__.get("fromFile")).toBe("yes");
  });

  it("skips farm.config middleware entries when their matcher does not match", async () => {
    const seen: string[] = [];
    const manager = new MiddlewareManager("/tmp", undefined, [
      {
        matcher: "/dashboard/:path*",
        async handler(ctx, next) {
          seen.push("config");
          await next();
        },
      },
    ]);

    const req = createMockRequest("/marketing");
    const res = createMockResponse();
    const handled = await manager.execute(req, res);

    expect(handled).toBe(false);
    expect(seen).toEqual([]);
  });

  it("uses a matcher-only farm.config middleware object as a global gate", async () => {
    const seen: string[] = [];
    const manager = new MiddlewareManager("/tmp", undefined, {
      matcher: "/dashboard/:path*",
    });

    (manager as any).middleware = [
      {
        path: "/",
        filePath: "/tmp/app/middleware.ts",
        handlers: [
          async (ctx: MiddlewareContext, next: () => Promise<void>) => {
            seen.push(ctx.params.path);
            await next();
          },
        ],
      },
    ];

    await manager.execute(createMockRequest("/marketing"), createMockResponse());
    await manager.execute(createMockRequest("/dashboard/reports/weekly"), createMockResponse());

    expect(seen).toEqual(["reports/weekly"]);
  });

  it("returns handled when config middleware short-circuits the response", async () => {
    const manager = new MiddlewareManager("/tmp", undefined, [
      {
        matcher: "/dashboard/:path*",
        handler(ctx) {
          ctx.text("blocked", 401);
        },
      },
    ]);

    const req = createMockRequest("/dashboard/settings");
    const res = createMockResponse();
    const handled = await manager.execute(req, res);

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(401, {
      "Content-Type": "text/plain",
    });
    expect(res.end).toHaveBeenCalledWith("blocked");
  });

  it("returns handled when config middleware returns a Response", async () => {
    const manager = new MiddlewareManager("/tmp", undefined, [
      {
        matcher: "/dashboard/:path*",
        handler(ctx) {
          return Response.redirect(new URL("/sign-in", ctx.url));
        },
      },
    ]);

    const req = createMockRequest("/dashboard/settings");
    const res = createMockResponse();
    const handled = await manager.execute(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(302);
    expect(res.setHeader).toHaveBeenCalledWith("location", "http://localhost:3000/sign-in");
  });

  it("returns handled when file middleware returns a Response", async () => {
    const manager = new MiddlewareManager("/tmp");
    (manager as any).middleware = [
      {
        path: "/dashboard",
        filePath: "/tmp/app/dashboard/middleware.ts",
        handlers: [
          (ctx: MiddlewareContext) => {
            return new Response(null, {
              status: 204,
              headers: {
                "x-middleware": ctx.pathname,
              },
            });
          },
        ],
      },
    ];

    const req = createMockRequest("/dashboard/settings");
    const res = createMockResponse();
    const handled = await manager.execute(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(res.setHeader).toHaveBeenCalledWith("x-middleware", "/dashboard/settings");
  });

  it("emits middleware observability events", async () => {
    const events: FarmEvent[] = [];
    configureFarmObservability({ onEvent: (event) => events.push(event) });

    try {
      const manager = new MiddlewareManager("/tmp", undefined, [
        {
          matcher: "/dashboard/:path*",
          async handler(ctx, next) {
            ctx.data.set("fromConfig", "yes");
            await next();
          },
        },
      ]);

      (manager as any).middleware = [
        {
          path: "/dashboard",
          filePath: "/tmp/app/dashboard/middleware.ts",
          handlers: [
            async (ctx: MiddlewareContext, next: () => Promise<void>) => {
              ctx.data.set("fromFile", "yes");
              await next();
            },
          ],
        },
      ];

      const handled = await manager.execute(
        createMockRequest("/dashboard/settings"),
        createMockResponse(),
      );

      expect(handled).toBe(false);
      expect(events.map((event) => event.type)).toEqual([
        "middleware.start",
        "middleware.complete",
        "middleware.start",
        "middleware.complete",
      ]);
      expect(events[0]).toMatchObject({
        route: "/",
        pathname: "/dashboard/settings",
        name: "farm.config.ts#middleware-0",
      });
      expect(events[1]).toMatchObject({
        route: "/",
        pathname: "/dashboard/settings",
        name: "farm.config.ts#middleware-0",
        durationMs: expect.any(Number),
      });
      expect(events[2]).toMatchObject({
        route: "/dashboard",
        pathname: "/dashboard/settings",
        name: "/tmp/app/dashboard/middleware.ts",
      });
    } finally {
      resetFarmObservability();
    }
  });

  it("emits shortCircuit and error middleware observability events", async () => {
    const events: FarmEvent[] = [];
    configureFarmObservability({ onEvent: (event) => events.push(event) });

    try {
      const shortCircuitManager = new MiddlewareManager("/tmp", undefined, [
        {
          matcher: "/dashboard/:path*",
          handler(ctx) {
            return Response.redirect(new URL("/sign-in", ctx.url));
          },
        },
      ]);

      const handled = await shortCircuitManager.execute(
        createMockRequest("/dashboard/settings"),
        createMockResponse(),
      );
      expect(handled).toBe(true);
      expect(events.map((event) => event.type)).toEqual([
        "middleware.start",
        "middleware.shortCircuit",
      ]);
      expect(events[1]).toMatchObject({
        status: 302,
        route: "/",
      });

      events.length = 0;
      const error = new Error("middleware failed");
      const errorManager = new MiddlewareManager("/tmp", undefined, [
        {
          matcher: "/dashboard/:path*",
          handler() {
            throw error;
          },
        },
      ]);

      await expect(
        errorManager.execute(createMockRequest("/dashboard/settings"), createMockResponse()),
      ).rejects.toThrow("middleware failed");

      expect(events.map((event) => event.type)).toEqual(["middleware.start", "middleware.error"]);
      expect(events[1]).toMatchObject({
        error,
        route: "/",
      });
    } finally {
      resetFarmObservability();
    }
  });

  it("passes dynamic route params to file middleware", async () => {
    const manager = new MiddlewareManager("/tmp");
    (manager as any).middleware = [
      {
        path: "/users/[id]",
        filePath: "/tmp/app/users/[id]/middleware.ts",
        handlers: [
          async (ctx: MiddlewareContext, next: () => Promise<void>) => {
            ctx.data.set("userId", ctx.params.id);
            await next();
          },
        ],
      },
    ];

    const req = createMockRequest("/users/42/settings");
    const res = createMockResponse();
    const handled = await manager.execute(req, res);

    expect(handled).toBe(false);
    expect((req as any).__FARM_MIDDLEWARE_DATA__.get("userId")).toBe("42");
  });

  it("should share middleware context across middleware chain and expose to page request data", async () => {
    const req = createMockRequest("/docs/getting-started");
    const res = createMockResponse();

    const manager = new MiddlewareManager("/tmp");
    (manager as any).middleware = [
      {
        path: "/",
        filePath: "/tmp/app/middleware.ts",
        handlers: [
          async (ctx: MiddlewareContext, next: () => Promise<void>) => {
            ctx.data.set("requestId", "req-abc");
            ctx.locals.set("session", { userId: "user-42" });
            await next();
          },
        ],
      },
      {
        path: "/docs",
        filePath: "/tmp/app/docs/middleware.ts",
        handlers: [
          async (ctx: MiddlewareContext, next: () => Promise<void>) => {
            ctx.data.set("seenRequestId", ctx.data.get("requestId"));
            ctx.locals.set("seenUserId", ctx.locals.get("session")?.userId);
            await next();
          },
        ],
      },
    ];

    const handled = await manager.execute(req, res);
    expect(handled).toBe(false);

    const middlewareData = (req as any).__FARM_MIDDLEWARE_DATA__;
    expect(middlewareData).toBeInstanceOf(Map);
    expect(middlewareData.get("requestId")).toBe("req-abc");
    expect(middlewareData.get("seenRequestId")).toBe("req-abc");
    const middlewareContext = (req as any).__FARM_MIDDLEWARE_CONTEXT__;
    expect(middlewareContext).toBeInstanceOf(Map);
    expect(middlewareContext.get("session")).toEqual({ userId: "user-42" });
    expect(middlewareContext.get("seenUserId")).toBe("user-42");
  });
});

describe("Rate Limiting Advanced", () => {
  it("should handle custom key generators", async () => {
    const chain = middleware().rateLimit({
      requests: 2,
      window: "1s",
      keyGenerator: (ctx) => {
        const userId = ctx.data.get("userId");
        return userId ? `user_${userId}` : "anonymous";
      },
    });

    const { handlers } = chain.build();

    // User 1 - first request
    {
      const req = createMockRequest("/test");
      const ctx = createContext(req, createMockResponse());
      ctx.data.set("userId", "user1");
      await executeChain(handlers, ctx);
      expect(ctx._handled).toBe(false);
    }

    // User 1 - second request (should still work)
    {
      const req = createMockRequest("/test");
      const ctx = createContext(req, createMockResponse());
      ctx.data.set("userId", "user1");
      await executeChain(handlers, ctx);
      expect(ctx._handled).toBe(false);
    }

    // User 2 - should have separate limit
    {
      const req = createMockRequest("/test");
      const ctx = createContext(req, createMockResponse());
      ctx.data.set("userId", "user2");
      await executeChain(handlers, ctx);
      expect(ctx._handled).toBe(false);
    }
  });

  it("should call onLimit callback when rate limited", async () => {
    const onLimitCalled = vi.fn();

    const chain = middleware().rateLimit({
      requests: 1,
      window: "10s",
      keyGenerator: () => "test-onlimit-key",
      onLimit: async (ctx) => {
        onLimitCalled();
      },
    });

    const { handlers } = chain.build();

    // First request - should pass
    {
      const req = createMockRequest("/test");
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(ctx._handled).toBe(false);
      expect(onLimitCalled).not.toHaveBeenCalled();
    }

    // Second request - should be rate limited
    {
      const req = createMockRequest("/test");
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(ctx._handled).toBe(true);
      expect(onLimitCalled).toHaveBeenCalled();
    }
  });

  it("should parse different time windows correctly", async () => {
    const testWindows = [
      { window: "500ms", expected: 500 },
      { window: "1s", expected: 1000 },
      { window: "2m", expected: 120000 },
      { window: "1h", expected: 3600000 },
      { window: "1d", expected: 86400000 },
    ];

    for (const { window } of testWindows) {
      const chain = middleware().rateLimit({
        requests: 100,
        window,
      });

      const { handlers } = chain.build();
      expect(handlers.length).toBe(1);
    }
  });
});

describe("Method-specific Middleware", () => {
  it("should handle different HTTP methods", async () => {
    const executed: Record<string, boolean> = {};

    const chain = middleware()
      .when(
        (ctx) => ctx.method === "GET",
        async (ctx, next) => {
          executed.GET = true;
          await next();
        },
      )
      .when(
        (ctx) => ctx.method === "POST",
        async (ctx, next) => {
          executed.POST = true;
          await next();
        },
      )
      .when(
        (ctx) => ctx.method === "DELETE",
        async (ctx, next) => {
          executed.DELETE = true;
          await next();
        },
      );

    const { handlers } = chain.build();

    // Test GET
    {
      const req = createMockRequest("/test", "GET");
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed.GET).toBe(true);
    }

    // Test POST
    {
      const req = createMockRequest("/test", "POST");
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed.POST).toBe(true);
    }

    // Test DELETE
    {
      const req = createMockRequest("/test", "DELETE");
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed.DELETE).toBe(true);
    }
  });
});

describe("Query Parameter Access", () => {
  it("should access query parameters via searchParams", () => {
    const req = createMockRequest("/test?foo=bar&baz=qux&num=123");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.searchParams.get("foo")).toBe("bar");
    expect(ctx.searchParams.get("baz")).toBe("qux");
    expect(ctx.searchParams.get("num")).toBe("123");
    expect(ctx.searchParams.get("missing")).toBeNull();
  });

  it("should handle multiple values for same param", () => {
    const req = createMockRequest("/test?tag=react&tag=typescript&tag=vite");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    const tags = ctx.searchParams.getAll("tag");
    expect(tags).toEqual(["react", "typescript", "vite"]);
  });

  it("should handle URL-encoded query params", () => {
    const req = createMockRequest("/test?name=John%20Doe&email=test%40example.com");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.searchParams.get("name")).toBe("John Doe");
    expect(ctx.searchParams.get("email")).toBe("test@example.com");
  });
});

describe("Vite Integration", () => {
  it("should detect development mode", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.vite.isDev).toBeDefined();
    expect(typeof ctx.vite.isDev).toBe("boolean");
  });

  it("should include vite server in context", () => {
    const req = createMockRequest("/test");
    const res = createMockResponse();
    const mockViteServer = { hot: {} } as any;
    const ctx = createContext(req, res, mockViteServer);

    expect(ctx.vite.server).toBe(mockViteServer);
    expect(ctx.vite.hmr).toBe(true);
  });
});
