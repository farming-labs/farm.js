/**
 * Middleware Chain Builder
 */

import type {
  MiddlewareChain,
  MiddlewareFunction,
  MiddlewareContext,
  MiddlewareConfig,
  RateLimitConfig,
  RateLimitStorage,
  RateLimitStatus,
} from "./types";
import { getStorage } from "../storage";
import type { Storage } from "unstorage";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

function getRateLimitStorage(): Storage {
  return getStorage("ratelimit");
}

const defaultRateLimitStorage: RateLimitStorage = {
  async get(key: string) {
    const storage = getRateLimitStorage();
    const value = await storage.getItem<RateLimitRecord>(key);
    return value ?? null;
  },
  async set(key: string, value: any, ttl?: number) {
    const storage = getRateLimitStorage();
    await storage.setItem(key, value, ttl ? { ttl } : undefined);
  },
  async delete(key: string) {
    const storage = getRateLimitStorage();
    await storage.removeItem(key);
  },
  async ttl(key: string) {
    const storage = getRateLimitStorage();
    const record = await storage.getItem<RateLimitRecord>(key);
    if (!record || !record.resetAt) {
      return null;
    }
    const remainingMs = record.resetAt - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : null;
  },
};

function parseTimeWindow(window: string): number {
  const match = window.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) throw new Error(`Invalid time window: ${window}`);

  const [, amount, unit] = match;
  const value = Number.parseInt(amount, 10);

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

function createRateLimitMiddleware(config: RateLimitConfig): MiddlewareFunction {
  const windowMs = parseTimeWindow(config.window);
  const storage = config.storage || defaultRateLimitStorage;

  return async (ctx: MiddlewareContext, next: () => Promise<void>) => {
    const key = config.keyGenerator
      ? config.keyGenerator(ctx)
      : `${ctx.request.socket.remoteAddress}:${ctx.pathname}`;

    const now = Date.now();
    const ttlSeconds = Math.ceil(windowMs / 1000);
    const record = await storage.get(key);

    if (record && now > record.resetAt) {
      await storage.delete(key);
    }

    const current = await storage.get(key);

    if (!current) {
      await storage.set(
        key,
        {
          count: 1,
          resetAt: now + windowMs,
        },
        ttlSeconds,
      );
      await next();
      return;
    }

    if (current.count >= config.requests) {
      if (config.onLimit) {
        const result = await config.onLimit(ctx);
        if (result) return;
      }

      ctx.json(
        {
          error: "Rate limit exceeded",
          retryAfter: Math.ceil((current.resetAt - now) / 1000),
        },
        429,
      );
      return;
    }

    current.count++;
    await storage.set(key, current, ttlSeconds);
    await next();
  };
}

function matchPattern(pattern: string | RegExp, pathname: string): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(pathname);
  }

  const regexPattern = pattern
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]+")
    .replace(/__DOUBLE_STAR__/g, ".*")
    .replace(/\//g, "\\/");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(pathname);
}

class MiddlewareChainImpl implements MiddlewareChain {
  private handlers: MiddlewareFunction[] = [];
  public config?: MiddlewareConfig;
  private basePath: string;

  constructor(basePath = "/") {
    this.basePath =
      basePath === "/" ? "/" : basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  }

  /**
   * Set the base path for this middleware chain (called by manager when loading)
   */
  setBasePath(path: string): void {
    this.basePath = path === "/" ? "/" : path.endsWith("/") ? path.slice(0, -1) : path;
  }

  use(fn: MiddlewareFunction): MiddlewareChain {
    this.handlers.push(fn);
    return this;
  }

  /**
   * Normalize a path pattern - auto-scope to middleware route
   * If middleware is in /contact, then "/api" becomes "/contact/api"
   */
  private normalizePattern(pattern: string): string {
    // If we're at root middleware, use pattern as-is
    if (this.basePath === "/") {
      // Ensure it starts with /
      return pattern.startsWith("/") ? pattern : `/${pattern}`;
    }

    // For route-specific middleware, always scope the pattern
    // Remove leading / from pattern if present, then join with basePath
    const cleanPattern = pattern.startsWith("/") ? pattern.slice(1) : pattern;
    return `${this.basePath}/${cleanPattern}`;
  }

  /**
   * Conditionally run middleware based on a condition.
   * Only supports boolean values or functions that evaluate to boolean.
   * Route-based string matching has been removed - use function conditions instead.
   *
   * @example
   * .when(true, (ctx, next) => { ... })  // Always run
   * .when((ctx) => ctx.data.get('flag'), (ctx, next) => { ... })  // Conditional
   * .when((ctx) => ctx.pathname === '/contact', (ctx, next) => { ... })  // Path-based condition
   */
  when(
    condition: boolean | ((ctx: MiddlewareContext) => boolean),
    fn: MiddlewareFunction | ((chain: MiddlewareChain) => void),
  ): MiddlewareChain {
    const conditionalMiddleware: MiddlewareFunction = async (ctx, next) => {
      // Evaluate condition - boolean or function
      const shouldRun = typeof condition === "function" ? condition(ctx) : condition;

      if (!shouldRun) {
        await next();
        return;
      }

      if (typeof fn === "function" && fn.length === 2) {
        await (fn as MiddlewareFunction)(ctx, next);
      } else {
        const subChain = middleware(this.basePath);
        (fn as (chain: MiddlewareChain) => void)(subChain);
        const { handlers } = subChain.build();

        let index = 0;
        const executeNext = async (): Promise<void> => {
          if (index < handlers.length) {
            const handler = handlers[index++];
            await handler(ctx, executeNext);
          } else {
            await next();
          }
        };

        await executeNext();
      }
    };
    this.handlers.push(conditionalMiddleware);
    return this;
  }

  rateLimit(config: RateLimitConfig): MiddlewareChain {
    this.handlers.push(createRateLimitMiddleware(config));
    return this;
  }

  redirect(source: string, destination: string, permanent = false): MiddlewareChain {
    const redirectMiddleware: MiddlewareFunction = async (ctx, next) => {
      // Auto-scope source pattern to the middleware route
      const normalizedSource = this.normalizePattern(source);
      if (matchPattern(normalizedSource, ctx.pathname)) {
        ctx.redirect(destination, permanent ? 308 : 307);
        return;
      }
      await next();
    };

    this.handlers.push(redirectMiddleware);
    return this;
  }

  /**
   * Rewrite the current middleware route to a new destination.
   * Since each middleware file is route-specific, the source is automatically
   * the middleware's route, so you only need to specify the destination.
   *
   * @param destination - The destination path to rewrite to
   * @param condition - Optional boolean or function that evaluates to boolean.
   *                    If provided and evaluates to false, rewrite is skipped.
   *                    If not provided, rewrite always happens.
   *
   * @example
   * // In /contact/middleware.ts
   * .rewrite('/about')  // Always rewrites /contact to /about
   * .rewrite('/about', true)  // Always rewrites
   * .rewrite('/about', false)  // Never rewrites
   * .rewrite('/about', (ctx) => ctx.data.get('shouldRewrite'))  // Conditional rewrite
   */
  rewrite(
    destination: string,
    condition?: boolean | ((ctx: MiddlewareContext) => boolean),
  ): MiddlewareChain {
    const rewriteMiddleware: MiddlewareFunction = async (ctx, next) => {
      // Check condition if provided
      if (condition !== undefined) {
        const shouldRewrite = typeof condition === "function" ? condition(ctx) : condition;
        if (!shouldRewrite) {
          await next();
          return;
        }
      }

      // If this middleware is route-specific (not root)
      if (this.basePath !== "/") {
        // Rewrite when the pathname exactly matches this middleware's route
        // This rewrites the entire route (e.g., /contact -> /about)
        if (ctx.pathname === this.basePath) {
          ctx.rewrite(destination);
        }
        // Also handle sub-routes: rewrite /contact/something to /destination/something
        else if (ctx.pathname.startsWith(this.basePath + "/")) {
          const subPath = ctx.pathname.slice(this.basePath.length);
          const newPath = destination + subPath;
          ctx.rewrite(newPath);
        }
      } else {
        // For root middleware, this is less common
        // Only rewrite if pathname matches exactly (edge case)
        ctx.rewrite(destination);
      }
      await next();
    };

    this.handlers.push(rewriteMiddleware);
    return this;
  }

  build() {
    return {
      handlers: this.handlers,
      config: this.config,
    };
  }
}

/**
 * Get rate limit status for a key
 * @example
 * const status = await getRateLimitStatus('user:123', 100, storage);
 */
export async function getRateLimitStatus(
  key: string,
  limit: number,
  storage: RateLimitStorage = defaultRateLimitStorage,
): Promise<RateLimitStatus> {
  const record = await storage.get(key);

  if (!record) {
    return {
      requests: 0,
      limit,
      remaining: limit,
      resetIn: null,
      resetAt: null,
      isLimited: false,
    };
  }

  const now = Date.now();

  if (record.resetAt && now > record.resetAt) {
    return {
      requests: 0,
      limit,
      remaining: limit,
      resetIn: null,
      resetAt: null,
      isLimited: false,
    };
  }

  const requests = record.count || 0;
  const remaining = Math.max(0, limit - requests);
  const isLimited = requests >= limit;

  let resetIn: number | null = null;
  let resetAt: Date | null = null;

  if (record.resetAt) {
    const remainingMs = record.resetAt - now;
    resetIn = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : null;
    resetAt = new Date(record.resetAt);
  } else if (storage.ttl) {
    resetIn = await storage.ttl(key);
    resetAt = resetIn ? new Date(now + resetIn * 1000) : null;
  }

  return {
    requests,
    limit,
    remaining,
    resetIn,
    resetAt,
    isLimited,
  };
}

export function middleware(basePath = "/"): MiddlewareChain {
  return new MiddlewareChainImpl(basePath);
}
