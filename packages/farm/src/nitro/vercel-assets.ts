export const FARM_IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable" as const;

export interface FarmVercelImmutableAssetRoute {
  src: string;
  headers: { "Cache-Control": typeof FARM_IMMUTABLE_ASSET_CACHE_CONTROL };
  continue: true;
  caseSensitive: true;
}

/**
 * Apply immutable caching only to Farm/Vite filenames carrying Farm's `-h`
 * content-fingerprint marker. Stable entry filenames and HTML are deliberately
 * excluded because they can change between deployments. The fingerprinted
 * client entry lives at the public root — its relative chunk imports pin it
 * there — so root-level farm-client-h files qualify alongside assets/chunks.
 *
 * Hashed client assets are emitted and served at the root even when a
 * basePath is configured — the client build sets no Vite `base` and Nitro
 * mounts the client output at "/" — so the route matches root paths
 * unconditionally.
 */
export function createFarmVercelImmutableAssetRoute(): FarmVercelImmutableAssetRoute {
  const fingerprint = "-h(?:[a-fA-F0-9]{8}|[a-fA-F0-9]{12}|[a-fA-F0-9]{16})";

  return {
    src: `^/(?:(?:assets|chunks)/(?:.+/)*[^/]+|farm-client)${fingerprint}\\.(?!(?:[hH][tT][mM][lL]?)$)[^/]+$`,
    headers: {
      "Cache-Control": FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
    },
    continue: true,
    caseSensitive: true,
  };
}

export function isFarmVercelImmutableAssetPath(pathname: string): boolean {
  return new RegExp(createFarmVercelImmutableAssetRoute().src).test(pathname);
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
 * Routing middleware (`runtime: "edge"` middleware in front of the pages it
 * guards) goes after the redirect and header routes and before `filesystem`,
 * so it decides a request before Vercel serves a static file. Routes that send
 * a prerendered page's other trailing-slash spelling to the server come next,
 * also ahead of the static files that would otherwise answer it.
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
    ...preservedSourceRoutes,
    ...middlewareRoutes,
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

/**
 * The route that sends the other trailing-slash spelling of each prerendered page to Farm's
 * server. Vercel can answer either spelling with the page's `index.html`, so without it a static
 * page answers both, where Farm's server answers the spelling `trailingSlash` does not
 * choose with a 308 to the one it does (keeping the query), as it does for every dynamic page.
 * `publicPaths` are the URLs the pages were prerendered at, already in the configured spelling.
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
  if (otherSpellings.length === 0) return [];
  return [{ src: `^(?:${otherSpellings.map(escapeRegExp).join("|")})$`, dest: "/__nitro" }];
}
