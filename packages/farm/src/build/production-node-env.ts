const productionNodeEnvStateKey = Symbol.for("@farmjs/core/production-node-env-state");

interface ProductionNodeEnvState {
  depth: number;
  original: string | undefined;
}

function getProductionNodeEnvState(): ProductionNodeEnvState | undefined {
  return Reflect.get(globalThis, productionNodeEnvStateKey) as ProductionNodeEnvState | undefined;
}

/**
 * Keep overlapping production operations on the production condition.
 *
 * The state lives on `globalThis` so independently loaded CJS/ESM copies of
 * Farm share one refcount. The first entrant captures the caller's value and
 * only the last operation to settle restores it.
 *
 * @internal
 */
export async function withProductionNodeEnv<T>(operation: () => T | PromiseLike<T>): Promise<T> {
  let state = getProductionNodeEnvState();

  if (state) {
    state.depth += 1;
  } else {
    state = {
      depth: 1,
      original: process.env.NODE_ENV,
    };
    Reflect.set(globalThis, productionNodeEnvStateKey, state);
  }

  process.env.NODE_ENV = "production";

  try {
    return await operation();
  } finally {
    state.depth -= 1;

    if (state.depth > 0) {
      // A nested operation may have changed NODE_ENV. Keep the remaining
      // production scopes pinned until the final scope settles.
      process.env.NODE_ENV = "production";
    } else {
      Reflect.deleteProperty(globalThis, productionNodeEnvStateKey);
      if (state.original === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = state.original;
      }
    }
  }
}
