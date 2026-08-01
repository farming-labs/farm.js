export const FARM_IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable" as const;

export interface FarmVercelImmutableAssetRoute {
  src: string;
  headers: { "Cache-Control": typeof FARM_IMMUTABLE_ASSET_CACHE_CONTROL };
  continue: true;
}

/**
 * Apply immutable caching only to Farm/Vite filenames that end in an
 * eight-or-more-character content hash. Stable entry filenames and HTML are
 * deliberately excluded because they can change between deployments.
 */
export function createFarmVercelImmutableAssetRoute(basePath = "/"): FarmVercelImmutableAssetRoute {
  const normalizedBasePath = normalizeBasePath(basePath);
  const escapedBasePath = escapeRegex(normalizedBasePath);
  const prefix = escapedBasePath ? `/${escapedBasePath}` : "";

  return {
    src: `^${prefix}/(?:assets|chunks)/(?:.+/)*[^/]+-[A-Za-z0-9_]{8,}\\.(?:js|mjs|cjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico)$`,
    headers: {
      "Cache-Control": FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
    },
    continue: true,
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
