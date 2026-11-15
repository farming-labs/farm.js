import {
  DEFAULT_FARM_API_BASE_PATH,
  normalizeFarmAPIBasePath,
  resolveFarmAPIRequestURL,
  type ResolvedFarmAPIConfig,
} from "./config";

/** Return the same-origin path served by this Farm application. */
export function resolveFarmAPIServerBasePath(config: ResolvedFarmAPIConfig): string {
  // Absolute API URLs belong to another origin and must not move local routes.
  return config.baseURL.startsWith("/") ? config.basePath : DEFAULT_FARM_API_BASE_PATH;
}

/** Translate a public local API pathname back to Farm's canonical `/api` route table. */
export function resolveFarmAPICanonicalPathname(
  pathname: string,
  serverBasePath = DEFAULT_FARM_API_BASE_PATH,
): string {
  const basePath = normalizeFarmAPIBasePath(serverBasePath);
  if (basePath === DEFAULT_FARM_API_BASE_PATH) return pathname;

  if (basePath === "/") {
    return pathname === "/"
      ? DEFAULT_FARM_API_BASE_PATH
      : `${DEFAULT_FARM_API_BASE_PATH}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }

  if (pathname === basePath) return DEFAULT_FARM_API_BASE_PATH;
  if (pathname.startsWith(`${basePath}/`)) {
    return `${DEFAULT_FARM_API_BASE_PATH}${pathname.slice(basePath.length)}`;
  }
  return pathname;
}

/**
 * @internal The pathnames middleware matches for one request. A local API route answers at its
 * canonical `/api` path and at the configured public path, so a `src/app/api/**` middleware file
 * (named for the canonical path) and a config matcher written for either form guard both.
 */
export function createFarmAPIMiddlewarePathnames(
  serverBasePath = DEFAULT_FARM_API_BASE_PATH,
): (pathname: string) => readonly string[] {
  const basePath = normalizeFarmAPIBasePath(serverBasePath);
  if (basePath === DEFAULT_FARM_API_BASE_PATH) return (pathname) => [pathname];

  const prefix = DEFAULT_FARM_API_BASE_PATH;
  return (pathname) => {
    const canonical = resolveFarmAPICanonicalPathname(pathname, basePath);
    if (canonical !== prefix && !canonical.startsWith(`${prefix}/`)) return [pathname];
    const suffix = canonical.slice(prefix.length);
    const publicPath = basePath === "/" ? suffix || "/" : `${basePath}${suffix}`;
    return [...new Set([pathname, canonical, publicPath])];
  };
}

/** Resolve a canonical `/api` route to the path served by this application. */
export function resolveFarmAPIServerRoutePath(
  routePath: string,
  serverBasePath = DEFAULT_FARM_API_BASE_PATH,
): string {
  return resolveFarmAPIRequestURL(routePath, serverBasePath).pathname;
}
