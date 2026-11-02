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
import { resolveFarmServerComponentsMode } from "../server-components-mode";
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
import type { FarmMobileAnalyzerStats } from "./analyzer";
import {
  createFarmMobileNativeReport,
  formatFarmMobileNativeReport,
  type FarmMobileNativeReport,
} from "./report";
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
export type * from "./report";
export type {
  FarmMobileAnalyzerStats,
  FarmMobileBlocker,
  FarmMobileBlockerRule,
  FarmMobileRouteAnalysis,
  FarmUiNode,
} from "./analyzer";
export { formatFarmMobileNativeReport } from "./report";

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
  report: string;
  analyzerCache: string;
} {
  const root = path.join(distDir, "output", "mobile");
  return {
    root,
    routes: path.join(root, "farm-routes.json"),
    www: path.join(root, "www"),
    android: path.join(root, "android"),
    ios: path.join(root, "ios"),
    dist: path.join(root, "dist"),
    report: path.join(root, "native-report.json"),
    analyzerCache: path.join(distDir, "cache", "mobile", "analyzer.json"),
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
  /**
   * Run the build-time analyzer: `true` when `mobile.native.auto` is not `"off"` (what
   * `farm build --mobile` passes), `"always"` for an explicit `--report`. Never in dev.
   */
  analyze?: boolean | "always";
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
  /** The analyzer's report, when it ran. */
  report?: FarmMobileNativeReport;
  analyzerStats?: FarmMobileAnalyzerStats;
}

const SCRIPT_PAGE = /\.(?:tsx|ts|jsx|js)$/;

/** `.js` pages may contain JSX, as in the client build. */
function scriptLang(file: string): "ts" | "tsx" | "jsx" {
  return file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "ts" : "jsx";
}

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
        (name, code) => parse(name, code, { lang: scriptLang(name) }).program as never,
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
  const screenOptions = {
    root,
    os: context.os,
    routes,
    mobile,
    nativePages: scan.nativePages,
    pageExports,
  };
  let { screens, warnings } = resolveFarmMobileScreens(screenOptions);
  let report: FarmMobileNativeReport | undefined;
  let analyzerStats: FarmMobileAnalyzerStats | undefined;
  const analyze =
    options.analyze === "always" || (options.analyze === true && mobile.native.auto !== "off");
  if (analyze) {
    // Only routes nothing else decided, and config routes that ask for a port.
    const candidates = routes.filter((route) => {
      const decision = screens[route]!;
      return decision.source === "default" || decision.requested !== undefined;
    });
    const { analyzeFarmMobileRoutes } = await import("./analyzer");
    const result = await analyzeFarmMobileRoutes({
      root,
      srcDir: config.srcDir,
      routes: candidates,
      pageFiles: scan.pageFiles,
      serverComponents:
        resolveFarmServerComponentsMode(config.experimental?.serverComponents) !== undefined,
      cacheFile: path.resolve(root, getFarmMobileOutputDirs(config.distDir).analyzerCache),
    });
    analyzerStats = result.stats;
    ({ screens, warnings } = resolveFarmMobileScreens({
      ...screenOptions,
      analyzerPorts: new Set(
        Object.values(result.routes)
          .filter((route) => route.decision === "port")
          .map((route) => route.route),
      ),
      analyzerBlockers: new Map(
        Object.values(result.routes).map((route) => [
          route.route,
          route.blockers.map(
            (blocker) =>
              `${blocker.file ? `${blocker.file}:${blocker.line}:${blocker.column} ` : ""}${blocker.message}`,
          ),
        ]),
      ),
    }));
    report = createFarmMobileNativeReport({
      os: context.os,
      engine: mobile.native.engine,
      auto: mobile.native.auto,
      routes,
      screens,
      analysis: result.routes,
    });
  }
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
    ...(report ? { report, analyzerStats } : {}),
  };
}

/**
 * Resolve the block and write `.farm/output/mobile/farm-routes.json`, plus
 * `native-report.json` when the analyzer ran (`analyze`). `table` is the report for a terminal.
 */
export async function generateFarmMobileRoutes(
  options: FarmMobileAppOptions = {},
): Promise<FarmMobileApp & { file: string; reportFile?: string; table?: string }> {
  const app = await resolveFarmMobileApp(options);
  const dirs = getFarmMobileOutputDirs(app.config.distDir);
  const file = path.resolve(app.config.root, dirs.routes);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(app.manifest, null, 2)}\n`);
  if (!app.report) return { ...app, file };
  const reportFile = path.resolve(app.config.root, dirs.report);
  await writeFile(reportFile, `${JSON.stringify(app.report, null, 2)}\n`);
  const table = formatFarmMobileNativeReport(app.report, {
    stats: app.analyzerStats,
    file: path.relative(app.config.root, reportFile).split(path.sep).join("/"),
  });
  return { ...app, file, reportFile, table };
}
