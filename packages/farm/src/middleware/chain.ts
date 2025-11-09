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
} from './types';

const defaultStore = new Map<string, any>();
const defaultRateLimitStorage: RateLimitStorage = {
  get(key: string) {
    return defaultStore.get(key) || null;
  },
  set(key: string, value: any, ttl?: number) {
    defaultStore.set(key, value);
  },
  delete(key: string) {
    defaultStore.delete(key);
  },
  ttl(key: string) {
    const record = defaultStore.get(key);
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
  const value = parseInt(amount, 10);

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
      await storage.set(key, {
        count: 1,
        resetAt: now + windowMs,
      }, ttlSeconds);
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
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((current.resetAt - now) / 1000),
        },
        429
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
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]+')
    .replace(/__DOUBLE_STAR__/g, '.*')
    .replace(/\//g, '\\/');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(pathname);
}

class MiddlewareChainImpl implements MiddlewareChain {
  private handlers: MiddlewareFunction[] = [];
  public config?: MiddlewareConfig;

  use(fn: MiddlewareFunction): MiddlewareChain {
    this.handlers.push(fn);
    return this;
  }

  when(
    condition: string | boolean | ((ctx: MiddlewareContext) => boolean),
    fn: MiddlewareFunction | ((chain: MiddlewareChain) => void)
  ): MiddlewareChain {
    const conditionalMiddleware: MiddlewareFunction = async (ctx, next) => {
      let shouldRun = false;

      if (typeof condition === 'boolean') {
        shouldRun = condition;
      } else if (typeof condition === 'string') {
        shouldRun = matchPattern(condition, ctx.pathname);
      } else if (typeof condition === 'function') {
        shouldRun = condition(ctx);
      }

      if (!shouldRun) {
        await next();
        return;
      }

      if (typeof fn === 'function' && fn.length === 2) {
        await (fn as MiddlewareFunction)(ctx, next);
      } else {
        const subChain = middleware();
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

  redirect(source: string, destination: string, permanent: boolean = false): MiddlewareChain {
    const redirectMiddleware: MiddlewareFunction = async (ctx, next) => {
      if (matchPattern(source, ctx.pathname)) {
        ctx.redirect(destination, permanent ? 308 : 307);
        return;
      }
      await next();
    };

    this.handlers.push(redirectMiddleware);
    return this;
  }

  rewrite(source: string, destination: string): MiddlewareChain {
    const rewriteMiddleware: MiddlewareFunction = async (ctx, next) => {
      if (matchPattern(source, ctx.pathname)) {
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
  storage: RateLimitStorage = defaultRateLimitStorage
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

export function middleware(): MiddlewareChain {
  return new MiddlewareChainImpl();
}

