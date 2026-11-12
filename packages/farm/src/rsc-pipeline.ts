/**
 * React Server Components from farm.config: with `experimental.serverComponents: { mode: "rsc" }`, `farm dev`
 * and `farm build` run the RSC pipeline of `@farm.js/plugin/rsc` on the official
 * `@vitejs/plugin-rsc`, configured from the Farm config, instead of Farm's own renderer. Pages and
 * layouts are server components by default and `"use client"` marks client components.
 *
 * Loaded only when the flag is on, so ordinary apps never load the RSC packages.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { InlineConfig, ViteDevServer } from "vite";
import { createFarmDevLoopbackPlugin } from "./server/dev-loopback";
import { loadTailwindVitePlugin } from "./build/tailwind";
import { generateFarmClientPluginEntryCode } from "./client-plugin-build";
import { hasFarmServerRuntimePlugins } from "./plugin-server-runtime";
import type { FarmPlugin } from "./plugin";
import { resolveFarmPlatform } from "./desktop/config";
import { farmDesktopDevGuardPlugin } from "./desktop/dev-guard-plugin";
import { loadFarmReactPlugin } from "./react-refresh";
import { resolveDeployOutputPath } from "./config";
import {
  FARM_RSC_INSTALL_HINT,
  findFarmAppPackageDir,
  formatFarmRscBlockingMessage,
  inspectFarmServerComponents,
  resolveFarmRscCheckConfig,
} from "./server-components-status";

export {
  FARM_RSC_PACKAGES,
  farmAppUsesRscPipeline,
  farmConfigUsesServerComponents,
  inspectFarmServerComponents,
  resolveFarmRscCheckConfig,
} from "./server-components-status";

type FarmConfigInput = Record<string, any>;

/** The entry files the RSC pipeline writes and hands to @vitejs/plugin-rsc. */
const FARM_RSC_ENTRIES = {
  rsc: "./.farm/rsc-entries/entry.rsc.tsx",
  ssr: "./.farm/rsc-entries/entry.ssr.tsx",
  client: "./.farm/rsc-entries/entry.browser.tsx",
};

/** Farm config keys `defineConfig` from `@farm.js/plugin/rsc` takes as they are. */
const FARM_RSC_CONFIG_KEYS = [
  "srcDir",
  "extends",
  "basePath",
  "api",
  "server",
  "middleware",
  "images",
  "serverActions",
  "deploymentId",
  "generateBuildId",
  "md",
  "agent",
  "mcp",
] as const;

/** Read by the RSC pipeline's own config hook, which `defineConfig` does not copy. */
const FARM_RSC_PASSTHROUGH_KEYS = ["i18n", "cache"] as const;

function pickImportTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return undefined;
  for (const condition of ["import", "node", "default"]) {
    const target = pickImportTarget((entry as Record<string, unknown>)[condition]);
    if (target) return target;
  }
  return undefined;
}

/**
 * Import `packageName` (and an export subpath) as the app resolves it. Some of these packages
 * export only an `import` condition, which `require.resolve` cannot see.
 */
async function importFromApp(
  root: string,
  packageName: string,
  subpath = ".",
): Promise<Record<string, any> | undefined> {
  const packageDir = findFarmAppPackageDir(root, packageName);
  if (!packageDir) return undefined;
  const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
    exports?: unknown;
    module?: string;
    main?: string;
  };
  const exportsMap = manifest.exports;
  const entry =
    exportsMap &&
    typeof exportsMap === "object" &&
    !Array.isArray(exportsMap) &&
    subpath in exportsMap
      ? (exportsMap as Record<string, unknown>)[subpath]
      : subpath === "."
        ? (exportsMap ?? manifest.module ?? manifest.main ?? "index.js")
        : undefined;
  const target = pickImportTarget(entry);
  if (!target) return undefined;
  return import(pathToFileURL(path.join(packageDir, target)).href);
}

function hasPluginNamed(plugins: unknown, prefix: string): boolean {
  if (Array.isArray(plugins)) return plugins.some((plugin) => hasPluginNamed(plugin, prefix));
  const name = (plugins as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.startsWith(prefix);
}

/**
 * The Vite config for an app with `experimental.serverComponents`: the Farm config mapped onto
 * `defineConfig` from `@farm.js/plugin/rsc`, with `@vitejs/plugin-rsc`, `@vitejs/plugin-react`
 * when installed (Fast Refresh), and the Nitro build for the app's deploy preset. The app's `vite`
 * options and plugins merge in as they do for other Farm apps.
 */
export async function createFarmRscViteConfig(
  userConfig: FarmConfigInput,
  options: {
    root: string;
    command: "serve" | "build";
    port?: number;
    preset?: string;
    /** The deploy output directory, where `farm start` and the platform look for the build. */
    outputDir?: string;
  },
): Promise<InlineConfig> {
  const root = path.resolve(options.root);
  const renderer = userConfig.renderer;
  if (renderer && typeof renderer === "object" && renderer.name && renderer.name !== "react") {
    throw new Error(
      `[Farm.js] experimental.serverComponents needs the React renderer; this app uses "${renderer.name}".`,
    );
  }
  const [pluginRsc, viteRsc, viteReact] = await Promise.all([
    importFromApp(root, "@farm.js/plugin", "./rsc"),
    importFromApp(root, "@vitejs/plugin-rsc"),
    importFromApp(root, "@vitejs/plugin-react"),
  ]);
  if (!pluginRsc || !viteRsc || !findFarmAppPackageDir(root, "react-server-dom-webpack")) {
    throw new Error(
      `[Farm.js] experimental.serverComponents runs on @farm.js/plugin and the official @vitejs/plugin-rsc. Install them: ${FARM_RSC_INSTALL_HINT}`,
    );
  }

  // The app's plugins (a layer's come first) get their `configure` hooks, as in Farm's other
  // pipelines, so what those add, such as Vite plugins or client settings, reaches this one too.
  const layered = await resolveFarmRscCheckConfig(
    userConfig,
    root,
    options.command === "build" ? "production" : "development",
  );
  const config = await configureFarmRscPlugins(
    {
      ...userConfig,
      vite: typeof userConfig.vite === "function" ? userConfig.vite({}) : userConfig.vite,
      plugins: layered?.plugins ?? [],
      publicRuntimeConfig: layered?.publicRuntimeConfig ?? {},
    },
    options.command,
  );
  const blockingKeys = inspectFarmServerComponents(config, root).blockingKeys;
  if (blockingKeys.length > 0) {
    throw new Error(`[Farm.js] ${formatFarmRscBlockingMessage(blockingKeys)}`);
  }

  const { plugins: vitePlugins = [], ...viteOptions } = (config.vite ?? {}) as Record<string, any>;
  const rscConfig: Record<string, unknown> = {};
  for (const key of FARM_RSC_CONFIG_KEYS) {
    if (config[key] !== undefined) rscConfig[key] = config[key];
  }
  // Fast Refresh: the app's plugin-react, else core's in development, as for other Farm apps.
  // Without it the RSC client bootstrap's /@react-refresh import fails and nothing hydrates.
  const createReactPlugin = hasPluginNamed(vitePlugins, "vite:react")
    ? undefined
    : (viteReact?.default ??
      (options.command === "serve" ? (await loadFarmReactPlugin()).default : undefined));
  // Built-in Tailwind, as in other Farm apps, unless the app adds @tailwindcss/vite itself.
  const tailwind = hasPluginNamed(vitePlugins, "@tailwindcss/vite")
    ? undefined
    : await loadTailwindVitePlugin();
  // An app with a `mobile` block (RFC 0004): a build adds the mobile entry shell documents load,
  // and `farm dev --mobile` hands navigations to the shell from the browser entry itself. Desktop
  // builds and web dev servers add nothing.
  const platform = resolveFarmPlatform();
  const mobileClient =
    config.mobile === undefined || platform === "desktop"
      ? undefined
      : options.command === "build"
        ? "entry"
        : platform === "mobile"
          ? "inline"
          : undefined;
  // The browser half of the app's plugins and its src/client.ts, which the browser entry starts
  // as Farm's other entries do. Of the other plugin hooks, RSC runs only `configure` yet.
  const clientPluginEntry = generateFarmClientPluginEntryCode(
    config.plugins,
    root,
    typeof config.srcDir === "string" ? config.srcDir : "src",
    config.publicRuntimeConfig ?? {},
    // The RSC entry hands navigations to a mobile shell itself.
    "web",
  );
  const serverPlugins =
    options.command === "build"
      ? await resolveFarmRscServerPlugins(userConfig, config, root)
      : undefined;
  const farmConfig = pluginRsc.defineConfig({
    ...rscConfig,
    ...(mobileClient ? { mobileClient } : {}),
    clientPlugins: {
      empty: clientPluginEntry.empty,
      imports: clientPluginEntry.imports,
      registrations: clientPluginEntry.registrations,
    },
    // Plugins with server hooks load in the production server, as in Farm's other servers, so
    // factories such as `bot()` run there. Dev loaded them with the config already.
    ...(serverPlugins ? { serverPlugins } : {}),
    experimental: { ...config.experimental, serverComponents: { mode: "rsc" } },
    port: options.port ?? config.server?.port,
    plugins: [
      ...(options.command === "serve" && platform === "desktop"
        ? [
            farmDesktopDevGuardPlugin(
              typeof config.basePath === "string" ? config.basePath : undefined,
            ),
          ]
        : []),
      ...(tailwind ? [tailwind] : []),
      ...vitePlugins,
      viteRsc.default({ serverHandler: false, entries: FARM_RSC_ENTRIES }),
      ...(typeof createReactPlugin === "function" ? [createReactPlugin()] : []),
      pluginRsc.nitro({
        server: { environmentName: "rsc" },
        config: {
          preset: options.preset,
          outputDir: options.outputDir && resolveDeployOutputPath(root, options.outputDir),
        },
      }),
    ],
  });
  for (const key of FARM_RSC_PASSTHROUGH_KEYS) {
    if (config[key] !== undefined) farmConfig[key] = config[key];
  }

  const { mergeConfig } = await import("vite");
  return {
    ...mergeConfig(farmConfig, viteOptions),
    root,
    // The Farm config is the app's config; a stray vite.config must not add a second pipeline.
    configFile: false,
    mode: options.command === "build" ? "production" : "development",
  };
}

/**
 * Where the plugins with server hooks sit in each config file's `plugins`, by absolute path, so
 * the production server loads those and no others. Positions come from the evaluated config, whose
 * `plugins` array matches the one the file declares. A plugin `configure` removed stays out.
 */
async function resolveFarmRscServerPlugins(
  userConfig: FarmConfigInput,
  config: FarmConfigInput,
  root: string,
): Promise<Record<string, { indexes: number[]; count: number }> | undefined> {
  const kept: FarmPlugin[] = config.plugins ?? [];
  const names = new Set(
    kept.filter((plugin) => hasFarmServerRuntimePlugins([plugin])).map((plugin) => plugin.name),
  );
  if (names.size === 0) return undefined;
  const loads = (plugin: unknown) => {
    const candidate = plugin as FarmPlugin | null | undefined;
    return !!candidate && names.has(candidate.name) && hasFarmServerRuntimePlugins([candidate]);
  };

  const { findFarmConfigFile, loadFarmConfigFile, resolveFarmLayers } = await import("./layers");
  const files: Array<[string, unknown]> = [];
  if (userConfig.extends) {
    const { layers } = await resolveFarmLayers(userConfig, { root, mode: "production" });
    for (const layer of layers) {
      if (!layer.configFile) continue;
      const layerConfig = await loadFarmConfigFile<FarmConfigInput>(layer.configFile, {
        root: layer.root,
        cacheRoot: root,
      });
      files.push([layer.configFile, layerConfig.plugins]);
    }
  }
  const configFile = findFarmConfigFile(root);
  if (configFile) files.push([configFile, userConfig.plugins]);

  const selections: Record<string, { indexes: number[]; count: number }> = {};
  for (const [file, plugins] of files) {
    const entries: unknown[] = Array.isArray(plugins) ? plugins : [plugins];
    const indexes = entries.flatMap((entry, index) =>
      [entry].flat(Infinity).some(loads) ? [index] : [],
    );
    if (indexes.length > 0) selections[path.resolve(file)] = { indexes, count: entries.length };
  }
  return Object.keys(selections).length > 0 ? selections : undefined;
}

/** Run the plugins' `configure` hooks the way `farm build` and Farm's dev server do. */
async function configureFarmRscPlugins(
  config: FarmConfigInput,
  command: "serve" | "build",
): Promise<FarmConfigInput> {
  if (config.plugins.length === 0) return config;
  const { PluginManager } = await import("./plugin");
  const manager = new PluginManager({
    config: config as never,
    isDev: command === "serve",
    isProd: command === "build",
  });
  manager.addPlugins(config.plugins);
  return (await manager.runHookSerial("config", config)) as FarmConfigInput;
}

/** A Vite dev server for an app with `experimental.serverComponents`, not yet listening. */
export async function createFarmRscDevServer(
  userConfig: FarmConfigInput,
  options: { root: string; port?: number; host?: string | boolean },
): Promise<ViteDevServer> {
  const { createServer } = await import("vite");
  const { host, ...configOptions } = options;
  const config = await createFarmRscViteConfig(userConfig, { ...configOptions, command: "serve" });
  return createServer({
    ...config,
    plugins: [...(config.plugins ?? []), createFarmDevLoopbackPlugin()],
    ...(host === undefined ? {} : { server: { ...config.server, host } }),
  });
}

/** `farm build` for an app with `experimental.serverComponents`. */
export async function buildFarmRsc(
  userConfig: FarmConfigInput,
  options: { root: string; preset?: string; outputDir?: string },
): Promise<void> {
  const { createBuilder } = await import("vite");
  const builder = await createBuilder(
    await createFarmRscViteConfig(userConfig, { ...options, command: "build" }),
  );
  await builder.buildApp();
}
