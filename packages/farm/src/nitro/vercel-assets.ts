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
