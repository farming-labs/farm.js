/**
 * Middleware Chain Builder
 */

import type {
  MiddlewareChain,
  MiddlewareFunction,
  MiddlewareContext,
  MiddlewareConfig,
  RateLimitConfig,
} from './types';


const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

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

/**
 * Create a rate limiting middleware
 */
function createRateLimitMiddleware(config: RateLimitConfig): MiddlewareFunction {
  const windowMs = parseTimeWindow(config.window);

  return async (ctx: MiddlewareContext, next: () => Promise<void>) => {
    const key = config.keyGenerator
      ? config.keyGenerator(ctx)
      : `${ctx.request.socket.remoteAddress}:${ctx.pathname}`;

    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (record && now > record.resetAt) {
      rateLimitStore.delete(key);
    }

    const current = rateLimitStore.get(key);

    if (!current) {
      rateLimitStore.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
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
    await next();
  };
}

/**
 * Match a pattern against a pathname
 */
function matchPattern(pattern: string | RegExp, pathname: string): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(pathname);
  }

  // Convert glob-style pattern to regex
  // * -> [^/]+ (match anything except /)
  // ** -> .* (match anything)
  const regexPattern = pattern
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]+')
    .replace(/__DOUBLE_STAR__/g, '.*')
    .replace(/\//g, '\\/');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(pathname);
}

/**
 * Middleware Chain Implementation
 */
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
        // It's a middleware function
        await (fn as MiddlewareFunction)(ctx, next);
      } else {
        // It's a chain builder function
        const subChain = middleware();
        (fn as (chain: MiddlewareChain) => void)(subChain);
        const { handlers } = subChain.build();

        // Execute sub-chain handlers
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
 * Create a new middleware chain
 */
export function middleware(): MiddlewareChain {
  return new MiddlewareChainImpl();
}

