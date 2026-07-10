import { createHandler } from "./create-handler";
import type { RequestHandler } from "./request-handler";
import type { RouteManager } from "../routing/route-manager";
import type { APIRouteManager } from "../api/route-manager";
import type { ServerRenderer } from "../server/renderer";
import { setEnv } from "../env";

// Global registry for runtime access (populated at build time)
declare global {
  var __FARM_REGISTRY__:
    | {
        routeManager?: RouteManager;
        apiRouteManager?: APIRouteManager;
        serverRenderer?: ServerRenderer;
        env?: any;
      }
    | undefined;
}

let envHydrated = false;

function hydrateEnvFromRegistry(): void {
  if (envHydrated || !globalThis.__FARM_REGISTRY__?.env) {
    return;
  }

  setEnv(globalThis.__FARM_REGISTRY__.env);
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
}: {
  request: Request;
  routeManager?: RouteManager;
  apiRouteManager?: APIRouteManager;
  serverRenderer?: ServerRenderer;
}): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Get managers from context or global registry
  hydrateEnvFromRegistry();
  const rm = routeManager || globalThis.__FARM_REGISTRY__?.routeManager;
  const arm = apiRouteManager || globalThis.__FARM_REGISTRY__?.apiRouteManager;
  const sr = serverRenderer || globalThis.__FARM_REGISTRY__?.serverRenderer;

  const redirectMatch = rm?.matchRedirect(pathname);
  if (redirectMatch) {
    return new Response(`Redirecting to ${redirectMatch.destination}`, {
      status: redirectMatch.statusCode,
      headers: { Location: redirectMatch.destination },
    });
  }

  // Handle API routes
  if (arm?.matchRoute(pathname)) {
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

// Create the handler with context (will be populated at build time)
const fetch = createHandler(defaultHandler);

// Export as Web Standard fetch API
export type ServerEntry = { fetch: RequestHandler };

export function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(...args) {
      return await entry.fetch(...args);
    },
  };
}

export default createServerEntry({ fetch });
