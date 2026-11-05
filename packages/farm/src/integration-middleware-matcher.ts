/**
 * Integration middleware path matching, kept apart from ./integrations so the production
 * runtime can ask whether an integration guard covers a path (see middleware/may-handle)
 * without bundling the integration runtime, its storage and ORM loaders, into every server.
 */
import type { ResolvedFarmAPIConfig } from "./api/config";
import { createFarmAPIMiddlewarePathnames, resolveFarmAPIServerBasePath } from "./api/server-path";
import { stripFarmBasePath } from "./base-path";
import { resolveFarmLocalePath } from "./i18n/routing";
import type {
  FarmIntegration,
  FarmIntegrationRouteParams,
  FarmIntegrationsUserConfig,
} from "./integrations";
import {
  compileMiddlewareConfig,
  matchesCompiledMiddlewareConfig,
  type CompiledMiddlewareConfig,
} from "./middleware/matcher";
import type { MiddlewareContext } from "./middleware/types";
import type { FarmPluginContext } from "./plugin";
import { canonicalizeRequestPathname, canonicalizeRequestPathSegments } from "./utils/decode";

export function isFarmIntegration(value: unknown): value is FarmIntegration {
  return (
    !!value && typeof value === "object" && (value as FarmIntegration).kind === "farm-integration"
  );
}

const compiledIntegrationGuards = new WeakMap<object, CompiledMiddlewareConfig>();
const noMiddlewareContext = {} as MiddlewareContext;

/**
 * Integration middleware is a guard (`protectedRoutes` compiles straight into
 * one), documented to take the same matcher syntax as Farm middleware and to
 * see the router's pathname. The integration pattern language alone knows only
 * `(.*)` and `[param]`, so `/dashboard/:path*` or `/api/**` compared as literal
 * text and protected nothing, and `/fr/dashboard` or `/console/dashboard`
 * (basePath) walked past `/dashboard(.*)` while the router served the page.
 * Every step here can only add a match, never remove one.
 */
export function resolveIntegrationMiddlewareParams(
  entry: { matcher?: string | readonly string[] },
  pathname: string,
  config: FarmPluginContext["config"] | undefined,
): FarmIntegrationRouteParams | null {
  const params = resolveMatcherParams(entry.matcher, pathname);
  // A missing matcher already matched everything above.
  if (params || !entry.matcher) return params;

  // A local API route answers at `/api/...` and at the public `api.basePath`, so a guard written
  // for either prefix must see both, the way app middleware does.
  const routePathname = resolveIntegrationRoutePathname(pathname, config);
  const candidates = [...new Set([pathname, ...getIntegrationAPIPathnames(config)(routePathname)])];
  for (const candidate of candidates) {
    if (candidate === pathname) continue;
    const routeParams = resolveMatcherParams(entry.matcher, candidate);
    if (routeParams) return routeParams;
  }

  let compiled = compiledIntegrationGuards.get(entry);
  if (!compiled) {
    compiled = compileMiddlewareConfig({
      matcher: typeof entry.matcher === "string" ? entry.matcher : [...entry.matcher],
    });
    compiledIntegrationGuards.set(entry, compiled);
  }
  for (const candidate of candidates) {
    const result = matchesCompiledMiddlewareConfig(candidate, compiled, noMiddlewareContext);
    if (result.matched) return result.params ?? {};
  }
  return null;
}

/**
 * @internal Whether an integration's middleware matcher (a `protectedRoutes` guard, say)
 * covers `pathname`, a route path without the base path. With `catchAllProbe`, a path no
 * route uses, only matchers naming particular paths count: middleware without a matcher,
 * or one that also meets the probe, covers every path and is left out.
 */
export function integrationMiddlewareMayHandlePath(
  integrations: FarmIntegrationsUserConfig | undefined,
  pathname: string,
  catchAllProbe?: string,
): boolean {
  if (!integrations) return false;
  const covers = (entry: { matcher?: string | readonly string[] }) =>
    resolveIntegrationMiddlewareParams(entry, pathname, undefined) !== null;
  return Object.values(integrations).some(
    (integration) =>
      isFarmIntegration(integration) &&
      (integration.middleware || []).some((entry) => {
        if (catchAllProbe === undefined) return covers(entry);
        if (!entry.matcher) return false;
        const specific = (Array.isArray(entry.matcher) ? entry.matcher : [entry.matcher]).filter(
          (matcher: string) =>
            resolveIntegrationMiddlewareParams({ matcher }, catchAllProbe, undefined) === null,
        );
        return specific.length > 0 && covers({ matcher: specific });
      }),
  );
}

/**
 * @internal Runtime config key holding the app's same-origin API path. The built server keeps the
 * user's raw `api` config, whose values may be resolver functions, so the build records the
 * resolved path here; development configs carry the resolved `api` itself.
 */
export const FARM_INTEGRATION_API_BASE_PATH_KEY = "__farmAPIServerBasePath";

const integrationAPIPathnames = new WeakMap<object, (pathname: string) => readonly string[]>();

function getIntegrationAPIPathnames(
  config: FarmPluginContext["config"] | undefined,
): (pathname: string) => readonly string[] {
  if (!config) return (pathname) => [pathname];
  let toPathnames = integrationAPIPathnames.get(config);
  if (!toPathnames) {
    const recorded = (config as Record<string, unknown>)[FARM_INTEGRATION_API_BASE_PATH_KEY];
    const api = config.api as Partial<ResolvedFarmAPIConfig> | undefined;
    const serverBasePath =
      typeof recorded === "string"
        ? recorded
        : typeof api?.baseURL === "string" && typeof api.basePath === "string"
          ? resolveFarmAPIServerBasePath(api as ResolvedFarmAPIConfig)
          : undefined;
    toPathnames = createFarmAPIMiddlewarePathnames(serverBasePath);
    integrationAPIPathnames.set(config, toPathnames);
  }
  return toPathnames;
}

/** The pathname the page router matches: basePath and locale prefix removed. */
function resolveIntegrationRoutePathname(
  pathname: string,
  config: FarmPluginContext["config"] | undefined,
): string {
  const basePath = typeof config?.basePath === "string" ? config.basePath : undefined;
  let routePathname = basePath ? stripFarmBasePath(pathname, basePath) : pathname;
  const i18n = config?.i18n;
  if (i18n && Array.isArray(i18n.locales) && i18n.locales.length > 0) {
    routePathname = resolveFarmLocalePath(routePathname, {
      locales: i18n.locales,
      defaultLocale: i18n.defaultLocale,
      routing: i18n.routing || "prefix-except-default",
    }).pathname;
  }
  return routePathname;
}

export function resolveMatcherParams(
  matcher: string | readonly string[] | undefined,
  pathname: string,
): FarmIntegrationRouteParams | null {
  if (!matcher) {
    return {};
  }

  const list = Array.isArray(matcher) ? matcher : [matcher];
  // An integration matcher is a guard (`protectedRoutes` compiles straight into
  // one), so it has to see the same pathname the route matchers do. Comparing
  // the raw pathname let `/%64ashboard` miss a `/dashboard` matcher while the
  // page router still served the protected page. Resolved on first use so a
  // match-everything matcher stays allocation free.
  let canonicalPathname: string | undefined;
  let canonicalSegments: string[] | undefined;

  for (const item of list) {
    if (item === "/(.*)" || item === "*") {
      return {};
    }
    if (item.endsWith("(.*)")) {
      canonicalPathname ??= canonicalizeRequestPathname(pathname);
      const prefix = item.slice(0, -4);
      if (canonicalPathname === prefix || canonicalPathname.startsWith(`${prefix}/`)) {
        return {};
      }
      continue;
    }
    canonicalSegments ??= canonicalizeRequestPathSegments(pathname);
    const params = matchPathSegments(splitPath(item), canonicalSegments);
    if (params) {
      return params;
    }
  }

  return null;
}

/**
 * Walk an integration route pattern against already-canonical request segments.
 *
 * `pathSegments` arrive decoded exactly once, so nothing here decodes again: a
 * second pass would turn a literal `%2541BC` segment into `ABC` and resolve a
 * record the request never asked for.
 */
export function matchPathSegments(
  routeSegments: readonly string[],
  pathSegments: readonly string[],
): FarmIntegrationRouteParams | null {
  const params: FarmIntegrationRouteParams = {};

  let routeIndex = 0;
  let pathIndex = 0;

  while (routeIndex < routeSegments.length && pathIndex < pathSegments.length) {
    const routeSegment = routeSegments[routeIndex];
    const pathSegment = pathSegments[pathIndex];

    if (isCatchAllSegment(routeSegment)) {
      params[getSegmentParamName(routeSegment)] = pathSegments.slice(pathIndex);
      return params;
    }

    if (isDynamicSegment(routeSegment)) {
      params[getSegmentParamName(routeSegment)] = pathSegment;
      routeIndex += 1;
      pathIndex += 1;
      continue;
    }

    if (routeSegment !== pathSegment) {
      return null;
    }

    routeIndex += 1;
    pathIndex += 1;
  }

  if (routeIndex === routeSegments.length && pathIndex === pathSegments.length) {
    return params;
  }

  if (routeIndex === routeSegments.length - 1 && isCatchAllSegment(routeSegments[routeIndex])) {
    params[getSegmentParamName(routeSegments[routeIndex])] = [];
    return params;
  }

  return null;
}

export function splitPath(value: string): string[] {
  return value.split("/").filter(Boolean);
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

function isCatchAllSegment(segment: string): boolean {
  return segment.startsWith("[...") && segment.endsWith("]");
}

function getSegmentParamName(segment: string): string {
  if (isCatchAllSegment(segment)) {
    return segment.slice(4, -1);
  }

  return segment.slice(1, -1);
}
