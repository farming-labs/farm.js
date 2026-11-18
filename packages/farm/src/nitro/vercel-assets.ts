import {
  FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
  FARM_IMMUTABLE_ASSET_PATH_SOURCE,
  isFarmImmutableAssetPath,
} from "./immutable-assets";

export { FARM_IMMUTABLE_ASSET_CACHE_CONTROL };

export interface FarmVercelImmutableAssetRoute {
  src: string;
  headers: { "Cache-Control": typeof FARM_IMMUTABLE_ASSET_CACHE_CONTROL };
  continue: true;
  caseSensitive: true;
}

/**
 * Apply immutable caching only to Farm's content-hashed client files, as
 * `isFarmImmutableAssetPath` defines them for every target. Stable entry
 * filenames and HTML are deliberately excluded because they can change between
 * deployments. Hashed client files are served at the root even when a basePath
 * is configured, so the route matches root paths unconditionally.
 */
export function createFarmVercelImmutableAssetRoute(): FarmVercelImmutableAssetRoute {
  return {
    src: FARM_IMMUTABLE_ASSET_PATH_SOURCE,
    headers: {
      "Cache-Control": FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
    },
    continue: true,
    caseSensitive: true,
  };
}

export function isFarmVercelImmutableAssetPath(pathname: string): boolean {
  return isFarmImmutableAssetPath(pathname);
}

export interface FarmVercelRoute {
  handle?: string;
  src?: string;
  dest?: string;
  status?: number;
  headers?: Record<string, string>;
  continue?: boolean;
  caseSensitive?: boolean;
  /** The Edge function Vercel runs as routing middleware for a matching request. */
  middlewarePath?: string;
  middlewareRawSrc?: string[];
}

/**
 * Rebuild the Vercel Build Output `routes` array around Farm's serverless
 * function while preserving the preset-generated source routes.
 *
 * Nitro's Vercel builder emits, before the `filesystem` handler, the redirect
 * and header routes declared through `routeRules` (this is how Farm ships its
 * configured `headers()` and per-prerendered-route cache policy on Vercel), then
 * a blanket immutable public-asset route. Farm previously discarded the whole
 * array, which silently dropped those redirect and header routes on Vercel while
 * they kept working on every other target.
 *
 * We keep the redirect/header source routes, replace the preset's blanket
 * immutable asset route (`continue: true`) with Farm's fingerprint-precise one so
 * stable filenames and HTML are not over-cached, and re-point Farm's runtime,
 * API, and catch-all routes at the `__nitro` function this post-processing
 * creates. Routes after the `filesystem` handler (ISR invocations, observability,
 * the preset's own `/__fallback` catch-all) are intentionally not carried over:
 * Farm keeps ISR routes server-handled, and the preset's catch-all targets a
 * function name Farm does not emit.
 *
 * A matching route without `continue` ends Vercel's routing, and the preset
 * gives each prerendered page a header route without it, so a later route for
 * the same URL is never reached. Routing middleware (`runtime: "edge"`
 * middleware in front of the pages it guards) therefore goes first, ahead of
 * the page's header route and its static file, so it decides every request for
 * the page. Routes that send a prerendered page's other trailing-slash spelling
 * to the server follow the preset's routes, ahead of the static files that
 * would otherwise answer it.
 */
export function buildFarmVercelRoutes(options: {
  presetRoutes: FarmVercelRoute[];
  runtimeRoutes: FarmVercelRoute[];
  middlewareRoutes?: FarmVercelRoute[];
  canonicalSlashRoutes?: FarmVercelRoute[];
}): FarmVercelRoute[] {
  const { presetRoutes, runtimeRoutes, middlewareRoutes = [], canonicalSlashRoutes = [] } = options;
  const filesystemIndex = presetRoutes.findIndex((route) => route.handle === "filesystem");
  const sourceRoutes = filesystemIndex >= 0 ? presetRoutes.slice(0, filesystemIndex) : [];
  // Drop the preset's blanket immutable public-asset routes (the only
  // pre-filesystem routes marked `continue: true`); Farm supplies its own
  // precise immutable route below. Everything else here is a redirect or header
  // route from routeRules and must be preserved.
  const preservedSourceRoutes = sourceRoutes.filter((route) => route.continue !== true);

  return [
    ...middlewareRoutes,
    ...preservedSourceRoutes,
    ...canonicalSlashRoutes,
    createFarmVercelImmutableAssetRoute(),
    { handle: "filesystem" },
    ...runtimeRoutes,
    {
      src: "/(.*)",
      dest: "/__nitro",
    },
  ];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The longest `src` Vercel's Build Output API accepts on a route. */
export const FARM_VERCEL_ROUTE_SOURCE_MAX_LENGTH = 4096;

/**
 * Groups regex alternatives into as few `^(?:a|b|…)$` sources as fit Vercel's limit on a route's
 * `src`, in order. A site with a few hundred prerendered pages outgrows one source, and Vercel
 * then refuses the whole deployment ("Builder returned invalid routes").
 */
export function groupFarmVercelRouteAlternatives<T>(
  items: readonly T[],
  alternative: (item: T) => string,
): Array<{ src: string; items: T[] }> {
  const groups: Array<{ src: string; items: T[] }> = [];
  let current: { parts: string[]; items: T[]; length: number } | null = null;
  // "^(?:" and ")$"
  const frame = 6;
  for (const item of items) {
    const part = alternative(item);
    if (part.length + frame > FARM_VERCEL_ROUTE_SOURCE_MAX_LENGTH) {
      throw new Error(
        `Farm cannot route ${JSON.stringify(part.slice(0, 80))}… on Vercel: its pattern is longer than Vercel's ${FARM_VERCEL_ROUTE_SOURCE_MAX_LENGTH}-character limit for a route. Shorten the page's path.`,
      );
    }
    if (current && current.length + 1 + part.length > FARM_VERCEL_ROUTE_SOURCE_MAX_LENGTH) {
      groups.push({ src: `^(?:${current.parts.join("|")})$`, items: current.items });
      current = null;
    }
    if (!current) current = { parts: [], items: [], length: frame - 1 };
    current.parts.push(part);
    current.items.push(item);
    current.length += 1 + part.length;
  }
  if (current) groups.push({ src: `^(?:${current.parts.join("|")})$`, items: current.items });
  return groups;
}

/**
 * The route that sends the other trailing-slash spelling of each prerendered page to Farm's
 * server. Vercel can answer either spelling with the page's `index.html`, so without it a static
 * page answers both, where Farm's server answers the spelling `trailingSlash` does not
 * choose with a 308 to the one it does (keeping the query), as it does for every dynamic page.
 * `publicPaths` are the URLs the pages were prerendered at, already in the configured spelling.
 * Many pages take several routes: Vercel limits the length of each.
 */
export function createFarmVercelCanonicalSlashRoutes(
  publicPaths: readonly string[],
): FarmVercelRoute[] {
  const otherSpellings = [
    ...new Set(
      publicPaths
        .filter((pathname) => pathname !== "/")
        .map((pathname) => (pathname.endsWith("/") ? pathname.replace(/\/+$/, "") : `${pathname}/`))
        .filter((pathname) => pathname !== ""),
    ),
  ];
  return groupFarmVercelRouteAlternatives(otherSpellings, escapeRegExp).map((group) => ({
    src: group.src,
    dest: "/__nitro",
  }));
}
