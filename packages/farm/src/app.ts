import type { FarmConfig } from "./types";
import type { FarmDocsResolvedConfig } from "./docs/types";
import type { FarmMarkdownResolvedConfig } from "./markdown";
import { resolveMdxConfig, type FarmMdxResolvedConfig } from "./app-markdown-config";
import { resolveMarkdownConfig } from "./markdown";
import { resolveWorkflowsConfig, type FarmWorkflowsResolvedConfig } from "./workflows";
import { resolveCronConfig, type FarmCronResolvedConfig } from "./cron";
import { resolveAppPath, fileExists, logger } from "./utils";
import { initStorage } from "./storage";
import { configureFarmObservability } from "./observability";
import { normalizeRouteRules } from "./route-rules";
import { resolveServerActionsConfig } from "./server-action-security";
import { resolveFarmServerConfig } from "./server-http";
import { resolveFarmImageConfig, type ResolvedFarmImageConfig } from "./image-config";
import { getFarmAppDirectories, getFarmSourceRoots } from "./layers";
import { RouteManager } from "./routing/route-manager";
import { ServerRenderer } from "./server/renderer";
import { findProgrammaticRouteFiles } from "./routes.server";
import path from "path";
import type { ViteDevServer } from "vite";
import { resolveFarmDevtoolsConfig, type ResolvedFarmDevtoolsConfig } from "./devtools-config";
import { resolveFarmI18nConfig } from "./i18n/config";
import {
  createFarmI18nRuntime,
  _setDefaultFarmI18nRuntime,
  type FarmI18nRuntime,
} from "./i18n/server";
import type { ResolvedFarmI18nConfig } from "./i18n/types";
import { configureFarmCache } from "./cache";
import { resolveFarmAuthConfig, type ResolvedFarmAuthConfig } from "./auth-config";
import { resolveFarmPerformanceConfig, type ResolvedFarmPerformanceConfig } from "./preload";
import { resolveFarmSecurityConfig, type ResolvedFarmSecurityConfig } from "./security";
import { resolveFarmThemeConfig } from "./theme/config";
import { _setDefaultFarmThemeConfig } from "./theme/server";
import type { ResolvedFarmThemeConfig } from "./theme/types";
import { getFarmRendererComponentExtensions, resolveFarmRenderer } from "./renderer";
import type { FarmRenderer } from "./renderer";
import { normalizeFarmAPIConfig, type ResolvedFarmAPIConfig } from "./api/config";

type NormalizedFarmConfig = Omit<
  Required<FarmConfig>,
  "api" | "devtools" | "images" | "i18n" | "performance" | "security" | "theme"
> & {
  api: ResolvedFarmAPIConfig;
  docs: FarmDocsResolvedConfig;
  md: FarmMarkdownResolvedConfig;
  mdx: FarmMdxResolvedConfig;
  cron: FarmCronResolvedConfig;
  workflows: FarmWorkflowsResolvedConfig;
  devtools: ResolvedFarmDevtoolsConfig;
  images: ResolvedFarmImageConfig;
  i18n: ResolvedFarmI18nConfig;
  auth: ResolvedFarmAuthConfig;
  performance: ResolvedFarmPerformanceConfig;
  security: ResolvedFarmSecurityConfig;
  theme: ResolvedFarmThemeConfig;
  renderer: FarmRenderer;
};

const defaultDocsConfig: FarmDocsResolvedConfig = {
  enabled: false,
  entry: "/docs",
  config: { entry: "docs", docsPath: "/docs" },
};

function isResolvedDocsConfig(value: FarmConfig["docs"]): value is FarmDocsResolvedConfig {
  return (
    !!value &&
    typeof value === "object" &&
    "enabled" in value &&
    "entry" in value &&
    "config" in value
  );
}

export class FarmApp {
  private config: NormalizedFarmConfig;
  private routeManager: RouteManager;
  private serverRenderer: ServerRenderer;
  private i18nRuntime: FarmI18nRuntime;
  private viteServer?: ViteDevServer;

  constructor(config: FarmConfig = {}, viteServer?: ViteDevServer) {
    this.config = this.normalizeConfig(config);
    configureFarmObservability(this.config.observability);
    _setDefaultFarmThemeConfig(this.config.theme);
    this.i18nRuntime = createFarmI18nRuntime(this.config.i18n);
    _setDefaultFarmI18nRuntime(this.i18nRuntime);
    this.viteServer = viteServer;
    this.routeManager = new RouteManager(this.config, viteServer);
    this.serverRenderer = new ServerRenderer(
      this.config,
      this.routeManager,
      this.i18nRuntime,
      this.viteServer,
    );
  }

  async initialize(): Promise<void> {
    // Silent initialization unless verbose mode
    if (process.env.FARM_VERBOSE) {
      logger.info("Initializing Farm.js application...");
    }

    await initStorage(this.config.storage);
    await configureFarmCache(this.config.cache);
    await this.i18nRuntime.initialize();
    await this.serverRenderer.initialize();

    // Verify app directory structure
    await this.verifyAppStructure();

    // Discover and register routes
    await this.routeManager.discoverRoutes();

    // Compile hydration and island decisions once during startup. Navigation
    // requests only read this manifest; HMR invalidates it when route code changes.
    this.routeManager.generateClientManifest(this.config.root);

    if (process.env.FARM_VERBOSE) {
      logger.success("Farm.js application initialized successfully!");
    }
  }

  getRouteManager(): RouteManager {
    return this.routeManager;
  }

  getServerRenderer(): ServerRenderer {
    return this.serverRenderer;
  }

  getI18nRuntime(): FarmI18nRuntime {
    return this.i18nRuntime;
  }

  getConfig(): NormalizedFarmConfig {
    return this.config;
  }

  private normalizeConfig(config: FarmConfig): NormalizedFarmConfig {
    const root = config.root || process.cwd();

    return {
      root,
      srcDir: config.srcDir || "src",
      extends: config.extends || [],
      layers: [...(config.layers || [])],
      outDir: config.outDir || "dist",
      basePath: config.basePath || "/",
      renderer: resolveFarmRenderer(config.renderer),
      preset: config.preset ?? "node-server",
      deploy: config.deploy || {},
      storage: config.storage || {},
      cache: config.cache || {},
      auth: isResolvedAuthConfig(config.auth) ? config.auth : resolveFarmAuthConfig(config.auth),
      integrations: config.integrations || {},
      plugins: config.plugins || [],
      migrations: config.migrations || { commands: [] },
      cron: resolveCronConfig(config.cron),
      workflows: resolveWorkflowsConfig(config.workflows),
      api: normalizeFarmAppAPIConfig(config.api),
      middleware: config.middleware || {},
      routeRules: normalizeRouteRules(config.routeRules),
      context: config.context || (() => undefined),
      server: resolveFarmServerConfig(config.server),
      serverActions: resolveServerActionsConfig(config.serverActions),
      security: resolveFarmSecurityConfig(config.security),
      images: resolveFarmImageConfig(config.images),
      performance: resolveFarmPerformanceConfig(config.performance),
      theme: resolveFarmThemeConfig(config.theme, config.basePath || "/"),
      i18n: isResolvedI18nConfig(config.i18n)
        ? config.i18n
        : resolveFarmI18nConfig(config.i18n, {
            root,
            mode: process.env.NODE_ENV === "production" ? "production" : "development",
          }),
      deploymentId: config.deploymentId || "development",
      serverRuntimeConfig: config.serverRuntimeConfig || {},
      publicRuntimeConfig: config.publicRuntimeConfig || {},
      docs: isResolvedDocsConfig(config.docs) ? config.docs : defaultDocsConfig,
      md: resolveMarkdownConfig(config.md),
      mdx: resolveMdxConfig(config.mdx),
      observability: config.observability ?? false,
      devtools: resolveFarmDevtoolsConfig(
        config.devtools,
        process.env.NODE_ENV === "production" ? "production" : "development",
      ),
      env: config.env || { server: {}, public: {} },
      suppressLintOnLink: config.suppressLintOnLink ?? false,
      experimental: {
        serverComponents: config.experimental?.serverComponents ?? false,
        serverActions: config.experimental?.serverActions ?? false,
        isolatedClientHydration: config.experimental?.isolatedClientHydration ?? "off",
        ...config.experimental,
      },
      vite: config.vite || {},
    };
  }

  private async verifyAppStructure(): Promise<void> {
    const appDirs = getFarmAppDirectories(this.config);

    const hasAppDirectory = (await Promise.all(appDirs.map((appDir) => fileExists(appDir)))).some(
      Boolean,
    );

    if (!hasAppDirectory) {
      const routeFiles = getFarmSourceRoots(this.config).flatMap((source) =>
        findProgrammaticRouteFiles(source.root, source.srcDir),
      );
      if (routeFiles.length > 0) {
        return;
      }

      const appDir = resolveAppPath(this.config.root, this.config.srcDir, "app");
      throw new Error(
        `App directory not found at ${appDir}. ` +
          "Please create a src/app directory or extend a Farm layer containing routes.",
      );
    }

    const componentExtensions = getFarmRendererComponentExtensions(this.config.renderer);
    const rootLayoutPaths = appDirs.flatMap((appDir) =>
      componentExtensions.map((extension) => path.join(appDir, `layout${extension}`)),
    );

    const hasRootLayout = await Promise.all(rootLayoutPaths.map((p) => fileExists(p))).then(
      (results) => results.some(Boolean),
    );

    if (!hasRootLayout) {
      logger.warn(
        `No root layout found. Consider creating src/app/layout${componentExtensions[0]} for consistent page structure.`,
      );
    }
  }
}

function isResolvedI18nConfig(value: FarmConfig["i18n"]): value is ResolvedFarmI18nConfig {
  return Boolean(value && typeof value === "object" && "enabled" in value);
}

function isResolvedAuthConfig(value: FarmConfig["auth"]): value is ResolvedFarmAuthConfig {
  return Boolean(
    value &&
    typeof value === "object" &&
    "enabled" in value &&
    "emailAndPassword" in value &&
    "database" in value,
  );
}

function normalizeFarmAppAPIConfig(config: FarmConfig["api"]): ResolvedFarmAPIConfig {
  if (typeof config?.baseURL === "function" || typeof config?.basePath === "function") {
    throw new Error(
      "Farm API config resolver functions must be processed with resolveConfig() before creating a FarmApp.",
    );
  }
  return normalizeFarmAPIConfig(config as { baseURL?: string; basePath?: string } | undefined);
}

export function createFarmApp(config?: FarmConfig, viteServer?: ViteDevServer): FarmApp {
  return new FarmApp(config, viteServer);
}
