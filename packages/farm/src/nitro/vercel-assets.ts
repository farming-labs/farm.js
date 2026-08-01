export const FARM_IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable" as const;

export interface FarmVercelImmutableAssetRoute {
  src: string;
  headers: { "Cache-Control": typeof FARM_IMMUTABLE_ASSET_CACHE_CONTROL };
  continue: true;
  caseSensitive: true;
}

/**
 * Apply immutable caching only to Farm/Vite filenames that end in either the
 * default eight-character URL-safe build hash or Farm's longer hexadecimal
 * fingerprints. Stable entry filenames and HTML are deliberately excluded
 * because they can change between deployments.
 */
export function createFarmVercelImmutableAssetRoute(basePath = "/"): FarmVercelImmutableAssetRoute {
  const normalizedBasePath = normalizeBasePath(basePath);
  const escapedBasePath = escapeRegex(normalizedBasePath);
  const prefix = escapedBasePath ? `/${escapedBasePath}` : "";

  return {
    src: `^${prefix}/(?:assets|chunks)/(?:.+/)*[^/]+-(?:[A-Za-z0-9_]{8}|(?=[A-Za-z0-9_-]{8}\\.)(?=[A-Za-z0-9_-]*[A-Z0-9_])[A-Za-z0-9_-]{8}|[a-fA-F0-9]{12,})\\.(?!(?:[hH][tT][mM][lL]?)$)[^/]+$`,
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
