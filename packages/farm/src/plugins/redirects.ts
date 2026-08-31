import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { RedirectConfig } from "../config";
import type { FarmRequest, FarmResponse } from "../types";
import { compileConfigRoutePattern, interpolateConfigRouteDestination } from "./route-pattern";

export function createRedirectsPlugin(
  redirects: RedirectConfig[],
  {
    beforeRequest: overrideBeforeRequest,
    afterResponse: overrideAfterResponse,
  }: {
    beforeRequest?: (
      req: FarmRequest,
      res: FarmResponse,
      context: FarmPluginContext,
    ) => void | Promise<void>;
    afterResponse?: (
      req: FarmRequest,
      res: FarmResponse,
      context: FarmPluginContext,
    ) => void | Promise<void>;
  } = {},
): FarmPlugin {
  const compiledRedirects = redirects.map((redirect) => ({
    redirect,
    pattern: compileConfigRoutePattern(redirect.source),
  }));

  return {
    name: "farm:redirects",
    enforce: "pre",
    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const pathname = url.pathname;

      for (const { redirect, pattern } of compiledRedirects) {
        const match = pathname.match(pattern.regex);
        if (match) {
          const destination = interpolateConfigRouteDestination(
            redirect.destination,
            match,
            pattern.tokens,
          );

          const statusCode = redirect.statusCode || (redirect.permanent ? 308 : 307);

          res.writeHead(statusCode, {
            Location: destination,
          });
          res.end();
          return;
        }
      }
    },

    async afterResponse(req, res, context) {
      if (overrideAfterResponse) {
        await overrideAfterResponse(req, res, context);
      }
    },
  };
}
