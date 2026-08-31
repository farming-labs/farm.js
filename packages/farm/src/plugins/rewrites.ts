import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { RewriteConfig } from "../config";
import type { FarmRequest, FarmResponse } from "../types";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import {
  compileConfigRoutePattern,
  interpolateConfigRouteDestination,
  localizeConfigRouteDestination,
  resolveConfigRoutePathname,
} from "./route-pattern";

export const FARM_CONFIG_REWRITES_PLUGIN_NAME = "farm:rewrites";

export function createRewritesPlugin(
  rewrites: RewriteConfig[],
  {
    beforeRequest: overrideBeforeRequest,
    afterResponse: overrideAfterResponse,
    i18n,
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
    i18n?: ResolvedFarmI18nConfig;
  } = {},
): FarmPlugin {
  const compiledRewrites = rewrites.map((rewrite) => ({
    rewrite,
    pattern: compileConfigRoutePattern(rewrite.source),
  }));

  return {
    name: FARM_CONFIG_REWRITES_PLUGIN_NAME,
    enforce: "pre",

    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const routePath = resolveConfigRoutePathname(url.pathname, i18n);
      const pathname = routePath.pathname;

      for (const { rewrite, pattern } of compiledRewrites) {
        const match = pathname.match(pattern.regex);
        if (match) {
          const newPath = localizeConfigRouteDestination(
            interpolateConfigRouteDestination(rewrite.destination, match, pattern.tokens),
            routePath.locale,
            i18n,
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
