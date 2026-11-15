import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { RewriteConfig } from "../config";
import type { FarmRequest, FarmResponse } from "../types";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import { resolveFarmRequestURL } from "../server/request";
import { createConfigRewriteMatcher } from "./config-routes";

export const FARM_CONFIG_REWRITES_PLUGIN_NAME = "farm:rewrites";

export function createRewritesPlugin(
  rewrites: RewriteConfig[],
  {
    beforeRequest: overrideBeforeRequest,
    afterResponse: overrideAfterResponse,
    i18n,
    basePath,
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
    /** Sources match the app-relative path, as in production. */
    basePath?: string;
  } = {},
): FarmPlugin {
  const matchRewrite = createConfigRewriteMatcher(rewrites, { i18n, basePath });

  return {
    name: FARM_CONFIG_REWRITES_PLUGIN_NAME,
    enforce: "pre",

    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
      const url = resolveFarmRequestURL(req);
      const destinationUrl = matchRewrite(url);
      if (destinationUrl) {
        req.url =
          destinationUrl.origin === url.origin
            ? destinationUrl.pathname + destinationUrl.search
            : destinationUrl.href;
      }
    },

    async afterResponse(req, res, context) {
      if (overrideAfterResponse) {
        await overrideAfterResponse(req, res, context);
      }
    },
  };
}
