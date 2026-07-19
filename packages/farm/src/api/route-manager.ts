import * as fs from "fs";
import * as path from "path";
import type { ViteDevServer } from "vite";
import { logger } from "../utils";
import {
  createProgrammaticRouteModuleId,
  getProgrammaticRouteManifest,
  type ProgrammaticApiRoute,
} from "../routes";
import { findProgrammaticRouteFilesInDir } from "../routes.server";
import {
  getFarmRouteRuntimeConfig,
  normalizeFarmRouteRuntimeConfig,
  type FarmRouteRuntimeConfig,
} from "../route-runtime";

export interface APIRoute extends FarmRouteRuntimeConfig {
  path: string;
  filePath: string;
  methods: string[];
  endpoints: Record<string, any>;
}

export type APIRouteParamValue = string | string[];
export type APIRouteParams = Record<string, APIRouteParamValue>;

export interface APIRouteMatch<T extends { path: string }> {
  route: T;
  params: APIRouteParams;
}

export interface APIRouteManagerOptions {
  throwOnLoadError?: boolean;
}

export const API_ROUTE_METHODS = [
  "GET",
  "HEAD",
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

  constructor(
    appDir: string | readonly string[],
    viteServer?: ViteDevServer,
    options: APIRouteManagerOptions = {},
  ) {
    this.appDirs = Array.isArray(appDir) ? [...appDir] : [appDir as string];
    this.viteServer = viteServer;
    this.throwOnLoadError = options.throwOnLoadError === true;
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
  getHandler(): ((req: Request) => Promise<Response>) | null {
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
      const endpoint = route.endpoints[method];
      if (!endpoint) {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        return await invokeAPIRouteEndpoint(endpoint, request, params);
      } catch (error: any) {
        console.error(`[API Error] ${pathname}:`, error);
        return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
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

export function matchAPIRoute<T extends { path: string }>(
  routes: Map<string, T>,
  pathname: string,
): APIRouteMatch<T> | null {
  const exactRoute = routes.get(pathname);
  if (exactRoute) {
    return { route: exactRoute, params: {} };
  }

  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname !== pathname) {
    const normalizedRoute = routes.get(normalizedPathname);
    if (normalizedRoute) {
      return { route: normalizedRoute, params: {} };
    }
  }

  for (const route of routes.values()) {
    const params = matchRoutePath(route.path, pathname);
    if (params) {
      return { route, params };
    }
  }

  return null;
}

export async function invokeAPIRouteEndpoint(
  endpoint: any,
  request: Request,
  params: APIRouteParams = {},
): Promise<Response> {
  const farmHandler = endpoint.__handler || (isFarmContextHandler(endpoint) ? endpoint : null);

  if (!farmHandler) {
    const result = await endpoint(request, {
      params: Promise.resolve(params),
    });
    return normalizeRouteResponse(result);
  }

  const url = new URL(request.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  let body: any = undefined;
  if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
    body = await readJSONBody(request);
  }

  const headers = Object.fromEntries(request.headers.entries());
  const types = endpoint.__types || {};

  const queryValidation = validateInput(types.query, query, "Invalid query parameters");
  if (queryValidation instanceof Response) {
    return queryValidation;
  }

  const bodyValidation = validateInput(types.body, body, "Invalid request body");
  if (bodyValidation instanceof Response) {
    return bodyValidation;
  }

  const headersValidation = validateInput(types.headers, headers, "Invalid request headers");
  if (headersValidation instanceof Response) {
    return headersValidation;
  }

  const result = await farmHandler({
    query: queryValidation,
    body: bodyValidation,
    headers: headersValidation,
    request,
    context: {},
    params,
  });

  return normalizeRouteResponse(result);
}

export function normalizeRouteResponse(result: unknown): Response {
  if (isWebResponse(result)) {
    return result;
  }

  if (result === undefined) {
    return new Response(null, { status: 204 });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function isWebResponse(value: unknown): value is Response {
  return (
    value instanceof Response ||
    (typeof value === "object" &&
      value !== null &&
      "headers" in value &&
      "status" in value &&
      typeof (value as Response).arrayBuffer === "function")
  );
}

function isFarmContextHandler(endpoint: unknown): boolean {
  if (typeof endpoint !== "function") {
    return false;
  }

  const source = Function.prototype.toString.call(endpoint).trim();
  const arrowMatch = source.match(/^(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/);
  const functionMatch = source.match(/^(?:async\s*)?function[^(]*\(([^)]*)\)/);
  const firstParameter = (arrowMatch?.[1] || arrowMatch?.[2] || functionMatch?.[1] || "")
    .split(",")[0]
    .trim();

  return firstParameter === "ctx" || firstParameter === "context" || firstParameter.startsWith("{");
}

async function readJSONBody(request: Request): Promise<unknown> {
  try {
    const text = await request.clone().text();
    if (text) {
      return JSON.parse(text);
    }
  } catch {
    // Body might not be JSON.
  }

  return undefined;
}

function validateInput(schema: any, value: unknown, error: string): unknown | Response {
  if (!schema || typeof schema.parse !== "function") {
    return value;
  }

  try {
    return schema.parse(value);
  } catch (validationError: any) {
    return new Response(
      JSON.stringify({
        error,
        details: validationError.errors || validationError.issues || validationError.message,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

function matchRoutePath(routePath: string, pathname: string): APIRouteParams | null {
  const routeSegments = getPathSegments(routePath);
  const pathnameSegments = getPathSegments(pathname);
  const params: APIRouteParams = {};
  let pathIndex = 0;

  for (const routeSegment of routeSegments) {
    const dynamicSegment = parseDynamicSegment(routeSegment);

    if (dynamicSegment?.catchAll) {
      const remainingSegments = pathnameSegments.slice(pathIndex).map(decodePathSegment);
      if (remainingSegments.length === 0 && !dynamicSegment.optional) {
        return null;
      }
      if (remainingSegments.length > 0) {
        params[dynamicSegment.name] = remainingSegments;
      }
      pathIndex = pathnameSegments.length;
      continue;
    }

    const pathnameSegment = pathnameSegments[pathIndex];
    if (pathnameSegment === undefined) {
      return null;
    }

    if (dynamicSegment) {
      params[dynamicSegment.name] = decodePathSegment(pathnameSegment);
      pathIndex++;
      continue;
    }

    if (routeSegment !== pathnameSegment) {
      return null;
    }

    pathIndex++;
  }

  return pathIndex === pathnameSegments.length ? params : null;
}

function getPathSegments(pathname: string): string[] {
  return normalizePathname(pathname)
    .split("/")
    .filter((segment) => segment.length > 0);
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }

  return pathname;
}

function parseDynamicSegment(
  segment: string,
): { name: string; catchAll: boolean; optional: boolean } | null {
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll?.[1]) {
    return { name: optionalCatchAll[1], catchAll: true, optional: true };
  }

  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll?.[1]) {
    return { name: catchAll[1], catchAll: true, optional: false };
  }

  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic?.[1]) {
    return { name: dynamic[1], catchAll: false, optional: false };
  }

  return null;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
