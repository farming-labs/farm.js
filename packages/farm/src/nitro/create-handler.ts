import { requestHandler } from "./request-handler";
import type { RequestHandler } from "./request-handler";
import type { RouteManager } from "../routing/route-manager";
import type { APIRouteManager } from "../api/route-manager";
import type { ServerRenderer } from "../server/renderer";
import { logger } from "../utils";

export type HandlerCallback = (opts: {
  request: Request;
  routeManager?: RouteManager;
  apiRouteManager?: APIRouteManager;
  serverRenderer?: ServerRenderer;
  // Add your framework-specific context here
}) => Promise<Response>;

export function createHandler(
  cb: HandlerCallback,
  context?: {
    routeManager?: RouteManager;
    apiRouteManager?: APIRouteManager;
    serverRenderer?: ServerRenderer;
  },
): RequestHandler {
  // This is your actual request resolver
  const resolver: RequestHandler = async (request, requestOpts) => {
    try {
      // Your routing, middleware, SSR logic here
      return await cb({
        request,
        ...context,
        // Pass any additional context
      });
    } catch (error) {
      // Error handling
      if (error instanceof Response) {
        return error;
      }
      logger.error(`Handler error: ${error}`);
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Internal Server Error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };

  // Wrap with requestHandler to enable h3 utilities (optional)
  return requestHandler(resolver);
}
