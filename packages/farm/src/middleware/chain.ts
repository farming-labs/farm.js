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
  RateLimitIncrementResult,
  MemoryRateLimitStorageOptions,
  MiddlewareResult,
} from "./types";

const DEFAULT_MEMORY_RATE_LIMIT_ENTRIES = 100_000;

export class UnsupportedRateLimitStorageError extends TypeError {
  constructor() {
    super(
      "RateLimitStorage must implement atomic increment(key, windowMs). Legacy get/set adapters can lose increments under concurrency. Use memoryRateLimitStorage() for one process or redisRateLimitStorage() from @farm.js/cache-redis for production.",
    );
    this.name = "UnsupportedRateLimitStorageError";
  }
}

/** Create an atomic, process-local fixed-window rate-limit store. */
export function memoryRateLimitStorage(
  options: MemoryRateLimitStorageOptions = {},
): RateLimitStorage {
  const maxEntries = options.maxEntries ?? DEFAULT_MEMORY_RATE_LIMIT_ENTRIES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new TypeError("memoryRateLimitStorage maxEntries must be a positive safe integer.");
  }

  const records = new Map<string, RateLimitIncrementResult>();

  function read(key: string, now: number): RateLimitIncrementResult | null {
    const record = records.get(key);
    if (!record) return null;
    if (record.resetAt <= now) {
      records.delete(key);
      return null;
    }
    return record;
  }

  function pruneExpired(now: number): void {
    for (const [key, record] of records) {
      if (record.resetAt <= now) records.delete(key);
    }
  }

  return {
    increment(key, windowMs) {
      if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
        throw new TypeError("Rate-limit windowMs must be a positive safe integer.");
      }
      const now = Date.now();
      const current = read(key, now);
      if (current) {
        const next = { count: current.count + 1, resetAt: current.resetAt };
        records.set(key, next);
        return next;
      }

      if (records.size >= maxEntries) pruneExpired(now);
      if (records.size >= maxEntries) {
        throw new Error(
          `Process-local rate-limit storage reached its ${maxEntries} active-key capacity. Configure a shared production adapter or increase maxEntries.`,
        );
      }

      const next = { count: 1, resetAt: now + windowMs };
      records.set(key, next);
      return next;
    },
    get(key) {
      const record = read(key, Date.now());
      return record ? { ...record } : null;
    },
  };
}

const defaultRateLimitStorage = memoryRateLimitStorage();

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

  const windowMs = value * multipliers[unit];
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new Error(`Invalid time window: ${window}`);
  }
  return windowMs;
}

function createRateLimitMiddleware(config: RateLimitConfig): MiddlewareFunction {
  if (!Number.isSafeInteger(config.requests) || config.requests <= 0) {
    throw new TypeError("Rate limit requests must be a positive safe integer.");
  }
  const windowMs = parseTimeWindow(config.window);
  const storage = config.storage || defaultRateLimitStorage;
  assertAtomicRateLimitStorage(storage);

  return async (ctx: MiddlewareContext, next) => {
    const key = config.keyGenerator
      ? config.keyGenerator(ctx)
      : `${ctx.request.socket.remoteAddress}:${ctx.pathname}`;

    const current = await storage.increment(key, windowMs);
    assertRateLimitIncrementResult(current);
    const now = Date.now();
    const resetIn = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    const remaining = Math.max(0, config.requests - current.count);
    setRateLimitHeaders(ctx, config.requests, remaining, resetIn, Math.ceil(windowMs / 1000));

    if (current.count > config.requests) {
      setMiddlewareResponseHeader(ctx, "Retry-After", String(resetIn));
      if (config.onLimit) {
        const result = await config.onLimit(ctx);
        if (result) return result;
      }

      ctx.json(
        {
          error: "Rate limit exceeded",
          retryAfter: resetIn,
        },
        429,
      );
      return;
    }

    return next();
  };
}

function assertAtomicRateLimitStorage(storage: RateLimitStorage): void {
  if (!storage || typeof storage.increment !== "function") {
    throw new UnsupportedRateLimitStorageError();
  }
}

function assertRateLimitIncrementResult(
  result: RateLimitIncrementResult,
): asserts result is RateLimitIncrementResult {
  if (
    !result ||
    !Number.isSafeInteger(result.count) ||
    result.count <= 0 ||
    !Number.isFinite(result.resetAt) ||
    result.resetAt <= 0
  ) {
    throw new TypeError(
      "RateLimitStorage.increment() must return a positive integer count and a resetAt timestamp.",
    );
  }
}

function setRateLimitHeaders(
  ctx: MiddlewareContext,
  limit: number,
  remaining: number,
  resetIn: number,
  windowSeconds: number,
): void {
  setMiddlewareResponseHeader(ctx, "RateLimit-Policy", `"farm";q=${limit};w=${windowSeconds}`);
  setMiddlewareResponseHeader(ctx, "RateLimit", `"farm";r=${remaining};t=${resetIn}`);
}

function setMiddlewareResponseHeader(ctx: MiddlewareContext, name: string, value: string): void {
  ctx.headers.set(name, value);
  if (!ctx.response.headersSent && !ctx.response.writableEnded) {
    ctx.response.setHeader(name, value);
  }
}

function matchPattern(pattern: string | RegExp, pathname: string): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(pathname);
  }

  // Protect glob stars, escape every regex metacharacter, then restore the
  // globs — otherwise "/promo.html" also matches "/promoXhtml" and a pattern
  // containing "(" throws at request time.
  const regexPattern = pattern
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "__SINGLE_STAR__")
    .replace(/[.+?^${}()|[\]\\/]/g, "\\$&")
    .replace(/__DOUBLE_STAR__/g, ".*")
    .replace(/__SINGLE_STAR__/g, "[^/]+");

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
        return next();
      }

      if (typeof fn === "function" && fn.length === 2) {
        return (fn as MiddlewareFunction)(ctx, next);
      } else {
        const subChain = middleware(this.basePath);
        (fn as (chain: MiddlewareChain) => void)(subChain);
        const { handlers } = subChain.build();

        let index = 0;
        let returnedResponse: Response | undefined;
        const executeNext = async (): Promise<MiddlewareResult> => {
          if (index < handlers.length) {
            const handler = handlers[index++];
            const result = await handler(ctx, executeNext);
            if (result instanceof Response) {
              returnedResponse = result;
              return result;
            }
          } else {
            const result = await next();
            if (result instanceof Response) {
              returnedResponse = result;
              return result;
            }
          }
          return returnedResponse;
        };

        return executeNext();
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
      return next();
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
          return next();
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
      return next();
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
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError("Rate limit must be a positive safe integer.");
  }
  assertAtomicRateLimitStorage(storage);
  if (typeof storage.get !== "function") {
    throw new TypeError(
      "getRateLimitStatus() requires a RateLimitStorage adapter that implements get(key).",
    );
  }
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
  assertRateLimitIncrementResult(record);

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
