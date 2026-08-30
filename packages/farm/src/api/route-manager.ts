import * as fs from "fs";
import * as path from "path";
import type { ViteDevServer } from "vite";
import { logger } from "../utils";
import type { ProgrammaticApiRoute } from "../routes";
import { createProgrammaticRouteModuleId } from "../routes-shared";
import { findProgrammaticRouteFilesInDir } from "../routes.server";
import {
  getFarmRouteRuntimeConfig,
  normalizeFarmRouteRuntimeConfig,
  type FarmRouteRuntimeConfig,
} from "../route-runtime";
import { _runWithFarmI18nRequest, type FarmI18nRuntime } from "../i18n/server";
import {
  getAllowedAPIRouteMethods,
  invokeAPIRouteEndpoint,
  matchAPIRoute,
  resolveAPIRouteEndpoint,
  type APIRouteMatch,
} from "./runtime";

export interface APIRoute extends FarmRouteRuntimeConfig {
  path: string;
  filePath: string;
  methods: string[];
  endpoints: Record<string, any>;
}

export interface APIRouteManagerOptions {
  throwOnLoadError?: boolean;
  i18n?: FarmI18nRuntime;
  bodySizeLimit?: number;
}

export interface APIRouteHandlerOptions {
  /** Let a framework request boundary report the original endpoint error. */
  throwOnError?: boolean;
}

export const API_ROUTE_METHODS = [
  "GET",
  "HEAD",
  "QUERY",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
] as const;

export class APIRouteManager {
  private routes: Map<string, APIRoute> = new Map();
  private viteServer?: ViteDevServer;
  private appDirs: string[];
  private throwOnLoadError: boolean;
  private i18n?: FarmI18nRuntime;
  private bodySizeLimit?: number;

  constructor(
    appDir: string | readonly string[],
    viteServer?: ViteDevServer,
    options: APIRouteManagerOptions = {},
  ) {
    this.appDirs = Array.isArray(appDir) ? [...appDir] : [appDir as string];
    this.viteServer = viteServer;
    this.throwOnLoadError = options.throwOnLoadError === true;
    this.i18n = options.i18n;
    this.bodySizeLimit = options.bodySizeLimit;
  }

  /**
   * Discover route.ts files in /app/api and explicit endpoints in root routes.ts
   */
  async discoverRoutes(): Promise<void> {
    this.routes.clear();

    for (const appDir of this.appDirs) {
      const apiDir = path.join(appDir, "api");
      let routeFiles: string[] = [];

      if (fs.existsSync(apiDir)) {
        routeFiles = this.findRouteFiles(apiDir);
      }

      for (const filePath of routeFiles) {
        await this.loadRoute(filePath, appDir);
      }

      await this.loadRootRoutes(appDir);
      await this.loadProgrammaticApiRoutes(appDir);
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
  private async loadRoute(filePath: string, appDir: string): Promise<void> {
    try {
      // Convert file path to API route path
      // /app/api/auth/login/route.ts -> /api/auth/login
      const apiDir = path.join(appDir, "api");
      const relativePath = path.relative(apiDir, path.dirname(filePath));
      const routePath = "/api/" + (relativePath === "." ? "" : relativePath.replace(/\\/g, "/"));

      const routeModule = await this.loadModule(filePath);

      const endpoints: Record<string, any> = {};
      const availableMethods: string[] = [];

      for (const method of API_ROUTE_METHODS) {
        if (routeModule[method]) {
          endpoints[method] = routeModule[method];
          availableMethods.push(method);
        }
      }

      if (availableMethods.length > 0) {
        const runtimeConfig = normalizeFarmRouteRuntimeConfig(
          getFarmRouteRuntimeConfig(routeModule),
          `API route "${routePath}"`,
        );
        this.routes.set(routePath, {
          path: routePath,
          filePath,
          methods: availableMethods,
          endpoints,
          ...runtimeConfig,
        });
      }
    } catch (error) {
      this.handleLoadError(`Error loading route ${filePath}`, error);
    }
  }

  /**
   * Load explicit-path endpoints from src/routes.ts-style files.
   */
  private async loadRootRoutes(appDir: string): Promise<void> {
    const routesFile = this.findRootRoutesFile(appDir);
    if (!routesFile) {
      return;
    }

    try {
      const routesModule = await this.loadModule(routesFile);

      for (const exportValue of Object.values(routesModule)) {
        const endpoint = exportValue as any;
        if (!endpoint?.__path) {
          continue;
        }

        const method = String(endpoint.__method || "GET").toUpperCase();
        this.addEndpoint(endpoint.__path, routesFile, method, endpoint);
      }
    } catch (error) {
      this.handleLoadError(`Error loading root API routes ${routesFile}`, error);
    }
  }

  private async loadProgrammaticApiRoutes(appDir: string): Promise<void> {
    const candidateRoots = [path.dirname(appDir), appDir];
    const routeFiles = Array.from(
      new Set(candidateRoots.flatMap((srcRoot) => findProgrammaticRouteFilesInDir(srcRoot))),
    );
    if (routeFiles.length === 0) return;

    const { getProgrammaticRouteManifest } = await import("../routes");

    for (const routeFile of routeFiles) {
      try {
        const routesModule = await this.loadModule(routeFile);
        const manifest = getProgrammaticRouteManifest(routesModule);
        if (!manifest) continue;

        for (const definition of manifest.routes) {
          if (definition.kind !== "api") continue;
          this.addProgrammaticApiRoute(routeFile, definition);
        }
      } catch (error) {
        this.handleLoadError(`Error loading programmatic API routes ${routeFile}`, error);
      }
    }
  }

  private handleLoadError(message: string, error: unknown): void {
    logger.error(`${message}: ${error}`);
    if (this.throwOnLoadError) {
      throw error;
    }
  }

  private findRootRoutesFile(appDir: string): string | null {
    const routeNames = ["routes.ts", "routes.tsx", "routes.js"];
    const candidateDirs = [path.dirname(appDir), appDir];
    const seen = new Set<string>();

    for (const dir of candidateDirs) {
      for (const routeName of routeNames) {
        const routesFile = path.join(dir, routeName);
        if (seen.has(routesFile)) {
          continue;
        }
        seen.add(routesFile);

        if (fs.existsSync(routesFile)) {
          return routesFile;
        }
      }
    }

    return null;
  }

  private async loadModule(filePath: string): Promise<Record<string, unknown>> {
    if (this.viteServer) {
      return await this.viteServer.ssrLoadModule(filePath);
    }

    const fileUrl = `file://${filePath}`;
    return await import(/* @vite-ignore */ fileUrl);
  }

  private addEndpoint(
    routePath: string,
    filePath: string,
    method: string,
    endpoint: any,
    runtimeConfig: FarmRouteRuntimeConfig = {},
  ): void {
    const normalizedMethod = method.toUpperCase();
    const existingRoute = this.routes.get(routePath);

    if (existingRoute) {
      if (!existingRoute.methods.includes(normalizedMethod)) {
        existingRoute.methods.push(normalizedMethod);
      }
      existingRoute.endpoints[normalizedMethod] = endpoint;
      Object.assign(existingRoute, runtimeConfig);
      return;
    }

    this.routes.set(routePath, {
      path: routePath,
      filePath,
      methods: [normalizedMethod],
      endpoints: { [normalizedMethod]: endpoint },
      ...runtimeConfig,
    });
  }

  private addProgrammaticApiRoute(filePath: string, route: ProgrammaticApiRoute): void {
    const modulePath = createProgrammaticRouteModuleId(filePath, "api", route.path);
    const runtimeConfig = normalizeFarmRouteRuntimeConfig(route, `API route "${route.path}"`);
    for (const [method, endpoint] of Object.entries(route.methods)) {
      if (endpoint) {
        this.addEndpoint(route.path, modulePath, method, endpoint, runtimeConfig);
      }
    }
  }

  /**
   * Get the handler that directly invokes endpoint handlers
   */
  getHandler(options: APIRouteHandlerOptions = {}): ((req: Request) => Promise<Response>) | null {
    if (this.routes.size === 0) {
      return null;
    }

    return async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method.toUpperCase();

      // Find matching route
      const match = matchAPIRoute(this.routes, pathname);
      if (!match) {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Check if method is supported
      const { route, params } = match;
      const endpoint = resolveAPIRouteEndpoint(route, method);
      if (!endpoint) {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: {
            Allow: getAllowedAPIRouteMethods(route).join(", "),
            "Content-Type": "application/json",
          },
        });
      }

      const invoke = async () => {
        try {
          return await invokeAPIRouteEndpoint(endpoint, request, params, this.bodySizeLimit);
        } catch (error: any) {
          if (options.throwOnError) throw error;
          console.error(`[API Error] ${pathname}:`, error);
          return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      };

      return this.i18n?.config.enabled
        ? _runWithFarmI18nRequest(this.i18n, request, invoke, {
            redirect: false,
          })
        : invoke();
    };
  }

  /**
   * Check if a path is an API route
   */
  isAPIRoute(pathname: string): boolean {
    return Boolean(this.matchRoute(pathname));
  }

  matchRoute(pathname: string): APIRouteMatch<APIRoute> | null {
    return matchAPIRoute(this.routes, pathname);
  }

  /**
   * Get all routes for client type generation
   */
  getRoutes(): Map<string, APIRoute> {
    return this.routes;
  }
}

export {
  getAllowedAPIRouteMethods,
  invokeAPIRouteEndpoint,
  isWebResponse,
  matchAPIRoute,
  normalizeRouteResponse,
  resolveAPIRouteEndpoint,
} from "./runtime";
export type { APIRouteMatch, APIRouteParams, APIRouteParamValue } from "./runtime";
