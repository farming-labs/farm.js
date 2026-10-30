import path from "node:path";
import type { UserConfig as ViteUserConfig } from "vite";
import type { FarmRenderer } from "../renderer";

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
  // Islands mode's browser runtime: Farm imports islx, which the app reaches only through Farm.
  "@farm.js/core > @farm.js/islx/client",
  "@farm.js/core > @farm.js/islx/react",
  "@farm.js/core > @farm.js/islx/react/client",
] as const;

export function getFarmClientOptimizeDepsInclude(renderer?: FarmRenderer): string[] {
  return Array.from(
    new Set([...FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE, ...(renderer?.optimizeDeps || [])]),
  );
}

export function createFarmClientOptimizeDepsEntries(
  projectRoot: string,
  appDirectories: readonly string[],
): string[] {
  const resolvedProjectRoot = path.resolve(projectRoot);

  return appDirectories.map((appDirectory) => {
    const relativeAppDirectory = path
      .relative(resolvedProjectRoot, path.resolve(appDirectory))
      .replace(/\\/g, "/");
    const prefix = relativeAppDirectory || ".";
    return `${prefix}/${FARM_CLIENT_ENTRY_PATTERN}`;
  });
}

export function createFarmClientOptimizeDepsConfig(
  entries?: readonly string[],
  renderer?: FarmRenderer,
): ViteUserConfig["optimizeDeps"] {
  return {
    // Keep normal application dependency discovery for CJS-only packages, but
    // seed every Farm browser runtime so React is present in the first crawl.
    noDiscovery: false,
    // Waiting for the crawl avoids serving a partial optimizer generation and
    // then changing browser hashes while hydration is already in progress.
    holdUntilCrawlEnd: true,
    include: getFarmClientOptimizeDepsInclude(renderer),
    // Farm's HTML boots through a virtual module and imports route UI lazily.
    // Explicit entries let Vite finish that crawl before a navigation can
    // rotate the optimizer hash underneath a hydrated React runtime.
    ...(entries?.length ? { entries: [...entries] } : {}),
  };
}

/**
 * Farm's application-source alias. Keep this shared by development, route
 * discovery, and production bundling so `@/…` always follows `srcDir`.
 */
export function createFarmSourceAlias(projectRoot: string, srcDir = "src"): Record<string, string> {
  return {
    "@": path.resolve(projectRoot, srcDir),
  };
}

type ViteNoExternal = NonNullable<NonNullable<ViteUserConfig["ssr"]>["noExternal"]>;
type ViteAlias = NonNullable<NonNullable<ViteUserConfig["resolve"]>["alias"]>;

function mergeNoExternal(
  farmValue: ViteNoExternal | undefined,
  userValue: ViteNoExternal | undefined,
): ViteNoExternal {
  if (farmValue === true || userValue === true) return true;

  const normalize = (value: ViteNoExternal | undefined): Array<string | RegExp> =>
    value == null || value === true ? [] : Array.isArray(value) ? value : [value];

  return Array.from(new Set([...normalize(farmValue), ...normalize(userValue)]));
}

function mergeAlias(farmValue: ViteAlias | undefined, userValue: ViteAlias | undefined): ViteAlias {
  if (!farmValue) return userValue || {};
  if (!userValue) return farmValue;

  if (!Array.isArray(farmValue) && !Array.isArray(userValue)) {
    return {
      ...farmValue,
      ...userValue,
    };
  }

  const normalize = (value: ViteAlias): Exclude<ViteAlias, Record<string, string>> =>
    Array.isArray(value)
      ? [...value]
      : Object.entries(value).map(([find, replacement]) => ({ find, replacement }));

  // Vite uses the first matching array entry. Put application entries first
  // so an explicit user alias can intentionally override a Farm default.
  return [...normalize(userValue), ...normalize(farmValue)];
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
      alias: mergeAlias(farmConfig.resolve?.alias, userConfig.resolve?.alias),
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

type ViteExternal = NonNullable<NonNullable<ViteUserConfig["ssr"]>["external"]>;

function mergeExternal(
  farmValue: ViteExternal | undefined,
  userValue: ViteExternal | undefined,
): ViteExternal | undefined {
  if (farmValue === undefined) return userValue;
  if (userValue === undefined) return farmValue;
  if (farmValue === true || userValue === true) return true;
  return Array.from(new Set([...farmValue, ...userValue]));
}

/**
 * Merge the app's `vite` config into a production client or server build the
 * way development merges it, keeping the options Farm owns for that build:
 * `root`, `base`, `mode`, `appType`, `publicDir`, the build's
 * output location and format (`outDir`, `emptyOutDir`, `ssr`, `ssrEmitAssets`,
 * `write`, `lib`, `watch`, `rollupOptions.input`, `rollupOptions.output`), and
 * every `build`, `define`, `esbuild`, and Rollup option Farm sets explicitly.
 *
 * App plugins are left out: the caller places `vite.plugins` among Farm's own
 * plugins so their order relative to Farm's transforms stays stable.
 */
export function mergeFarmProductionViteConfig(
  farmConfig: ViteUserConfig,
  userConfig: ViteUserConfig = {},
): ViteUserConfig {
  const {
    plugins: _plugins,
    root: _root,
    base: _base,
    mode: _mode,
    appType: _appType,
    publicDir: _publicDir,
    build: userBuild = {},
    css: userCss,
    define: userDefine,
    esbuild: userEsbuild,
    ...shared
  } = userConfig;
  const {
    outDir: _outDir,
    emptyOutDir: _emptyOutDir,
    ssr: _ssr,
    ssrEmitAssets: _ssrEmitAssets,
    write: _write,
    lib: _lib,
    watch: _watch,
    rollupOptions: userRollupOptions,
    rolldownOptions: userRolldownOptions,
    ...userBuildOptions
  } = userBuild;
  const {
    input: _input,
    output: _output,
    ...userBundlerOptions
  } = {
    ...userRollupOptions,
    ...userRolldownOptions,
  } as NonNullable<ViteUserConfig["build"]>["rollupOptions"] & object;
  const merged = mergeFarmViteConfig(farmConfig, shared);

  return {
    ...merged,
    build: {
      ...userBuildOptions,
      ...farmConfig.build,
      rollupOptions: {
        ...userBundlerOptions,
        ...farmConfig.build?.rollupOptions,
      },
    },
    css: farmConfig.css || userCss ? { ...farmConfig.css, ...userCss } : undefined,
    define: farmConfig.define || userDefine ? { ...userDefine, ...farmConfig.define } : undefined,
    esbuild:
      typeof userEsbuild === "object" && farmConfig.esbuild !== false
        ? { ...userEsbuild, ...farmConfig.esbuild }
        : (farmConfig.esbuild ?? userEsbuild),
    ssr: {
      ...merged.ssr,
      external: mergeExternal(farmConfig.ssr?.external, userConfig.ssr?.external),
    },
  };
}
