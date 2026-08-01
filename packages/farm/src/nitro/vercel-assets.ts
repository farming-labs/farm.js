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
 * excluded because they can change between deployments.
 */
export function createFarmVercelImmutableAssetRoute(basePath = "/"): FarmVercelImmutableAssetRoute {
  const normalizedBasePath = normalizeBasePath(basePath);
  const escapedBasePath = escapeRegex(normalizedBasePath);
  const prefix = escapedBasePath ? `/${escapedBasePath}` : "";

  return {
    src: `^${prefix}/(?:assets|chunks)/(?:.+/)*[^/]+-h(?:[a-fA-F0-9]{8}|[a-fA-F0-9]{12}|[a-fA-F0-9]{16})\\.(?!(?:[hH][tT][mM][lL]?)$)[^/]+$`,
    headers: {
      "Cache-Control": FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
    },
    continue: true,
    caseSensitive: true,
  };
}

export function isFarmVercelImmutableAssetPath(pathname: string, basePath = "/"): boolean {
  return new RegExp(createFarmVercelImmutableAssetRoute(basePath).src).test(pathname);
}

function normalizeBasePath(basePath: string): string {
  return basePath.trim().replace(/^\/+|\/+$/g, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
