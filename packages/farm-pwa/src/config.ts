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

export interface PwaServiceWorkerOptions {
  /** JavaScript file copied verbatim into the production output as sw.js. */
  source: string;
  /** Registration type for the custom worker. */
  type?: "classic" | "module";
}

export interface PwaPluginOptions {
  /** Static route to serve after an offline navigation misses the cache. */
  offline?: string | false;
  /** How a waiting service worker becomes active. */
  update?: "prompt" | "auto";
  /** Generated-worker caching, a custom cache policy, or build assets only. */
  cache?: "auto" | "recommended" | PwaCacheOptions | false;
  /** Copy and register a prebuilt service worker instead of generating one. */
  serviceWorker?: PwaServiceWorkerOptions;
}

export interface ResolvedPwaImageCacheOptions {
  strategy: "swr";
  limit: number;
  ttlMs: number;
}

export interface ResolvedPwaOptions {
  offline: string | false;
  update: "prompt" | "auto";
  serviceWorker: Required<PwaServiceWorkerOptions> | false;
  cache: {
    staticRoutes: boolean | string[];
    images: ResolvedPwaImageCacheOptions | false;
  };
}

const DEFAULT_IMAGE_LIMIT = 100;
const DEFAULT_IMAGE_TTL = "30d";

export function resolvePwaOptions(options: PwaPluginOptions = {}): ResolvedPwaOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("PWA options must be an object");
  }
  if ("enabled" in options) {
    throw new TypeError("PWA no longer accepts enabled; remove pwa() from plugins to disable it");
  }
  if (
    options.offline !== undefined &&
    options.offline !== false &&
    typeof options.offline !== "string"
  ) {
    throw new TypeError('PWA offline must be a route starting with "/" or false');
  }
  if (options.update !== undefined && options.update !== "prompt" && options.update !== "auto") {
    throw new TypeError('PWA update must be "prompt" or "auto"');
  }

  const serviceWorker = resolveServiceWorker(options.serviceWorker);
  if (serviceWorker && (options.offline !== undefined || options.cache !== undefined)) {
    throw new TypeError(
      "PWA serviceWorker cannot be combined with offline or cache because the custom worker owns those behaviors",
    );
  }

  const configuredCache = options.cache;
  if (
    configuredCache !== undefined &&
    configuredCache !== false &&
    configuredCache !== "auto" &&
    configuredCache !== "recommended" &&
    (!configuredCache || typeof configuredCache !== "object" || Array.isArray(configuredCache))
  ) {
    throw new TypeError('PWA cache must be "auto", "recommended", an options object, or false');
  }
  const cache = configuredCache ?? "auto";
  const usesAutomaticCache = cache === "auto" || cache === "recommended";
  const customCache = typeof cache === "object" ? cache : undefined;

  return {
    offline: serviceWorker ? false : normalizeRoute(options.offline ?? false, "offline"),
    update: options.update ?? "prompt",
    serviceWorker,
    cache: {
      staticRoutes: serviceWorker
        ? false
        : usesAutomaticCache
          ? true
          : cache === false
            ? false
            : normalizeStaticRoutes(
                customCache?.staticRoutes === undefined ? false : customCache.staticRoutes,
              ),
      images: serviceWorker
        ? false
        : usesAutomaticCache
          ? resolveImageCache("swr")
          : cache === false
            ? false
            : resolveImageCache(customCache?.images === undefined ? false : customCache.images),
    },
  };
}

function resolveServiceWorker(
  value: PwaServiceWorkerOptions | undefined,
): Required<PwaServiceWorkerOptions> | false {
  if (value === undefined) return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("PWA serviceWorker must be an options object");
  }
  if (typeof value.source !== "string") {
    throw new TypeError("PWA serviceWorker source must be a non-empty path");
  }
  const source = value.source.trim();
  if (!source) throw new TypeError("PWA serviceWorker source must be a non-empty path");
  if (value.type !== undefined && value.type !== "classic" && value.type !== "module") {
    throw new TypeError('PWA serviceWorker type must be "classic" or "module"');
  }
  return { source, type: value.type ?? "classic" };
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
  if (
    value !== true &&
    value !== "swr" &&
    (!value || typeof value !== "object" || Array.isArray(value) || value.strategy !== "swr")
  ) {
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
  if (typeof value === "boolean") return value;
  if (!Array.isArray(value)) {
    throw new TypeError("PWA cache staticRoutes must be boolean or an array of routes");
  }
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
