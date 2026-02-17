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
   * Get the handler that directly invokes endpoint handlers
   */
  getHandler(): ((req: Request) => Promise<Response>) | null {
    if (this.routes.size === 0) {
      return null;
    }

    return async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method.toUpperCase();

      // Find matching route
      const route = this.routes.get(pathname);
      if (!route) {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Check if method is supported
      const endpoint = route.endpoints[method];
      if (!endpoint) {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        // Get the handler function
        const handler = endpoint.__handler || endpoint;
        
        // Parse query parameters
        const query: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {
          query[key] = value;
        });

        // Parse body for POST/PUT/PATCH
        let body: any = undefined;
        if (["POST", "PUT", "PATCH"].includes(method)) {
          try {
            const text = await request.text();
            if (text) {
              body = JSON.parse(text);
            }
          } catch {
            // Body might not be JSON
          }
        }

        // Call the handler
        const result = await handler({
          query,
          body,
          headers: Object.fromEntries(request.headers.entries()),
          request,
          context: {},
          params: {},
        });

        // Return the response
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        console.error(`[API Error] ${pathname}:`, error);
        return new Response(
          JSON.stringify({ error: error.message || "Internal Server Error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    };
  }

  /**
   * Check if a path is an API route
   */
  isAPIRoute(pathname: string): boolean {
    return pathname.startsWith("/api/");
  }

  /**
   * Get all routes for client type generation
   */
  getRoutes(): Map<string, APIRoute> {
    return this.routes;
  }
}
