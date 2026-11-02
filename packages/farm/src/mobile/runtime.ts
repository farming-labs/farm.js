/**
 * What `farm config inspect --mobile` and the later `farm dev|build --mobile` call: resolve the
 * `mobile` block for an OS and write the navigator manifest. Loaded only through
 * `loadFarmMobileRuntime()`, so web builds never parse it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { loadConfig, resolveConfig, type FarmUserConfig, type ResolvedFarmConfig } from "../config";
import { getFarmSourceRoots } from "../layers";
import { getFarmRendererComponentExtensions } from "../renderer";
import { scanRoutePatterns, type PlatformRouteFiles } from "../routing/generate-route-types";
import {
  createFarmMobileContext,
  resolveFarmMobileBlock,
  resolveFarmMobileConfig,
  resolveFarmMobileServer,
  type FarmMobileBlockCache,
  type FarmMobileContext,
  type FarmMobileOS,
  type ResolvedFarmMobileConfig,
} from "./config";
import { createFarmMobileRouteManifest, type FarmMobileRouteManifest } from "./routes";
import {
  readFarmMobilePageExport,
  resolveFarmMobileScreens,
  type FarmMobilePageExport,
  type FarmMobileScreenDecision,
} from "./screens";

export {
  createFarmMobileContext,
  resolveFarmMobileBlock,
  resolveFarmMobileConfig,
  validateFarmMobileConfig,
} from "./config";
export { createFarmMobileRouteManifest, createFarmMobileRoutePattern } from "./routes";
export {
  createFarmMobileModuleId,
  readFarmMobilePageExport,
  resolveFarmMobileScreens,
} from "./screens";
export type * from "./config";
export type * from "./routes";
export type * from "./screens";

/** An expected failure with its own fix; the CLI prints it without a stack. */
export class FarmMobileError extends Error {
  override name = "FarmMobileError";
}

/** Where mobile outputs go, relative to the app root. */
export function getFarmMobileOutputDirs(distDir: string): {
  root: string;
  routes: string;
  /** The `--mobile` client build (with its server), kept apart from the web build's output. */
  www: string;
  /** Generated native projects, one per OS. */
  android: string;
  ios: string;
  /** Built apps, such as the debug APK. */
  dist: string;
} {
  const root = path.join(distDir, "output", "mobile");
  return {
    root,
    routes: path.join(root, "farm-routes.json"),
    www: path.join(root, "www"),
    android: path.join(root, "android"),
    ios: path.join(root, "ios"),
    dist: path.join(root, "dist"),
  };
}

export interface FarmMobileAppOptions {
  root?: string;
  command?: FarmMobileContext["command"];
  profile?: string;
  os?: FarmMobileOS;
  /**
   * Server origin chosen by the CLI, such as the dev server's LAN URL for `farm dev --mobile`.
   * Wins over `mobile.server`; checked by the same rules.
   */
  server?: string;
  /** farm.config as loaded; loaded from `root` when omitted. */
  userConfig?: FarmUserConfig | null;
  /** The resolved web config the build already has; resolved from `userConfig` when omitted. */
  config?: ResolvedFarmConfig;
  /** Shared across calls in one session so a function-valued block runs once per OS. */
  cache?: FarmMobileBlockCache;
}

export interface FarmMobileApp {
  context: FarmMobileContext;
  mobile: ResolvedFarmMobileConfig;
  manifest: FarmMobileRouteManifest;
  config: ResolvedFarmConfig;
  /** What each page route shows on this OS, and what decided it. */
  screens: Record<string, FarmMobileScreenDecision>;
  /** Settings a higher-precedence source overrides, unused screen files, unported routes. */
  warnings: string[];
  /** Reserved `layout.{native,ios,android}.tsx` files per app directory, app-root-relative. */
  nativeLayouts: Record<string, PlatformRouteFiles>;
  /** Absolute page file per file-based page route. */
  pageFiles: Map<string, string>;
}

const SCRIPT_PAGE = /\.(?:tsx|ts|jsx|js)$/;

/** Static `export const mobile` of every script page; pages without one are not parsed. */
async function readPageExports(
  root: string,
  pageFiles: ReadonlyMap<string, string>,
  os: FarmMobileOS,
): Promise<Map<string, FarmMobilePageExport>> {
  const exports = new Map<string, FarmMobilePageExport>();
  let parseSync: (typeof import("rolldown/utils"))["parseSync"] | undefined;
  await Promise.all(
    [...pageFiles].map(async ([route, file]) => {
      if (!SCRIPT_PAGE.test(file)) return;
      const source = await readFile(file, "utf8");
      if (!/\bmobile\b/.test(source)) return;
      parseSync ??= (await import("rolldown/utils")).parseSync;
      const parse = parseSync;
      const relative = path.relative(root, file).split(path.sep).join("/");
      const config = readFarmMobilePageExport(
        source,
        relative,
        (name, code) => parse(name, code).program as never,
        { os },
      );
      if (config) exports.set(route, { file: relative, config });
    }),
  );
  return exports;
}

/** Resolve the `mobile` block for one OS against the app's routes. Writes nothing. */
export async function resolveFarmMobileApp(
  options: FarmMobileAppOptions = {},
): Promise<FarmMobileApp> {
  const root = path.resolve(options.config?.root ?? options.root ?? process.cwd());
  const command = options.command ?? "build";
  const mode = command === "dev" ? "development" : "production";
  const userConfig =
    options.userConfig === undefined ? await loadConfig(root, undefined, mode) : options.userConfig;
  if (userConfig?.mobile === undefined) {
    throw new FarmMobileError(
      'farm.config.ts has no `mobile` entry. Add one, such as `mobile: { id: "com.example.notes", ' +
        'server: "https://notes.example.com" }`.',
    );
  }
  const context = createFarmMobileContext({
    command,
    profile: options.profile,
    os: options.os,
    root,
    mode,
  });
  const block = await resolveFarmMobileBlock(userConfig.mobile, context, options.cache);
  const config = options.config ?? (await resolveConfig({ ...userConfig, root }, mode));
  const scan = await scanRoutePatterns({
    root,
    srcDir: config.srcDir,
    sourceRoots: getFarmSourceRoots(config),
    componentExtensions: getFarmRendererComponentExtensions(config.renderer),
    platformFiles: true,
  });
  const routes = [...scan.pages].sort();
  const mobile = resolveFarmMobileConfig(block, { root, srcDir: config.srcDir, routes }, context);
  const pageExports = await readPageExports(root, scan.pageFiles, context.os);
  for (const [route, page] of pageExports) {
    if (page.config.presentation !== undefined && mobile.tabs.some((tab) => tab.path === route)) {
      throw new TypeError(
        `mobile (os: ${context.os}): ${page.file}: mobile.presentation does not apply to a tab ` +
          "route; tabs switch in place.",
      );
    }
  }
  const { screens, warnings } = resolveFarmMobileScreens({
    root,
    os: context.os,
    routes,
    mobile,
    nativePages: scan.nativePages,
    pageExports,
  });
  const nativeLayouts = Object.fromEntries(
    [...scan.nativeLayouts]
      .sort()
      .map(([route, files]) => [
        route,
        Object.fromEntries(
          Object.entries(files).map(([platform, file]) => [
            platform,
            path.relative(root, file).split(path.sep).join("/"),
          ]),
        ),
      ]),
  );
  const server =
    options.server === undefined
      ? undefined
      : resolveFarmMobileServer(options.server, context, undefined, "the server URL");
  if (!server && !mobile.server) {
    throw new FarmMobileError(
      `mobile (os: ${context.os}): server is required, such as ` +
        'server: "https://notes.example.com" (the web deployment the app loads pages from).',
    );
  }
  const i18n =
    config.i18n && typeof config.i18n === "object" && config.i18n.enabled
      ? { locales: config.i18n.locales, routing: config.i18n.routing }
      : null;
  const manifest = createFarmMobileRouteManifest(mobile, {
    routes,
    server,
    basePath: config.basePath,
    i18n,
    screens,
  });
  return {
    context,
    mobile,
    manifest,
    config,
    screens,
    warnings,
    nativeLayouts,
    pageFiles: scan.pageFiles,
  };
}

/** Resolve the block and write `.farm/output/mobile/farm-routes.json`. */
export async function generateFarmMobileRoutes(
  options: FarmMobileAppOptions = {},
): Promise<FarmMobileApp & { file: string }> {
  const app = await resolveFarmMobileApp(options);
  const file = path.resolve(app.config.root, getFarmMobileOutputDirs(app.config.distDir).routes);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(app.manifest, null, 2)}\n`);
  return { ...app, file };
}
