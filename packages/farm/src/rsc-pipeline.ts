/**
 * React Server Components from farm.config: with `experimental.serverComponents: true`, `farm dev`
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
import { loadTailwindVitePlugin } from "./build/tailwind";
import { resolveDeployOutputPath } from "./config";
import { logger } from "./utils";

type FarmConfigInput = Record<string, any>;

export const FARM_RSC_PACKAGES = [
  "@farm.js/plugin",
  "@vitejs/plugin-rsc",
  "react-server-dom-webpack",
];

const FARM_RSC_INSTALL_HINT = `pnpm add ${FARM_RSC_PACKAGES.join(" ")}`;

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

/** Farm features the RSC pipeline does not run yet. */
const FARM_RSC_UNSUPPORTED_KEYS = [
  "auth",
  "integrations",
  "plugins",
  "storage",
  "schema",
  "cron",
  "workflows",
  "docs",
  "theme",
  "routeRules",
  "context",
  "redirects",
  "rewrites",
  "headers",
  "observability",
] as const;

/** Whether the app opted in to React Server Components in farm.config. */
export function farmConfigUsesServerComponents(
  config: FarmConfigInput | null | undefined,
): boolean {
  return config?.experimental?.serverComponents === true;
}

let warnedMissingRscPackages = false;

/**
 * Whether an app with `experimental.serverComponents` runs on the RSC pipeline. Apps set the flag
 * before it loaded the pipeline (it only switched off isolated hydration), so an app without the
 * RSC packages keeps building as before and is told once how to turn React Server Components on.
 */
export function farmAppUsesRscPipeline(
  config: FarmConfigInput | null | undefined,
  root: string,
): boolean {
  if (!farmConfigUsesServerComponents(config)) return false;
  const missing = FARM_RSC_PACKAGES.filter((name) => !findPackageDir(root, name));
  if (missing.length === 0) return true;
  if (!warnedMissingRscPackages) {
    warnedMissingRscPackages = true;
    logger.warn(
      `[Farm.js] experimental.serverComponents is set, but ${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } not installed, so the app runs without React Server Components. Install them to turn RSC on: ${FARM_RSC_INSTALL_HINT}, or remove the flag.`,
    );
  }
  return false;
}

function findPackageDir(root: string, packageName: string): string | undefined {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", packageName);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    if (path.dirname(dir) === dir) return undefined;
  }
}

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
  const packageDir = findPackageDir(root, packageName);
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

function warnUnsupportedKeys(userConfig: FarmConfigInput): void {
  const ignored = FARM_RSC_UNSUPPORTED_KEYS.filter((key) => {
    const value = userConfig[key];
    if (value === undefined || value === false) return false;
    if (Array.isArray(value)) return value.length > 0;
    return typeof value !== "object" || value === null || Object.keys(value).length > 0;
  });
  if (ignored.length === 0) return;
  logger.warn(
    `[Farm.js] experimental.serverComponents runs on the RSC pipeline, which does not support ${ignored
      .map((key) => `\`${key}\``)
      .join(", ")} yet. ${ignored.length === 1 ? "It is" : "They are"} ignored.`,
  );
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
  if (!pluginRsc || !viteRsc || !findPackageDir(root, "react-server-dom-webpack")) {
    throw new Error(
      `[Farm.js] experimental.serverComponents runs on @farm.js/plugin and the official @vitejs/plugin-rsc. Install them: ${FARM_RSC_INSTALL_HINT}`,
    );
  }
  warnUnsupportedKeys(userConfig);

  const { plugins: vitePlugins = [], ...viteOptions } = (userConfig.vite ?? {}) as Record<
    string,
    any
  >;
  const rscConfig: Record<string, unknown> = {};
  for (const key of FARM_RSC_CONFIG_KEYS) {
    if (userConfig[key] !== undefined) rscConfig[key] = userConfig[key];
  }
  const createReactPlugin = viteReact?.default;
  // Built-in Tailwind, as in other Farm apps, unless the app adds @tailwindcss/vite itself.
  const tailwind = hasPluginNamed(vitePlugins, "@tailwindcss/vite")
    ? undefined
    : await loadTailwindVitePlugin();
  const farmConfig = pluginRsc.defineConfig({
    ...rscConfig,
    experimental: { ...userConfig.experimental, serverComponents: true },
    port: options.port ?? userConfig.server?.port,
    plugins: [
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
    if (userConfig[key] !== undefined) farmConfig[key] = userConfig[key];
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

/** A Vite dev server for an app with `experimental.serverComponents`, not yet listening. */
export async function createFarmRscDevServer(
  userConfig: FarmConfigInput,
  options: { root: string; port?: number },
): Promise<ViteDevServer> {
  const { createServer } = await import("vite");
  return createServer(await createFarmRscViteConfig(userConfig, { ...options, command: "serve" }));
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
