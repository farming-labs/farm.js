import path from "node:path";
import type { UserConfig as ViteUserConfig } from "vite";
import { isPackageSpecifier } from "../build/node-module-bundle";
import { isFarmRendererDisabled, isReactRenderer, type FarmRenderer } from "../renderer";
import { findFarmAppPackageDir } from "../server-components-status";

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

/**
 * Whether the package `specifier` names is installed in a `node_modules` directory for the app
 * in `root`. A workspace package linked into `node_modules` resolves outside it, and Vite serves
 * such a package as source, as it does when an app file imports one.
 */
function isInstalledPackage(root: string, specifier: string): boolean {
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  const directory = findFarmAppPackageDir(root, name);
  return directory !== undefined && directory.split(path.sep).includes("node_modules");
}

export function getFarmClientOptimizeDepsInclude(renderer?: FarmRenderer, root?: string): string[] {
  return Array.from(
    new Set([
      ...FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE,
      ...(renderer?.optimizeDeps || []),
      // Farm's browser entry imports a renderer's client module, and no app file does, so Vite's
      // scan never sees it and finds it only on the first page request, then bundles again. The
      // React entry imports `react-dom/client` instead, which is already listed. A linked
      // renderer stays source: pre-bundling it would copy the packages it shares with the app's
      // components into the bundle, so a hook would read a different copy than the renderer set.
      ...(renderer &&
      root &&
      !isReactRenderer(renderer) &&
      isPackageSpecifier(renderer.client) &&
      isInstalledPackage(root, renderer.client)
        ? [renderer.client]
        : []),
    ]),
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
  renderer?: FarmRenderer | false,
  /** The app root, which a custom renderer's client module is resolved from. */
  root?: string,
): ViteUserConfig["optimizeDeps"] {
  // `renderer: false` serves no browser code, so there is nothing to pre-bundle, and Farm's
  // browser runtimes would pull in React, which a backend-only app does not install.
  if (isFarmRendererDisabled(renderer)) return { noDiscovery: true, include: [] };
  return {
    // Keep normal application dependency discovery for CJS-only packages, but
    // seed every Farm browser runtime so React is present in the first crawl.
    noDiscovery: false,
    // Waiting for the crawl avoids serving a partial optimizer generation and
    // then changing browser hashes while hydration is already in progress.
    holdUntilCrawlEnd: true,
    include: getFarmClientOptimizeDepsInclude(renderer || undefined, root),
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

/**
 * Farm's aliases after the app's. Vite uses the first alias that matches, in order, so an app
 * alias such as `@/components/ui/*` overrides Farm's `@` for the paths it covers. Development
 * (Farm's Vite plugin) and production builds both merge this way. A Farm alias whose name the app
 * also uses is dropped, as an object spread would drop it.
 */
export function mergeFarmViteAlias(
  farmValue: ViteAlias | undefined,
  userValue: ViteAlias | undefined,
): ViteAlias {
  if (!farmValue) return userValue || {};
  if (!userValue) return farmValue;

  if (!Array.isArray(farmValue) && !Array.isArray(userValue)) {
    return {
      ...userValue,
      ...Object.fromEntries(
        Object.entries(farmValue).filter(
          ([find]) => !Object.prototype.hasOwnProperty.call(userValue, find),
        ),
      ),
    };
  }

  const normalize = (value: ViteAlias): Exclude<ViteAlias, Record<string, string>> =>
    Array.isArray(value)
      ? [...value]
      : Object.entries(value).map(([find, replacement]) => ({ find, replacement }));

  const userEntries = normalize(userValue);
  const userNames = new Set(userEntries.map((entry) => entry.find));
  return [...userEntries, ...normalize(farmValue).filter((entry) => !userNames.has(entry.find))];
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
      alias: mergeFarmViteAlias(farmConfig.resolve?.alias, userConfig.resolve?.alias),
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

type ViteBundlerOptions = NonNullable<NonNullable<ViteUserConfig["build"]>["rollupOptions"]>;
type ViteOutputOptions = Exclude<NonNullable<ViteBundlerOptions["output"]>, readonly unknown[]>;

/**
 * Output options of the production client build that Farm owns. The server reads the entry,
 * stylesheet and chunk file names (`farm-client-h<hash>.js`, `farm-client.css`, `-h<hex>`
 * hashes), and source maps stay private (see client-sourcemaps.ts), so an app value for any of
 * these is ignored.
 */
export const FARM_CLIENT_OWNED_OUTPUT_OPTIONS = [
  "dir",
  "file",
  "format",
  "entryFileNames",
  "chunkFileNames",
  "assetFileNames",
  "hashCharacters",
] as const;

function isFarmOwnedClientOutputOption(key: string): boolean {
  return (
    (FARM_CLIENT_OWNED_OUTPUT_OPTIONS as readonly string[]).includes(key) ||
    key.startsWith("sourcemap")
  );
}

/**
 * The client build's output options: the app's `output` without the options Farm owns, then
 * Farm's own output options on top.
 */
function mergeFarmClientOutputOptions(
  farmOutput: ViteBundlerOptions["output"],
  userOutput: ViteBundlerOptions["output"],
): ViteBundlerOptions["output"] {
  if (userOutput === undefined) return farmOutput;
  if (Array.isArray(userOutput) || Array.isArray(farmOutput)) {
    throw new Error(
      "Farm builds one client output: set vite.build.rolldownOptions.output (or rollupOptions.output) to an object, not an array.",
    );
  }
  const app = Object.fromEntries(
    Object.entries(userOutput as ViteOutputOptions).filter(
      ([key, value]) => value !== undefined && !isFarmOwnedClientOutputOption(key),
    ),
  );
  return { ...app, ...(farmOutput as ViteOutputOptions | undefined) } as ViteOutputOptions;
}

export interface FarmProductionViteMergeOptions {
  /**
   * Keep the app's `build.rolldownOptions.output` / `build.rollupOptions.output`, under Farm's
   * owned output options. Set for the browser client build; the server build keeps Farm's
   * output only.
   */
  clientOutput?: boolean;
}

/**
 * Merge the app's `vite` config into a production client or server build the
 * way development merges it, keeping the options Farm owns for that build:
 * `root`, `base`, `mode`, `appType`, `publicDir`, the build's
 * output location and format (`outDir`, `emptyOutDir`, `ssr`, `ssrEmitAssets`,
 * `write`, `lib`, `watch`, `rollupOptions.input`), and every `build`, `define`,
 * `esbuild`, and Rollup option Farm sets explicitly.
 *
 * The app's `output` reaches the client build with `clientOutput` (chunking,
 * minification and other output options), except the file names, format and
 * source map options in {@link FARM_CLIENT_OWNED_OUTPUT_OPTIONS}. The server
 * build ignores it.
 *
 * App plugins are left out: the caller places `vite.plugins` among Farm's own
 * plugins so their order relative to Farm's transforms stays stable.
 */
export function mergeFarmProductionViteConfig(
  farmConfig: ViteUserConfig,
  userConfig: ViteUserConfig = {},
  options: FarmProductionViteMergeOptions = {},
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
    output: userOutput,
    ...userBundlerOptions
  } = {
    ...userRollupOptions,
    ...userRolldownOptions,
  } as ViteBundlerOptions;
  const merged = mergeFarmViteConfig(farmConfig, shared);
  const farmBundlerOptions = farmConfig.build?.rollupOptions;
  const output = options.clientOutput
    ? mergeFarmClientOutputOptions(farmBundlerOptions?.output, userOutput)
    : farmBundlerOptions?.output;

  return {
    ...merged,
    build: {
      ...userBuildOptions,
      ...farmConfig.build,
      rollupOptions: {
        ...userBundlerOptions,
        ...farmBundlerOptions,
        ...(output === undefined ? {} : { output }),
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
