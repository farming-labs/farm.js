import path from "node:path";
import type { UserConfig as ViteUserConfig } from "vite";

const FARM_CLIENT_ENTRY_PATTERN =
  "**/{page,layout,loading,error,not-found,default}.{js,jsx,ts,tsx}";

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
  "@farm.js/core/i18n/client",
  "@farm.js/core/query/client",
  "@farm.js/core/server-fn/client",
  "@farm.js/core/server-query/client",
] as const;

export function createFarmClientOptimizeDepsEntries(
  projectRoot: string,
  appDirectories: readonly string[],
): string[] {
  const resolvedProjectRoot = path.resolve(projectRoot);

  return appDirectories.map((appDirectory) => {
    const relativeAppDirectory = path
      .relative(resolvedProjectRoot, path.resolve(appDirectory))
      .replaceAll("\\", "/");
    const prefix = relativeAppDirectory || ".";
    return `${prefix}/${FARM_CLIENT_ENTRY_PATTERN}`;
  });
}

export function createFarmClientOptimizeDepsConfig(
  entries?: readonly string[],
): ViteUserConfig["optimizeDeps"] {
  return {
    // Keep normal application dependency discovery for CJS-only packages, but
    // seed every Farm browser runtime so React is present in the first crawl.
    noDiscovery: false,
    // Waiting for the crawl avoids serving a partial optimizer generation and
    // then changing browser hashes while hydration is already in progress.
    holdUntilCrawlEnd: true,
    include: [...FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE],
    // Farm's HTML boots through a virtual module and imports route UI lazily.
    // Explicit entries let Vite finish that crawl before a navigation can
    // rotate the optimizer hash underneath a hydrated React runtime.
    ...(entries?.length ? { entries: [...entries] } : {}),
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
  const noDiscovery = userConfig.optimizeDeps?.noDiscovery ?? farmConfig.optimizeDeps?.noDiscovery;
  const holdUntilCrawlEnd =
    userConfig.optimizeDeps?.holdUntilCrawlEnd ??
    (userConfig.optimizeDeps?.noDiscovery === true
      ? false
      : farmConfig.optimizeDeps?.holdUntilCrawlEnd);

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
      noDiscovery,
      holdUntilCrawlEnd,
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
