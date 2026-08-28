export type PwaDuration = number | `${number}${"s" | "m" | "h" | "d" | "w"}`;

export interface PwaImageCacheOptions {
  /** Show the cached image immediately and refresh it in the background. */
  strategy: "swr";
  /** Maximum number of public image responses retained in Cache Storage. */
  limit?: number;
  /** How long a cached image remains fresh. Numbers are milliseconds. */
  ttl?: PwaDuration;
}

export type PwaImageCache = boolean | "swr" | PwaImageCacheOptions;

export interface PwaCacheOptions {
  /** Precache every emitted static page, selected routes, or no static pages. */
  staticRoutes?: boolean | string[];
  /** Opt in to same-origin public image caching. */
  images?: PwaImageCache;
}

export interface PwaPluginOptions {
  /** Set false to keep the plugin registered without emitting or registering a worker. */
  enabled?: boolean;
  /** Static route to serve after an offline navigation misses the cache. */
  offline?: string | false;
  /** How a waiting service worker becomes active. */
  update?: "prompt" | "auto";
  /** Automatic caching, a custom cache policy, or build assets only. */
  cache?: "auto" | "recommended" | PwaCacheOptions | false;
}

export interface ResolvedPwaImageCacheOptions {
  strategy: "swr";
  limit: number;
  ttlMs: number;
}

export interface ResolvedPwaOptions {
  enabled: boolean;
  offline: string | false;
  update: "prompt" | "auto";
  cache: {
    staticRoutes: boolean | string[];
    images: ResolvedPwaImageCacheOptions | false;
  };
}

const DEFAULT_IMAGE_LIMIT = 100;
const DEFAULT_IMAGE_TTL = "30d";

export function resolvePwaOptions(options: PwaPluginOptions = {}): ResolvedPwaOptions {
  const cache = options.cache ?? "auto";
  const usesAutomaticCache = cache === "auto" || cache === "recommended";
  const customCache = typeof cache === "object" ? cache : undefined;

  return {
    enabled: options.enabled !== false,
    offline: normalizeRoute(options.offline ?? false, "offline"),
    update: options.update ?? "prompt",
    cache: {
      staticRoutes: usesAutomaticCache
        ? true
        : cache === false
          ? false
          : normalizeStaticRoutes(customCache?.staticRoutes ?? false),
      images: usesAutomaticCache
        ? resolveImageCache("swr")
        : cache === false
          ? false
          : resolveImageCache(customCache?.images ?? false),
    },
  };
}

export function parsePwaDuration(value: PwaDuration): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError("PWA cache ttl must be a positive finite number");
    }
    return value;
  }

  const match = /^(\d+(?:\.\d+)?)(s|m|h|d|w)$/.exec(value);
  if (!match) {
    throw new TypeError('PWA cache ttl must use a duration such as "30s", "5m", "2h", or "30d"');
  }

  const amount = Number(match[1]);
  if (amount <= 0) {
    throw new TypeError("PWA cache ttl must be a positive duration");
  }
  const multiplier = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  }[match[2] as "s" | "m" | "h" | "d" | "w"];

  return amount * multiplier;
}

function resolveImageCache(value: PwaImageCache): ResolvedPwaImageCacheOptions | false {
  if (value === false) return false;
  if (value !== true && value !== "swr" && value.strategy !== "swr") {
    throw new TypeError('PWA image cache strategy must be "swr"');
  }

  const configured = typeof value === "object" ? value : undefined;
  const limit = configured?.limit ?? DEFAULT_IMAGE_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError("PWA image cache limit must be a positive integer");
  }

  return {
    strategy: "swr",
    limit,
    ttlMs: parsePwaDuration(configured?.ttl ?? DEFAULT_IMAGE_TTL),
  };
}

function normalizeStaticRoutes(value: boolean | string[]): boolean | string[] {
  if (!Array.isArray(value)) return value;
  return [...new Set(value.map((route) => normalizeRoute(route, "static route")))];
}

function normalizeRoute(value: string, label: string): string;
function normalizeRoute(value: false, label: string): false;
function normalizeRoute(value: string | false, label: string): string | false;
function normalizeRoute(value: string | false, label: string): string | false {
  if (value === false) return false;
  const route = value.trim();
  if (!route.startsWith("/")) {
    throw new TypeError(`PWA ${label} must start with "/"`);
  }
  if (route.includes("?") || route.includes("#")) {
    throw new TypeError(`PWA ${label} cannot contain a query string or fragment`);
  }
  return route === "/" ? route : route.replace(/\/+$/, "");
}
