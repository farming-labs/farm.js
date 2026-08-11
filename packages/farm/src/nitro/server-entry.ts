/**
 * Server entry point for Farm.js
 * This file is used as the SSR build entry point
 * It exports a Web Standard fetch handler that Nitro will wrap
 */

import { createHandler } from "./create-handler";
import type { RouteManager } from "../routing/route-manager";
import type { APIRouteManager } from "../api/route-manager";
import type { ServerRenderer } from "../server/renderer";
import { setEnv } from "../env";
import { withFarmRouteContext } from "../route-context";
import { createDeferredDataResponse } from "../deferred";
import {
  createFarmDeploymentMismatchResponse,
  getFarmDeploymentMismatch,
  withFarmDeploymentResponse,
} from "../deployment";
import { resolveRouteRenderingConfig } from "../ssg";
import {
  createFarmRouteRenderPlan,
  getSharedLayoutPrefixLength,
  getFarmFragmentCacheControl,
  parseFarmLayoutChainHeader,
} from "../navigation/render-plan";

// Managers will be available via globalThis.__FARM_REGISTRY__
// They are injected via Nitro hooks (ready hook) or set during build

// Global registry for runtime access (populated at build time)
declare global {
  var __FARM_REGISTRY__:
    | {
        routeManager?: RouteManager;
        apiRouteManager?: APIRouteManager;
        serverRenderer?: ServerRenderer;
        env?: any;
        deploymentId?: string;
      }
    | undefined;
}

let envHydrated = false;

/**
 * Initialize managers from global registry if not already initialized
 * This ensures managers are available even in serverless environments
 *
 * In serverless, managers are stored in globalThis.__FARM_REGISTRY__ during build
 * and should be available at runtime. If not, we return undefined and the handler
 * will return appropriate error responses.
 */
function getManagers() {
  // Check global registry (populated at build time or via Nitro hooks)
  if (typeof globalThis !== "undefined" && globalThis.__FARM_REGISTRY__) {
    const registry = globalThis.__FARM_REGISTRY__;
    hydrateEnvFromRegistry(registry);
    return {
      routeManager: registry.routeManager,
      apiRouteManager: registry.apiRouteManager,
      serverRenderer: registry.serverRenderer,
      deploymentId: registry.deploymentId,
    };
  }

  // Managers not available - this should not happen in production
  // but we handle it gracefully
  // This can happen if:
  // 1. Build didn't properly set globalThis.__FARM_REGISTRY__
  // 2. Serverless function's global scope was reset
  // 3. Managers weren't injected via Nitro hooks
  return {
    routeManager: undefined,
    apiRouteManager: undefined,
    serverRenderer: undefined,
    deploymentId: undefined,
  };
}

function hydrateEnvFromRegistry(registry: { env?: any }): void {
  if (envHydrated || !registry.env) {
    return;
  }

  setEnv(registry.env);
  envHydrated = true;
}

/**
 * Default handler for Farm.js - handles both API and SSR routes
 */
async function defaultHandler({
  request,
  routeManager,
  apiRouteManager,
  serverRenderer,
  deploymentId,
}: {
  request: Request;
  routeManager?: RouteManager;
  apiRouteManager?: APIRouteManager;
  serverRenderer?: ServerRenderer;
  deploymentId?: string;
}): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Get managers from context or global registry
  const managers = getManagers();
  const rm = routeManager || managers.routeManager;
  const arm = apiRouteManager || managers.apiRouteManager;
  const sr = serverRenderer || managers.serverRenderer;
  const activeDeploymentId = deploymentId || managers.deploymentId;

  const redirectMatch = rm?.matchRedirect(pathname);
  if (redirectMatch) {
    return new Response(`Redirecting to ${redirectMatch.destination}`, {
      status: redirectMatch.statusCode,
      headers: { Location: redirectMatch.destination },
    });
  }

  // Handle SPA page-data requests for client-side navigation
  if (pathname === "/__farm/page-data") {
    const targetPath = url.searchParams.get("path") || "/";
    const deploymentMismatch = getFarmDeploymentMismatch(request, activeDeploymentId);
    if (deploymentMismatch) {
      return createFarmDeploymentMismatchResponse(deploymentMismatch);
    }

    if (!rm) {
      return new Response(JSON.stringify({ error: "Route manager not available" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      // Parse the target path
      const targetUrl = new URL(targetPath, url.origin);
      const targetPathname = targetUrl.pathname;

      // Find the route
      const match = rm.matchRoute(targetPathname);
      if (!match) {
        return new Response(JSON.stringify({ error: "Route not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { route, params, layouts } = match;
      if (!route) {
        return new Response(JSON.stringify({ error: "Route not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Load route module to get metadata
      const routeModule = await rm.loadRouteModule(route.modulePath);
      const loadingBoundary = rm.getMatchingLoading(targetPathname);
      const loadingModule = loadingBoundary
        ? await rm.loadRouteModule(loadingBoundary.modulePath)
        : null;

      const navigationManifest = rm.generateClientManifest();
      const moduleMetadata = navigationManifest.routes.find(
        (entry) => entry.pattern === route.pattern,
      ) ?? {
        isClientComponent: false,
        shouldHydrate: false,
        islandStrategy: null,
      };
      const isClientComponent = moduleMetadata.isClientComponent;
      const shouldHydrate = moduleMetadata.shouldHydrate;

      // Collect metadata from layouts and page
      let mergedMetadata: Record<string, any> = {};
      const layoutModules = await Promise.all(
        layouts.map((layout) => rm.loadLayoutModule(layout.modulePath)),
      );
      const layoutHydrationMetadata = layouts.map(
        (layout) =>
          navigationManifest.layouts.find((entry) => entry.pattern === layout.pattern) ?? {
            isClientComponent: false,
            shouldHydrate: false,
            islandStrategy: null,
          },
      );
      const layoutShouldHydrate = layoutHydrationMetadata.some(
        (metadata) => metadata.shouldHydrate,
      );
      const hydrationStrategies = [
        ...(shouldHydrate && moduleMetadata.islandStrategy ? [moduleMetadata.islandStrategy] : []),
        ...layoutHydrationMetadata.flatMap((metadata) =>
          metadata.shouldHydrate && metadata.islandStrategy ? [metadata.islandStrategy] : [],
        ),
      ];
      const hydrationIslandStrategy = hydrationStrategies.every(
        (strategy) => strategy === hydrationStrategies[0],
      )
        ? (hydrationStrategies[0] ?? "load")
        : "load";

      for (const layoutModule of layoutModules) {
        if (layoutModule.metadata) {
          mergedMetadata = { ...mergedMetadata, ...layoutModule.metadata };
        }
      }

      if (routeModule.metadata) {
        mergedMetadata = { ...mergedMetadata, ...routeModule.metadata };
      }

      // Build search params
      const searchParams: Record<string, string> = {};
      targetUrl.searchParams.forEach((value, key) => {
        searchParams[key] = value;
      });
      const routeContext = sr
        ? await sr.resolveRouteContext({
            request,
            params,
            search: searchParams,
            path: targetUrl.pathname,
          })
        : undefined;
      const routeProps = await parseRouteModuleProps(routeModule, {
        props: withFarmRouteContext(
          {
            params,
            searchParams: Promise.resolve(searchParams),
            path: targetUrl.pathname,
          },
          routeContext,
        ),
        search: searchParams,
        routePath: route.pattern,
      });
      const renderPlan = createFarmRouteRenderPlan({
        pageShouldHydrate: shouldHydrate,
        layoutShouldHydrate,
        islandStrategy: hydrationIslandStrategy,
        rendering: resolveRouteRenderingConfig(routeModule),
      });
      const destinationLayoutPatterns = layouts.map((layout) => layout.pattern);
      const layoutStartIndex = getSharedLayoutPrefixLength(
        parseFarmLayoutChainHeader(request.headers.get("x-farm-layout-chain")),
        destinationLayoutPatterns,
      );
      const fragmentHtml = sr
        ? await sr.renderNavigationFragment({
            PageComponent: routeModule.default as any,
            LoadingComponent: loadingModule?.default,
            pageProps: routeProps as Record<string, unknown>,
            params,
            layouts: layouts.map((layout, index) => ({
              pattern: layout.pattern,
              module: layoutModules[index] as any,
            })),
            layoutStartIndex,
            pageShouldHydrate: shouldHydrate,
            layoutShouldHydrate,
            islandStrategy: hydrationIslandStrategy,
          })
        : undefined;

      // Return page data for SPA navigation
      const pageData = {
        props: {
          params: routeProps.params,
          search: (routeProps as any).search,
          searchParams: (routeProps as any).search,
          ...("data" in routeProps ? { data: (routeProps as any).data } : {}),
          ...((routeProps as any).__farmCanonicalPath
            ? { __farmCanonicalPath: (routeProps as any).__farmCanonicalPath }
            : {}),
          ...((routeProps as any).__farmRoutePropsResolved
            ? { __farmRoutePropsResolved: true }
            : {}),
        },
        canonicalPath: (routeProps as any).__farmCanonicalPath,
        modulePath: route.modulePath,
        loadingModulePath: loadingBoundary?.modulePath ?? null,
        isClientComponent,
        pageShouldHydrate: shouldHydrate,
        layoutShouldHydrate,
        shouldHydrate: shouldHydrate || layoutShouldHydrate,
        islandStrategy: hydrationIslandStrategy,
        renderPlan,
        fragment: fragmentHtml
          ? {
              html: fragmentHtml,
              layoutPatterns: destinationLayoutPatterns,
            }
          : undefined,
        metadata: {
          title: mergedMetadata.title,
          description: mergedMetadata.description,
        },
        layoutModules: layouts.map((l) => l.modulePath),
      };

      return withFarmDeploymentResponse(
        createDeferredDataResponse(
          pageData,
          {
            status: 200,
            headers: {
              "Cache-Control": getFarmFragmentCacheControl(renderPlan),
              "X-Farm-Navigation": "html-fragment",
              Vary: "X-Farm-Layout-Chain",
            },
          },
          {
            onError(error, id) {
              console.error(`[Farm.js] Deferred route data ${id} failed:`, error);
            },
          },
        ),
        activeDeploymentId,
      );
    } catch (error) {
      console.error("[Farm.js] Page data error:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to load page data",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  // Handle API routes
  if (arm?.matchRoute(pathname)) {
    const handler = arm.getHandler();
    if (handler) {
      return await handler(request);
    }
    return new Response(
      JSON.stringify({
        error: "API handler not found",
        debug: {
          hasApiRouteManager: !!arm,
          hasHandler: !!handler,
          registryAvailable: typeof globalThis !== "undefined" && !!globalThis.__FARM_REGISTRY__,
        },
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Handle SSR routes
  if (rm && sr) {
    // Convert Web Request to Node.js req/res for ServerRenderer
    // This is a temporary bridge until we fully migrate to Web Standards
    const nodeReq = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
    } as any;

    const nodeRes = {
      write: (chunk: any) => {
        // Collect chunks for streaming
        if (!nodeRes._chunks) nodeRes._chunks = [];
        nodeRes._chunks.push(chunk);
      },
      end: () => {
        // Response will be collected
      },
      setHeader: (name: string, value: string | number | readonly string[]) => {
        nodeRes._headers[name] = value;
      },
      getHeader: (name: string) => nodeRes._headers[name],
      statusCode: 200,
      _chunks: [] as any[],
      _headers: {} as Record<string, string>,
    } as any;

    try {
      await sr.renderPage(nodeReq, nodeRes);

      // Convert collected chunks to Response
      const body = nodeRes._chunks.join("");
      const headers = new Headers({
        "Content-Type": "text/html; charset=utf-8",
      });
      for (const [name, value] of Object.entries(nodeRes._headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else if (value !== undefined) {
          headers.set(name, String(value));
        }
      }
      return new Response(body, {
        status: nodeRes.statusCode || 200,
        headers,
      });
    } catch (error) {
      return new Response(
        `<html><body><h1>Error</h1><p>${error instanceof Error ? error.message : "Internal Server Error"}</p></body></html>`,
        {
          status: 500,
          headers: { "Content-Type": "text/html" },
        },
      );
    }
  }

  // Fallback 404 - managers not available
  return new Response(
    JSON.stringify({
      error: "Not Found",
      debug: {
        pathname,
        hasRouteManager: !!rm,
        hasServerRenderer: !!sr,
        hasApiRouteManager: !!arm,
        registryAvailable: typeof globalThis !== "undefined" && !!globalThis.__FARM_REGISTRY__,
      },
    }),
    {
      status: 404,
      headers: { "Content-Type": "application/json" },
    },
  );
}

async function parseRouteModuleProps(
  routeModule: unknown,
  input: {
    props: {
      params: Record<string, string>;
      searchParams: Promise<Record<string, string | string[] | undefined>>;
      path: string;
      [key: string]: unknown;
    };
    search: Record<string, string | string[] | undefined>;
    routePath: string;
  },
): Promise<Record<string, unknown>> {
  const resolveRouteProps = (routeModule as any).__farmResolveRouteProps;
  if (typeof resolveRouteProps === "function") {
    return await resolveRouteProps(input.props);
  }

  if ((routeModule as any).__farmRouteParsesProps) {
    return {
      ...input.props,
      search: input.search,
    };
  }

  const schemas = (routeModule as any).__farmRouteSchemas;
  const params = parseRouteModuleSchema(
    schemas?.params,
    input.props.params,
    "params",
    input.routePath,
  );
  const search = parseRouteModuleSchema(schemas?.search, input.search, "search", input.routePath);

  return {
    ...input.props,
    params,
    search,
    searchParams: Promise.resolve(search as Record<string, string | string[] | undefined>),
  };
}

function parseRouteModuleSchema(
  schema: { parse?: (value: unknown) => unknown } | undefined,
  value: unknown,
  label: string,
  routePath: string,
): unknown {
  if (!schema || typeof schema.parse !== "function") {
    return value;
  }

  try {
    return schema.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} for route "${routePath}": ${message}`);
  }
}

// Create the handler (context will be populated at build time via global registry)
const handler = createHandler(defaultHandler);

// Export as Web Standard fetch API
export const fetch = handler;

// Default export for compatibility
export default { fetch };
