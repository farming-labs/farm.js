import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { RewriteConfig } from "../config";
import type { FarmRequest, FarmResponse } from "../types";
import { compileConfigRoutePattern, interpolateConfigRouteDestination } from "./route-pattern";

export function createRewritesPlugin(
  rewrites: RewriteConfig[],
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
  const compiledRewrites = rewrites.map((rewrite) => ({
    rewrite,
    pattern: compileConfigRoutePattern(rewrite.source),
  }));

  return {
    name: "farm:rewrites",
    enforce: "pre",

    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const pathname = url.pathname;

      for (const { rewrite, pattern } of compiledRewrites) {
        const match = pathname.match(pattern.regex);
        if (match) {
          const newPath = interpolateConfigRouteDestination(
            rewrite.destination,
            match,
            pattern.tokens,
          );
          const destinationUrl = new URL(newPath, url);
          if (!destinationUrl.search && url.search) {
            destinationUrl.search = url.search;
          }
          req.url =
            destinationUrl.origin === url.origin
              ? destinationUrl.pathname + destinationUrl.search
              : destinationUrl.href;
          break;
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
