/**
 * What `farm config inspect --mobile` and the later `farm dev|build --mobile` call: resolve the
 * `mobile` block for an OS and write the navigator manifest. Loaded only through
 * `loadFarmMobileRuntime()`, so web builds never parse it.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
import type { FarmMobileAnalyzerStats, FarmMobileBlocker } from "./analyzer";
import type { FarmMobilePort } from "./port";
import {
  farmComponentModuleScripts,
  keepFarmComponentRanges,
  readFarmComponentBlocks,
} from "./component-blocks";
import {
  readFarmMobileWebModules,
  scanFarmMobileAppModules,
  type FarmMobileAppModules,
} from "./modules";
import {
  createFarmMobileNativeReport,
  formatFarmMobileNativeReport,
  type FarmMobileNativeReport,
} from "./report";
import {
  createFarmMobileRouteManifest,
  type FarmMobileRouteManifest,
  type FarmMobileShellManifest,
} from "./routes";
import {
  createFarmMobileModuleId,
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
  FARM_SHELL_PARAM_SEGMENT,
  FARM_SHELL_RENDER_HEADER,
  FARM_SHELL_ROUTE_HEADER,
  createFarmMobilePageShell,
  createFarmMobileShellRenderPath,
  getFarmMobilePageShellFile,
  renderFarmMobilePageShells,
} from "./page-shells";
export type * from "./page-shells";
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
  FarmMobileTier,
  FarmUiNode,
} from "./analyzer";
export { formatFarmMobileNativeReport } from "./report";
export {
  readFarmMobileClientManifest,
  type FarmMobileClientManifest,
} from "../nitro/mobile-client";

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
  /** Generated React Native ports of portable pages. */
  ports: string;
  analyzerCache: string;
  /** The production build's client output, which holds the mobile client a shell bundles. */
  client: string;
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
    ports: path.join(root, "ports"),
    analyzerCache: path.join(distDir, "cache", "mobile", "analyzer.json"),
    client: path.join(distDir, "client"),
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
   * `farm build --mobile` passes), `"always"` for an explicit `--report`. Not in dev, except
   * that a page with `export const mobile = { native: true }` is always checked.
   */
  analyze?: boolean | "always";
  /** `farm build --mobile` with `mobile.shells`: the page shells it rendered, for the manifest. */
  shells?: FarmMobileShellManifest;
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
  /** The React Native port of each route Farm ported, written by `generateFarmMobileRoutes`. */
  ports: Record<string, FarmMobilePort>;
  /** The analyzer's report, when it ran. */
  report?: FarmMobileNativeReport;
  analyzerStats?: FarmMobileAnalyzerStats;
  /** The app's own native modules in `src/native/`, when it has any. */
  appModules?: FarmMobileAppModules;
}

const SCRIPT_PAGE = /\.(?:tsx|ts|jsx|js)$/;
const COMPONENT_PAGE = /\.(?:vue|svelte)$/;

/** `.js` pages may contain JSX, as in the client build. */
function describe(blocker: FarmMobileBlocker): string {
  return `${blocker.file ? `${blocker.file}:${blocker.line}:${blocker.column} ` : ""}${blocker.message}`;
}

function scriptLang(file: string): "ts" | "tsx" | "jsx" {
  return file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "ts" : "jsx";
}

/**
 * Static `export const mobile` of every script page, and of every `.vue` or `.svelte` page's
 * module script; pages without one are not parsed.
 */
async function readPageExports(
  root: string,
  pageFiles: ReadonlyMap<string, string>,
  os: FarmMobileOS,
): Promise<Map<string, FarmMobilePageExport>> {
  const exports = new Map<string, FarmMobilePageExport>();
  let parseSync: (typeof import("rolldown/utils"))["parseSync"] | undefined;
  await Promise.all(
    [...pageFiles].map(async ([route, file]) => {
      const component = COMPONENT_PAGE.test(file);
      if (!SCRIPT_PAGE.test(file) && !component) return;
      let source = await readFile(file, "utf8");
      if (!/\bmobile\b/.test(source)) return;
      if (component) {
        // Only the script that holds module exports; positions stay those of the file.
        const blocks = readFarmComponentBlocks(file, source);
        source = keepFarmComponentRanges(source, farmComponentModuleScripts(blocks));
      }
      parseSync ??= (await import("rolldown/utils")).parseSync;
      const parse = parseSync;
      const relative = path.relative(root, file).split(path.sep).join("/");
      const config = readFarmMobilePageExport(
        source,
        relative,
        (name, code) =>
          parse(name, code, { lang: component ? "ts" : scriptLang(name) }).program as never,
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
  const routes = [...scan.pages, ...scan.nativeOnlyPages].sort();
  let appModules: FarmMobileAppModules | undefined;
  try {
    appModules = scanFarmMobileAppModules({ root, srcDir: config.srcDir });
  } catch (error) {
    throw Object.assign(
      new FarmMobileError(`mobile (os: ${context.os}): ${(error as Error).message}`),
      { cause: error },
    );
  }
  const mobile = resolveFarmMobileConfig(
    block,
    {
      root,
      srcDir: config.srcDir,
      routes,
      appModules: appModules?.specs.map((spec) => spec.name),
    },
    context,
  );
  if (appModules && Object.values(mobile.modules).some((module) => module.web)) {
    try {
      appModules = readFarmMobileWebModules(appModules, mobile.modules, { root });
    } catch (error) {
      throw Object.assign(
        new FarmMobileError(`mobile (os: ${context.os}): ${(error as Error).message}`),
        { cause: error },
      );
    }
  }
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
    nativeOnlyRoutes: scan.nativeOnlyPages,
    pageExports,
  };
  let { screens, warnings } = resolveFarmMobileScreens(screenOptions);
  let report: FarmMobileNativeReport | undefined;
  let analyzerStats: FarmMobileAnalyzerStats | undefined;
  const ports = new Map<string, FarmMobilePort>();
  const portProblems = new Map<string, string[]>();
  // A page that requires a native screen is checked on every run, dev included.
  const asserted = [...pageExports.values()].some((page) => page.config.native === true);
  const analyze =
    options.analyze === "always" ||
    asserted ||
    (options.analyze === true && mobile.native.auto !== "off");
  if (analyze) {
    // Only routes nothing else decided, and config routes that ask for a port.
    const candidates = routes.filter((route) => {
      const decision = screens[route]!;
      return decision.source === "default" || decision.requested !== undefined;
    });
    // Ports need every stylesheet the app bundles, so they read every route's graph. Both shells
    // host React Native screens, so a port runs on either OS.
    const portable =
      mobile.native.engine !== "platform" &&
      (mobile.native.auto === "on" ||
        candidates.some((route) => screens[route]!.requested === "native"));
    const { analyzeFarmMobileRoutes } = await import("./analyzer");
    const analyzed = await analyzeFarmMobileRoutes({
      root,
      srcDir: config.srcDir,
      routes: portable ? routes : candidates,
      pageFiles: scan.pageFiles,
      nativeOnlyRoutes: scan.nativeOnlyPages,
      serverComponents:
        resolveFarmServerComponentsMode(config.experimental?.serverComponents) !== undefined,
      cacheFile: path.resolve(root, getFarmMobileOutputDirs(config.distDir).analyzerCache),
    });
    analyzerStats = analyzed.stats;
    const result = {
      ...analyzed,
      routes: Object.fromEntries(
        candidates.flatMap((route) =>
          analyzed.routes[route] ? [[route, analyzed.routes[route]!] as const] : [],
        ),
      ),
    };
    // React Native ports of portable pages: the routes `auto: "on"` picks and config routes that
    // ask for a native screen, unless the page renders on the native tier without JavaScript.
    if (portable) {
      const { emitFarmMobilePort } = await import("./port");
      const portsDir = path.resolve(root, getFarmMobileOutputDirs(config.distDir).ports);
      for (const analysis of Object.values(result.routes)) {
        const graph = result.graphs[analysis.route];
        const wanted =
          (mobile.native.auto === "on" && analysis.decision === "port") ||
          screens[analysis.route]!.requested === "native";
        if (!graph || !wanted || analysis.tier === "native") continue;
        const emitted = await emitFarmMobilePort({
          root,
          graph,
          portsDir,
          module: createFarmMobileModuleId(analysis.route),
          stylesheets: result.stylesheets,
          unreadStylesheets: result.unreadStylesheets,
        });
        if ("problems" in emitted) portProblems.set(analysis.route, emitted.problems);
        else ports.set(analysis.route, emitted.port);
      }
    }
    ({ screens, warnings } = resolveFarmMobileScreens({
      ...screenOptions,
      portFiles: new Map(
        [...ports].map(([route, port]) => [
          route,
          path.resolve(root, getFarmMobileOutputDirs(config.distDir).ports, port.entry),
        ]),
      ),
      portProblems,
      analyzerPorts: new Set(
        Object.values(result.routes)
          .filter((route) => route.decision === "port")
          .map((route) => route.route),
      ),
      analyzerBlockers: new Map(
        Object.values(result.routes).map((route) => [route.route, route.blockers.map(describe)]),
      ),
      analyzerTiers: new Map(
        Object.values(result.routes).map((route) => [
          route.route,
          { tier: route.tier, nativeBlockers: route.nativeBlockers.map(describe) },
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
  // Options the config and file conventions accept but nothing acts on yet: say so, so an app
  // does not rely on them.
  const reserved: string[] = [];
  if (mobile.native.islands.length > 0) {
    reserved.push(
      `mobile.native.islands is reserved: no native islands render yet, so these stay web components: ${mobile.native.islands.join(", ")}.`,
    );
  }
  if (Object.keys(mobile.native.budgets).length > 0) {
    reserved.push(
      "mobile.native.budgets is reserved: nothing measures app size, screen open time, or dropped frames yet.",
    );
  }
  for (const page of pageExports.values()) {
    if (page.config.prefetch === "intent") {
      reserved.push(
        `${page.file}: mobile.prefetch "intent" has no effect yet: the shell does not prefetch a route's data.`,
      );
    }
  }
  for (const files of scan.nativeLayouts.values()) {
    for (const file of Object.values(files)) {
      reserved.push(
        `${path.relative(root, file).split(path.sep).join("/")}: layout.native files are reserved: nothing renders them yet, though the analyzer reads one in place of that folder's layout.`,
      );
    }
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
    ...(options.shells ? { shells: options.shells } : {}),
  });
  return {
    context,
    mobile,
    manifest,
    config,
    screens,
    warnings: [...reserved, ...warnings],
    nativeLayouts,
    pageFiles: scan.pageFiles,
    ports: Object.fromEntries(ports),
    ...(report ? { report, analyzerStats } : {}),
    ...(appModules ? { appModules } : {}),
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
  // Farm owns the ports directory: a route that is no longer ported loses its files.
  const portsDir = path.resolve(app.config.root, dirs.ports);
  await rm(portsDir, { recursive: true, force: true });
  for (const port of Object.values(app.ports)) {
    for (const [relative, source] of Object.entries(port.files)) {
      const target = path.join(portsDir, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source);
    }
  }
  if (!app.report) return { ...app, file };
  const reportFile = path.resolve(app.config.root, dirs.report);
  await writeFile(reportFile, `${JSON.stringify(app.report, null, 2)}\n`);
  const table = formatFarmMobileNativeReport(app.report, {
    stats: app.analyzerStats,
    file: path.relative(app.config.root, reportFile).split(path.sep).join("/"),
  });
  return { ...app, file, reportFile, table };
}
