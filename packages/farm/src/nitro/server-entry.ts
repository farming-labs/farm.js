/**
 * Server entry point for Farm.js
 * This file is used as the SSR build entry point
 * It exports a Web Standard fetch handler that Nitro will wrap
 */

import { createHandler } from "./create-handler";
import type { RouteManager } from "../routing/route-manager";
import type { APIRouteManager } from "../api/route-manager";
import type { ServerRenderer } from "../server/renderer";

// Global registry for runtime access (populated at build time)
declare global {
  var __FARM_REGISTRY__:
    | {
        routeManager?: RouteManager;
        apiRouteManager?: APIRouteManager;
        serverRenderer?: ServerRenderer;
      }
    | undefined;
}

/**
 * Initialize managers from global registry if not already initialized
 * This ensures managers are available even in serverless environments
 */
function getManagers() {
  if (!globalThis.__FARM_REGISTRY__) {
    // Try to initialize from build-time registry
    // In serverless, we might need to recreate managers from bundled data
    return {
      routeManager: undefined,
      apiRouteManager: undefined,
      serverRenderer: undefined,
    };
  }

  return {
    routeManager: globalThis.__FARM_REGISTRY__?.routeManager,
    apiRouteManager: globalThis.__FARM_REGISTRY__?.apiRouteManager,
    serverRenderer: globalThis.__FARM_REGISTRY__?.serverRenderer,
  };
}

/**
 * Default handler for Farm.js - handles both API and SSR routes
 */
async function defaultHandler({
  request,
  routeManager,
  apiRouteManager,
  serverRenderer,
}: {
  request: Request;
  routeManager?: RouteManager;
  apiRouteManager?: APIRouteManager;
  serverRenderer?: ServerRenderer;
}): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Get managers from context or global registry
  const managers = getManagers();
  const rm = routeManager || managers.routeManager;
  const arm = apiRouteManager || managers.apiRouteManager;
  const sr = serverRenderer || managers.serverRenderer;

  // Handle API routes
  if (pathname.startsWith("/api/") && arm) {
    const handler = arm.getHandler();
    if (handler) {
      return await handler(request);
    }
    return new Response(JSON.stringify({ error: "API handler not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
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
      setHeader: () => {},
      statusCode: 200,
      _chunks: [] as any[],
      _headers: {} as Record<string, string>,
    } as any;

    try {
      await sr.renderPage(nodeReq, nodeRes);

      // Convert collected chunks to Response
      const body = nodeRes._chunks.join("");
      return new Response(body, {
        status: nodeRes.statusCode || 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...nodeRes._headers,
        },
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

  // Fallback 404
  return new Response("Not Found", { status: 404 });
}

// Create the handler (context will be populated at build time via global registry)
const handler = createHandler(defaultHandler);

// Export as Web Standard fetch API
export const fetch = handler;

// Default export for compatibility
export default { fetch };
