import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { RedirectConfig } from "../config";
import type { FarmRequest, FarmResponse } from "../types";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import { isFarmRedirectStatus } from "../navigation-errors";
import { appendFarmRedirectQuery } from "../redirect-query";
import { resolveFarmRequestURL } from "../server/request";
import {
  compileConfigRoutePattern,
  interpolateConfigRouteDestination,
  resolveConfigRedirectDestination,
  resolveConfigRoutePathname,
} from "./route-pattern";

export const FARM_CONFIG_REDIRECTS_PLUGIN_NAME = "farm:redirects";

export type FarmConfigRedirectMatcher = (
  url: URL,
) => { destination: string; statusCode: number } | null;

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
  for (const redirect of redirects) {
    if (redirect.statusCode !== undefined && !isFarmRedirectStatus(redirect.statusCode)) {
      throw new RangeError(
        `Redirect "${redirect.source}" statusCode must be one of 301, 302, 303, 307, or 308.`,
      );
    }
  }
  const compiledRedirects = redirects.map((redirect) => ({
    redirect,
    pattern: compileConfigRoutePattern(redirect.source),
  }));

  const matchRedirect: FarmConfigRedirectMatcher = (url) => {
    const routePath = resolveConfigRoutePathname(url.pathname, i18n, basePath);
    for (const { redirect, pattern } of compiledRedirects) {
      const match = routePath.pathname.match(pattern.regex);
      if (!match) continue;
      const localizedDestination = resolveConfigRedirectDestination(
        interpolateConfigRouteDestination(redirect.destination, match, pattern.tokens),
        routePath.locale,
        i18n,
        basePath,
      );
      return {
        destination: appendFarmRedirectQuery(localizedDestination, url.search),
        statusCode: redirect.statusCode ?? (redirect.permanent ? 308 : 307),
      };
    }
    return null;
  };

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
