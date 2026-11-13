import type { Connect } from "vite";

/**
 * @internal How `startDevServer` lets Farm's dev setup finish after the port opens. Farm's Vite
 * plugin sets `setup` when its `configureServer` hook starts that setup in the background, and
 * `createServer` replaces `ready` with everything a request must wait for.
 */
export interface FarmDeferredDevSetup {
  /** Farm's own setup: routes, the hydration plan, API routes, middleware, and type artifacts. */
  setup?: Promise<void>;
  /** What a request waits for before Farm handles it. */
  ready?: Promise<void>;
}

/** Where Farm's dev setup registers its request middleware. */
export interface FarmDevMiddlewareTarget {
  use(handle: Connect.NextHandleFunction): unknown;
  readonly stack: ReadonlyArray<{ handle: unknown }>;
}

/**
 * A middleware stack that runs once `ready` settles. It stands where Farm's middleware would
 * otherwise sit in Vite's stack, so a request that arrives while setup is still running waits,
 * then passes through Farm's middleware in the same order. If setup fails, the request gets the
 * failure, as Vite's error middleware reports it.
 */
export function createFarmDeferredMiddleware(ready: () => Promise<void> | undefined): {
  handle: Connect.NextHandleFunction;
  target: FarmDevMiddlewareTarget;
} {
  const stack: Array<{ route: string; handle: Connect.NextHandleFunction }> = [];
  const run: Connect.NextHandleFunction = (req, res, next) => {
    let index = 0;
    const step = (error?: unknown) => {
      if (error !== undefined && error !== null) return next(error);
      const layer = stack[index++];
      if (!layer) return next();
      try {
        layer.handle(req, res, step);
      } catch (thrown) {
        // Connect reports a handler's synchronous throw through the stack's error path.
        next(thrown ?? new Error("Middleware threw a nullish value"));
      }
    };
    step();
  };
  return {
    handle(req, res, next) {
      const pending = ready();
      if (!pending) return run(req, res, next);
      pending.then(
        () => run(req, res, next),
        (error: unknown) => next(error ?? new Error("Farm dev server setup failed")),
      );
    },
    target: {
      stack,
      use(handle) {
        stack.push({ route: "", handle });
        return this;
      },
    },
  };
}
