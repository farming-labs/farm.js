import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { RedirectConfig } from "../config";
import type { FarmRequest, FarmResponse } from "../types";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import { resolveFarmRequestURL } from "../server/request";
import { createConfigRedirectMatcher, type FarmConfigRedirectMatcher } from "./config-routes";

export type { FarmConfigRedirectMatcher } from "./config-routes";

export const FARM_CONFIG_REDIRECTS_PLUGIN_NAME = "farm:redirects";

const configRedirectMatchers = new WeakMap<FarmPlugin, FarmConfigRedirectMatcher>();

export function createRedirectsPlugin(
  redirects: RedirectConfig[],
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
    /** Sources match the app-relative path; internal destinations get the basePath back. */
    basePath?: string;
  } = {},
): FarmPlugin {
  const matchRedirect = createConfigRedirectMatcher(redirects, { i18n, basePath });

  const plugin: FarmPlugin = {
    name: FARM_CONFIG_REDIRECTS_PLUGIN_NAME,
    enforce: "pre",
    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
      const redirect = matchRedirect(resolveFarmRequestURL(req));
      if (!redirect) return;

      // The same response the production entry sends.
      res.setHeader("Content-Type", "text/plain;charset=UTF-8");
      res.writeHead(redirect.statusCode, {
        Location: redirect.destination,
      });
      res.end(`Redirecting to ${redirect.destination}`);
    },

    async afterResponse(req, res, context) {
      if (overrideAfterResponse) {
        await overrideAfterResponse(req, res, context);
      }
    },
  };
  configRedirectMatchers.set(plugin, matchRedirect);
  return plugin;
}

/** @internal The redirect a config redirects plugin answers a request URL with, if any. */
export function getConfigRedirectMatcher(
  plugin: FarmPlugin,
): FarmConfigRedirectMatcher | undefined {
  return configRedirectMatchers.get(plugin);
}
