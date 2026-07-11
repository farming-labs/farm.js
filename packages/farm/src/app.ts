import type { FarmConfig } from "./types";
import type { FarmDocsResolvedConfig } from "./docs/types";
import type { FarmMarkdownResolvedConfig } from "./markdown";
import type { FarmMdxResolvedConfig } from "./app-markdown";
import { resolveMdxConfig } from "./app-markdown";
import { resolveMarkdownConfig } from "./markdown";
import { resolveWorkflowsConfig, type FarmWorkflowsResolvedConfig } from "./workflows";
import { resolveAppPath, fileExists, logger } from "./utils";
import { initStorage } from "./storage";
import { configureFarmObservability } from "./observability";
import { normalizeRouteRules } from "./route-rules";
import { resolveServerActionsConfig } from "./server-action-security";
import { RouteManager } from "./routing/route-manager";
import { ServerRenderer } from "./server/renderer";
import { findProgrammaticRouteFiles } from "./routes.server";
import path from "path";
import type { ViteDevServer } from "vite";

type NormalizedFarmConfig = Required<FarmConfig> & {
  docs: FarmDocsResolvedConfig;
  md: FarmMarkdownResolvedConfig;
  mdx: FarmMdxResolvedConfig;
  workflows: FarmWorkflowsResolvedConfig;
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
  private viteServer?: ViteDevServer;

  constructor(config: FarmConfig = {}, viteServer?: ViteDevServer) {
    this.config = this.normalizeConfig(config);
    configureFarmObservability(this.config.observability);
    this.viteServer = viteServer;
    this.routeManager = new RouteManager(this.config, viteServer);
    this.serverRenderer = new ServerRenderer(this.config, this.routeManager);
  }

  async initialize(): Promise<void> {
    // Silent initialization unless verbose mode
    if (process.env.FARM_VERBOSE) {
      logger.info("Initializing Farm.js application...");
    }

    await initStorage(this.config.storage);

    // Verify app directory structure
    await this.verifyAppStructure();

    // Discover and register routes
    await this.routeManager.discoverRoutes();

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

  getConfig(): NormalizedFarmConfig {
    return this.config;
  }

  private normalizeConfig(config: FarmConfig): NormalizedFarmConfig {
    const root = config.root || process.cwd();

    return {
      root,
      srcDir: config.srcDir || "src",
      outDir: config.outDir || "dist",
      basePath: config.basePath || "/",
      preset: config.preset ?? "node-server",
      deploy: config.deploy || {},
      storage: config.storage || {},
      integrations: config.integrations || {},
      migrations: config.migrations || { commands: [] },
      workflows: resolveWorkflowsConfig(config.workflows),
      middleware: config.middleware || {},
      routeRules: normalizeRouteRules(config.routeRules),
      context: config.context || (() => undefined),
      serverActions: resolveServerActionsConfig(config.serverActions),
      docs: isResolvedDocsConfig(config.docs) ? config.docs : defaultDocsConfig,
      md: resolveMarkdownConfig(config.md),
      mdx: resolveMdxConfig(config.mdx),
      observability: config.observability ?? false,
      env: config.env || { server: {}, public: {} },
      suppressLintOnLink: config.suppressLintOnLink ?? false,
      experimental: {
        serverComponents: config.experimental?.serverComponents ?? false,
        serverActions: config.experimental?.serverActions ?? false,
        ...config.experimental,
      },
      vite: config.vite || {},
    };
  }

  private async verifyAppStructure(): Promise<void> {
    const appDir = resolveAppPath(this.config.root, this.config.srcDir, "app");

    if (!(await fileExists(appDir))) {
      const routeFiles = findProgrammaticRouteFiles(this.config.root, this.config.srcDir);
      if (routeFiles.length > 0) {
        return;
      }

      throw new Error(
        `App directory not found at ${appDir}. ` +
          "Please create a src/app directory with your pages and layouts.",
      );
    }

    const rootLayoutPaths = [
      path.join(appDir, "layout.tsx"),
      path.join(appDir, "layout.ts"),
      path.join(appDir, "layout.jsx"),
      path.join(appDir, "layout.js"),
    ];

    const hasRootLayout = await Promise.all(rootLayoutPaths.map((p) => fileExists(p))).then(
      (results) => results.some(Boolean),
    );

    if (!hasRootLayout) {
      logger.warn(
        "No root layout found. Consider creating src/app/layout.tsx for consistent page structure.",
      );
    }
  }
}

export function createFarmApp(config?: FarmConfig): FarmApp {
  return new FarmApp(config);
}
