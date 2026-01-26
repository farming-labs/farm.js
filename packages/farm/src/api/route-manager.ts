import { createRouter } from "better-call";
import * as fs from "fs";
import * as path from "path";
import type { ViteDevServer } from "vite";
import { logger } from "../utils";

export interface APIRoute {
  path: string;
  filePath: string;
  methods: string[];
  endpoints: Record<string, any>;
}

export class APIRouteManager {
  private routes: Map<string, APIRoute> = new Map();
  private router: any;
  private viteServer?: ViteDevServer;

  constructor(
    private appDir: string,
    viteServer?: ViteDevServer,
  ) {
    this.viteServer = viteServer;
  }

  /**
   * Discover all route.ts files in /app/api
   */
  async discoverRoutes(): Promise<void> {
    const apiDir = path.join(this.appDir, "api");

    if (!fs.existsSync(apiDir)) {
      if (process.env.FARM_VERBOSE) {
        logger.info("No /app/api directory found, skipping API route discovery");
      }
      return;
    }

    const routeFiles = this.findRouteFiles(apiDir);

    if (routeFiles.length === 0) {
      if (process.env.FARM_VERBOSE) {
        logger.info("No route files found in /app/api");
      }
      return;
    }

    for (const filePath of routeFiles) {
      await this.loadRoute(filePath);
    }

    this.createRouter();

    if (process.env.FARM_VERBOSE) {
      logger.success(`Discovered ${this.routes.size} API routes`);
      for (const [routePath, route] of this.routes) {
        logger.info(`  ${route.methods.join(", ")} ${routePath}`);
      }
    }
  }

  /**
   * Recursively find all route.ts files
   */
  private findRouteFiles(dir: string): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dir)) {
      return files;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...this.findRouteFiles(fullPath));
      } else if (
        entry.name === "route.ts" ||
        entry.name === "route.tsx" ||
        entry.name === "route.js"
      ) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Load a route.ts file and extract HTTP method exports
   */
  private async loadRoute(filePath: string): Promise<void> {
    try {
      // Convert file path to API route path
      // /app/api/auth/login/route.ts -> /api/auth/login
      const apiDir = path.join(this.appDir, "api");
      const relativePath = path.relative(apiDir, path.dirname(filePath));
      const routePath = "/api/" + (relativePath === "." ? "" : relativePath.replace(/\\/g, "/"));

      // Load the module (use Vite in dev, native import in prod)
      let routeModule;
      if (this.viteServer) {
        routeModule = await this.viteServer.ssrLoadModule(filePath);
      } else {
        const fileUrl = `file://${filePath}`;
        routeModule = await import(/* @vite-ignore */ fileUrl);
      }

      // Extract HTTP method exports
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
      const endpoints: Record<string, any> = {};
      const availableMethods: string[] = [];

      for (const method of methods) {
        if (routeModule[method]) {
          endpoints[method] = routeModule[method];
          availableMethods.push(method);
        }
      }

      if (availableMethods.length > 0) {
        this.routes.set(routePath, {
          path: routePath,
          filePath,
          methods: availableMethods,
          endpoints,
        });
      }
    } catch (error) {
      logger.error(`Error loading route ${filePath}: ${error}`);
    }
  }

  /**
   * Create better-call router with all discovered endpoints
   */
  private createRouter(): void {
    const allEndpoints: Record<string, any> = {};

    for (const [routePath, route] of this.routes) {
      for (const method of route.methods) {
        const endpoint = route.endpoints[method];

        // Check if endpoint already has path set, if not set it
        if (!(endpoint as any).__path) {
          // Update the endpoint path
          (endpoint as any).__path = routePath;
        }

        // Create unique key for better-call
        const key = `${method.toLowerCase()}_${routePath.replace(/\//g, "_").replace(/-/g, "_")}`;

        allEndpoints[key] = endpoint;
      }
    }

    if (Object.keys(allEndpoints).length > 0) {
      this.router = createRouter(allEndpoints, {
        basePath: "",
      });
    }
  }

  /**
   * Get the better-call router handler
   */
  getHandler(): ((req: Request) => Promise<Response>) | null {
    return this.router?.handler || null;
  }

  /**
   * Check if a path is an API route
   */
  isAPIRoute(path: string): boolean {
    return path.startsWith("/api/");
  }

  /**
   * Get all routes for client type generation
   */
  getRoutes(): Map<string, APIRoute> {
    return this.routes;
  }

  /**
   * Get router for type export
   */
  getRouter() {
    return this.router;
  }
}
