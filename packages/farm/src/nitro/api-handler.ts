import type { APIRouteManager } from "../api/route-manager";
import { defineEventHandler, sendWebResponse, setResponseStatus } from "h3";
import type { H3Event } from "h3";

/**
 * Create Nitro API handler for all /api/* routes
 * This handler intercepts API requests and routes them through better-call
 */
export function createNitroAPIHandler(apiRouteManager: APIRouteManager) {
  return defineEventHandler(async (event: H3Event) => {
    const pathname = event.url.pathname;

    // Only handle API routes
    if (!apiRouteManager.matchRoute(pathname)) {
      return; // Let other handlers process this
    }

    try {
      // Call better-call handler
      const betterCallHandler = apiRouteManager.getHandler();
      if (!betterCallHandler) {
        setResponseStatus(event, 404);
        return { error: "API handler not found" };
      }

      const response = await betterCallHandler(event.req);

      return sendWebResponse(response);
    } catch (error: any) {
      setResponseStatus(event, 500);
      return {
        error: error.message || "Internal Server Error",
      };
    }
  });
}
