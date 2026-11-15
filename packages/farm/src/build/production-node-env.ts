export { FARM_NODE_ENV_MODULE_FILE, FARM_NODE_ENV_MODULE_SOURCE } from "../nitro/node-server-entry";

const productionNodeEnvStateKey = Symbol.for("@farm.js/core/production-node-env-state");

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

// React's packages, and the copy of React's Flight runtime that @vitejs/plugin-rsc vendors.
const REACT_RUNTIME_DIRECTORIES = [
  "/node_modules/react/",
  "/node_modules/react-dom/",
  "/node_modules/react-server-dom-webpack/",
  "/node_modules/@vitejs/plugin-rsc/dist/vendor/react-server-dom/",
];

/**
 * Replaces React's `process.env.NODE_ENV` checks with "production", so a bundle
 * that includes React keeps only its production builds. React's entry files pick
 * the development or production build at runtime from that check; left in place,
 * both builds ship.
 *
 * @internal
 */
export function createReactProductionModePlugin() {
  const nodeEnvExpression = ["process", "env", "NODE_ENV"].join(".");
  return {
    name: "farm-react-production-mode",
    transform: {
      filter: {
        id: /\/node_modules\/(?:react(?:-dom|-server-dom-webpack)?|@vitejs\/plugin-rsc\/dist\/vendor\/react-server-dom)\//,
        code: new RegExp(nodeEnvExpression.replace(/\./g, "\\.")),
      },
      handler(code: string, id: string) {
        const normalizedId = id.replace(/\\/g, "/");
        const isReactRuntime = REACT_RUNTIME_DIRECTORIES.some((directory) =>
          normalizedId.includes(directory),
        );
        if (!isReactRuntime || !code.includes(nodeEnvExpression)) return null;
        return { code: code.split(nodeEnvExpression).join('"production"'), map: null };
      },
    },
  };
}
