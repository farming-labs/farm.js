import type { APIRouteManager } from "../api/route-manager";
import { defineEventHandler, getHeaders, readBody, sendWebResponse, setResponseStatus } from "h3";
import type { H3Event } from "h3";

/**
 * Create Nitro API handler for all /api/* routes
 * This handler intercepts API requests and routes them through better-call
 */
export function createNitroAPIHandler(apiRouteManager: APIRouteManager) {
  return defineEventHandler(async (event: H3Event) => {
    const url = event.node.req.url || "/";
    const host = event.node.req.headers.host || "localhost";
    const pathname = new URL(url, `http://${host}`).pathname;

    // Only handle API routes
    if (!apiRouteManager.matchRoute(pathname)) {
      return; // Let other handlers process this
    }

    try {
      // Convert H3 event to Web Request
      const protocol = event.node.req.headers["x-forwarded-proto"] || "http";
      const fullUrl = `${protocol}://${host}${url}`;

      const headers = new Headers();
      const h3Headers = getHeaders(event);

      for (const [key, value] of Object.entries(h3Headers)) {
        if (value) {
          headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
        }
      }

      // Get body
      let body: string | undefined;
      const method = event.node.req.method || "GET";
      if (method !== "GET" && method !== "HEAD") {
        const bodyData = await readBody(event).catch(() => undefined);
        if (bodyData) {
          body = typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData);
        }
      }

      // Create Web Request
      const request = new Request(fullUrl, {
        method,
        headers,
        body: body || undefined,
      });

      // Call better-call handler
      const betterCallHandler = apiRouteManager.getHandler();
      if (!betterCallHandler) {
        setResponseStatus(event, 404);
        return { error: "API handler not found" };
      }

      const response = await betterCallHandler(request);

      return sendWebResponse(response);
    } catch (error: any) {
      setResponseStatus(event, 500);
      return {
        error: error.message || "Internal Server Error",
      };
    }
  });
}
