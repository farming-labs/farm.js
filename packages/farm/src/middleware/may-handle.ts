/**
 * Answers to "does a guard see this path?", reusing the runtime matchers so the build
 * never disagrees with the server about which requests a guard sees. Prerendering asks
 * whether a guard *may* run (unknowable cases count as yes); public listings and the app
 * manifest ask whether a guard written for the path covers it (see
 * {@link farmPathGuardCoversPage}).
 */
import { createFarmAPIMiddlewarePathnames } from "../api/server-path";
import type { ResolvedFarmConfig } from "../config";
import { integrationMiddlewareMayHandlePath } from "../integration-middleware-matcher";
// Type-only: a value import would bundle the whole integration runtime into the server.
import type { FarmIntegrationsUserConfig } from "../integrations";
import {
  compileMiddlewareConfig,
  matchesCompiledMiddlewareConfig,
  matchesMiddlewareRoute,
} from "./matcher";
import type { MiddlewareContext, MiddlewareMatcher } from "./types";

/** @internal */
export function hasFarmMiddlewareConfig(config: ResolvedFarmConfig["middleware"]): boolean {
  if (!config) return false;
  if (Array.isArray(config)) return config.length > 0;

  const configRecord = config as Record<string, unknown>;
  return Boolean(
    configRecord.matcher ||
    configRecord.exclude ||
    configRecord.runtime ||
    configRecord.handler ||
    (Array.isArray(configRecord.handlers) && configRecord.handlers.length > 0),
  );
}

/**
 * Whether config middleware may run for a path. This reuses the runtime matcher: a
 * separate copy drifted (`/members/(.*)` kept its trailing slash and never met
 * `/members/secret`), and a prerendered page was frozen into a public file that
 * middleware never sees again.
 *
 * @internal
 */
export function configMiddlewareMayHandlePath(
  config: ResolvedFarmConfig["middleware"],
  pathname: string,
): boolean {
  if (!hasFarmMiddlewareConfig(config)) return false;

  const entries = (Array.isArray(config) ? config : [config]) as Array<{
    matcher?: MiddlewareMatcher | MiddlewareMatcher[];
    exclude?: Array<string | RegExp>;
  }>;
  return entries.some((entry) => {
    if (!entry.matcher && !entry.exclude) return true;
    const matchers = entry.matcher
      ? (Array.isArray(entry.matcher) ? entry.matcher : [entry.matcher]).map((matcher) =>
          // A request-aware matcher cannot be proven safe at build time.
          typeof matcher === "function" ? () => true : matcher,
        )
      : undefined;
    const compiled = compileMiddlewareConfig({ matcher: matchers, exclude: entry.exclude });
    return matchesCompiledMiddlewareConfig(pathname, compiled, {} as MiddlewareContext).matched;
  });
}

/** @internal File middleware counterpart of `configMiddlewareMayHandlePath`. */
export function appMiddlewareMayHandlePath(
  middlewareRoutes: readonly { path: string }[],
  pathname: string,
): boolean {
  return middlewareRoutes.some((route) => matchesMiddlewareRoute(pathname, route).matched);
}

// A path no app route uses: a matcher that meets it matches every path, so it names no
// particular page.
const CATCH_ALL_PROBE = "/__farm-listing-probe__/0";

function isPathSpecificMatcher(matcher: MiddlewareMatcher): matcher is string | RegExp {
  if (typeof matcher === "function") return false;
  const compiled = compileMiddlewareConfig({ matcher });
  return !matchesCompiledMiddlewareConfig(CATCH_ALL_PROBE, compiled, {} as MiddlewareContext)
    .matched;
}

function pathSpecificConfigMiddlewareCovers(
  config: ResolvedFarmConfig["middleware"],
  pathname: string,
): boolean {
  if (!hasFarmMiddlewareConfig(config)) return false;
  const entries = (Array.isArray(config) ? config : [config]) as Array<{
    matcher?: MiddlewareMatcher | MiddlewareMatcher[];
    exclude?: Array<string | RegExp>;
  }>;
  return entries.some((entry) => {
    if (!entry.matcher) return false;
    const matchers = (Array.isArray(entry.matcher) ? entry.matcher : [entry.matcher]).filter(
      isPathSpecificMatcher,
    );
    if (matchers.length === 0) return false;
    const compiled = compileMiddlewareConfig({ matcher: matchers, exclude: entry.exclude });
    return matchesCompiledMiddlewareConfig(pathname, compiled, {} as MiddlewareContext).matched;
  });
}

/**
 * Whether a guard written for this page's path covers it: middleware.ts in the page's
 * folder or a parent below the root, a config middleware matcher, or an integration's
 * middleware matcher (`protectedRoutes`). Public listings (sitemap.xml, llms.txt, the
 * default MCP server) leave such a page out, so its path and title stay unpublished.
 *
 * Guards that cover every path (a root middleware.ts, middleware without a matcher or
 * with a catch-all or function matcher, a plugin's `runtime.before`) name no page, so
 * they hide nothing: the listings would otherwise be empty. Their pages are still read
 * as an anonymous visitor, so a guard there keeps the content itself private.
 *
 * @internal
 */
export function farmPathGuardCoversPage(
  options: {
    config: {
      middleware?: ResolvedFarmConfig["middleware"];
      integrations?: FarmIntegrationsUserConfig;
    };
    middlewareRoutes: readonly { path: string }[];
  },
  pathname: string,
): boolean {
  return (
    appMiddlewareMayHandlePath(
      options.middlewareRoutes.filter((route) => route.path !== "/"),
      pathname,
    ) ||
    pathSpecificConfigMiddlewareCovers(options.config.middleware, pathname) ||
    integrationMiddlewareMayHandlePath(options.config.integrations, pathname, CATCH_ALL_PROBE)
  );
}

/**
 * {@link farmPathGuardCoversPage} for an endpoint served under `/api`, such as an
 * `apiMcp()` server: a guard written for either the `/api` route or its public
 * `api.basePath` form covers it.
 *
 * @internal
 */
export function farmPathGuardCoversEndpoint(
  options: Parameters<typeof farmPathGuardCoversPage>[0],
  path: string,
  apiServerBasePath?: string,
): boolean {
  return createFarmAPIMiddlewarePathnames(apiServerBasePath)(path).some((pathname) =>
    farmPathGuardCoversPage(options, pathname),
  );
}
