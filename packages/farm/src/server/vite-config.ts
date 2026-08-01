import type { UserConfig as ViteUserConfig } from "vite";

/**
 * Client runtimes that must be optimized in the same generation as React.
 * Farm loads route modules dynamically, so Vite's HTML crawl cannot reliably
 * discover these linked-package entry points before hydration begins.
 */
export const FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@farm.js/core/client",
  "@farm.js/core/plugin/client",
  "@farm.js/core/deferred",
  "@farm.js/core/deployment",
] as const;

export function createFarmClientOptimizeDepsConfig(): ViteUserConfig["optimizeDeps"] {
  return {
    noDiscovery: true,
    // Vite 5 otherwise schedules a redundant optimizer pass when its static
    // crawl ends, even when discovery is disabled and no dependency was found.
    // A page can hydrate between those passes and receive mixed browser hashes.
    holdUntilCrawlEnd: false,
    include: [...FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE],
  };
}

type ViteNoExternal = NonNullable<NonNullable<ViteUserConfig["ssr"]>["noExternal"]>;

function mergeNoExternal(
  farmValue: ViteNoExternal | undefined,
  userValue: ViteNoExternal | undefined,
): ViteNoExternal {
  if (farmValue === true || userValue === true) return true;

  const normalize = (value: ViteNoExternal | undefined): Array<string | RegExp> =>
    value == null || value === true ? [] : Array.isArray(value) ? value : [value];

  return Array.from(new Set([...normalize(farmValue), ...normalize(userValue)]));
}

export function mergeFarmViteConfig(
  farmConfig: ViteUserConfig,
  userConfig: ViteUserConfig = {},
): ViteUserConfig {
  return {
    ...farmConfig,
    ...userConfig,
    plugins: [...(farmConfig.plugins || []), ...(userConfig.plugins || [])],
    server: {
      ...farmConfig.server,
      ...userConfig.server,
    },
    resolve: {
      ...farmConfig.resolve,
      ...userConfig.resolve,
      dedupe: Array.from(
        new Set([...(farmConfig.resolve?.dedupe || []), ...(userConfig.resolve?.dedupe || [])]),
      ),
    },
    optimizeDeps: {
      ...farmConfig.optimizeDeps,
      ...userConfig.optimizeDeps,
      include: Array.from(
        new Set([
          ...(farmConfig.optimizeDeps?.include || []),
          ...(userConfig.optimizeDeps?.include || []),
        ]),
      ),
      exclude: Array.from(
        new Set([
          ...(farmConfig.optimizeDeps?.exclude || []),
          ...(userConfig.optimizeDeps?.exclude || []),
        ]),
      ),
    },
    ssr: {
      ...farmConfig.ssr,
      ...userConfig.ssr,
      noExternal: mergeNoExternal(farmConfig.ssr?.noExternal, userConfig.ssr?.noExternal),
    },
  };
}
