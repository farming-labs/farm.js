import type { FarmConfig } from "./types";
import { resolveAppPath, fileExists, logger } from "./utils";
import { RouteManager } from "./routing/route-manager";
import { ServerRenderer } from "./server/renderer";
import path from "path";
import type { ViteDevServer } from "vite";

export class FarmApp {
  private config: Required<FarmConfig>;
  private routeManager: RouteManager;
  private serverRenderer: ServerRenderer;
  private viteServer?: ViteDevServer;

  constructor(config: FarmConfig = {}, viteServer?: ViteDevServer) {
    this.config = this.normalizeConfig(config);
    this.viteServer = viteServer;
    this.routeManager = new RouteManager(this.config, viteServer);
    this.serverRenderer = new ServerRenderer(this.config, this.routeManager);
  }

  async initialize(): Promise<void> {
    // Silent initialization unless verbose mode
    if (process.env.FARM_VERBOSE) {
      logger.info("Initializing Farm.js application...");
    }

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

  getConfig(): Required<FarmConfig> {
    return this.config;
  }

  private normalizeConfig(config: FarmConfig): Required<FarmConfig> {
    const root = config.root || process.cwd();

    return {
      root,
      srcDir: config.srcDir || "src",
      outDir: config.outDir || "dist",
      basePath: config.basePath || "/",
      preset: config.preset ?? "node-server",
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
