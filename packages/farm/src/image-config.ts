export const DEFAULT_FARM_IMAGE_PATH = "/_farm/image";
export const DEFAULT_FARM_IMAGE_DEVICE_SIZES = [
  640, 750, 828, 1080, 1200, 1920, 2048, 3840,
] as const;
export const DEFAULT_FARM_IMAGE_SIZES = [16, 32, 48, 64, 96, 128, 256, 384] as const;
export const DEFAULT_FARM_IMAGE_QUALITIES = [75] as const;
export const DEFAULT_FARM_IMAGE_FORMATS = ["image/webp"] as const;

export type FarmImageFormat = "image/avif" | "image/webp";
export type FarmImageProvider = "auto" | "node" | "cloudflare" | "none";

export interface FarmImageRemotePattern {
  protocol?: "http" | "https";
  hostname: string;
  port?: string;
  pathname?: string;
  search?: string;
}

export interface FarmImageLocalPattern {
  pathname: string;
  search?: string;
}

export interface FarmImageConfig {
  /** Runtime optimizer. Auto selects Cloudflare Images on Cloudflare and Sharp elsewhere. */
  provider?: FarmImageProvider;
  /** Public optimizer endpoint. */
  path?: string;
  /** @deprecated Prefer remotePatterns, which also restricts protocol, path, port, and query. */
  domains?: readonly string[];
  remotePatterns?: readonly FarmImageRemotePattern[];
  localPatterns?: readonly FarmImageLocalPattern[];
  deviceSizes?: readonly number[];
  imageSizes?: readonly number[];
  qualities?: readonly number[];
  formats?: readonly FarmImageFormat[];
  minimumCacheTTL?: number;
  maximumResponseBody?: number | string;
  maximumRedirects?: number;
  dangerouslyAllowSVG?: boolean;
  dangerouslyAllowLocalIP?: boolean;
}

export interface ResolvedFarmImageConfig {
  provider: FarmImageProvider;
  path: string;
  domains: readonly string[];
  remotePatterns: readonly FarmImageRemotePattern[];
  localPatterns: readonly FarmImageLocalPattern[];
  deviceSizes: readonly number[];
  imageSizes: readonly number[];
  qualities: readonly number[];
  formats: readonly FarmImageFormat[];
  minimumCacheTTL: number;
  maximumResponseBody: number;
  maximumRedirects: number;
  dangerouslyAllowSVG: boolean;
  dangerouslyAllowLocalIP: boolean;
}

export type PublicFarmImageConfig = Pick<
  ResolvedFarmImageConfig,
  "provider" | "path" | "deviceSizes" | "imageSizes" | "qualities" | "formats"
>;

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  kib: 1_024,
  mib: 1_048_576,
  gib: 1_073_741_824,
};

export function resolveFarmImageConfig(
  config: FarmImageConfig | undefined,
): ResolvedFarmImageConfig {
  const path = normalizeImagePath(config?.path ?? DEFAULT_FARM_IMAGE_PATH);
  const deviceSizes = normalizeIntegerList(
    config?.deviceSizes ?? DEFAULT_FARM_IMAGE_DEVICE_SIZES,
    "images.deviceSizes",
  );
  const imageSizes = normalizeIntegerList(
    config?.imageSizes ?? DEFAULT_FARM_IMAGE_SIZES,
    "images.imageSizes",
  );
  const qualities = normalizeIntegerList(
    config?.qualities ?? DEFAULT_FARM_IMAGE_QUALITIES,
    "images.qualities",
    100,
  );
  const formats = [...new Set(config?.formats ?? DEFAULT_FARM_IMAGE_FORMATS)];

  if (formats.some((format) => format !== "image/avif" && format !== "image/webp")) {
    throw new TypeError('images.formats only supports "image/avif" and "image/webp"');
  }

  const minimumCacheTTL = normalizeNonNegativeInteger(
    config?.minimumCacheTTL ?? 60,
    "images.minimumCacheTTL",
  );
  const maximumRedirects = normalizeNonNegativeInteger(
    config?.maximumRedirects ?? 3,
    "images.maximumRedirects",
  );

  return Object.freeze({
    provider: config?.provider ?? "auto",
    path,
    domains: Object.freeze([
      ...new Set((config?.domains ?? []).map((domain) => domain.trim().toLowerCase())),
    ]),
    remotePatterns: Object.freeze(
      (config?.remotePatterns ?? []).map((pattern) => normalizeRemotePattern(pattern)),
    ),
    localPatterns: Object.freeze(
      (config?.localPatterns ?? [{ pathname: "/**" }]).map((pattern) =>
        normalizeLocalPattern(pattern),
      ),
    ),
    deviceSizes: Object.freeze(deviceSizes),
    imageSizes: Object.freeze(imageSizes),
    qualities: Object.freeze(qualities),
    formats: Object.freeze(formats),
    minimumCacheTTL,
    maximumResponseBody: parseSize(
      config?.maximumResponseBody ?? "10mb",
      "images.maximumResponseBody",
    ),
    maximumRedirects,
    dangerouslyAllowSVG: config?.dangerouslyAllowSVG ?? false,
    dangerouslyAllowLocalIP: config?.dangerouslyAllowLocalIP ?? false,
  });
}

export function getPublicFarmImageConfig(
  config: Pick<ResolvedFarmImageConfig, keyof PublicFarmImageConfig>,
): PublicFarmImageConfig {
  return {
    provider: config.provider,
    path: config.path,
    deviceSizes: config.deviceSizes,
    imageSizes: config.imageSizes,
    qualities: config.qualities,
    formats: config.formats,
  };
}

function normalizeImagePath(value: string): string {
  const path = value.trim().replace(/\/+$/, "") || "/";
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new TypeError("images.path must be an absolute pathname without a query or hash");
  }
  return path;
}

function normalizeIntegerList(values: readonly number[], name: string, max?: number): number[] {
  if (values.length === 0) {
    throw new TypeError(`${name} must contain at least one value`);
  }

  const normalized = [...new Set(values)].sort((left, right) => left - right);
  for (const value of normalized) {
    if (!Number.isSafeInteger(value) || value <= 0 || (max !== undefined && value > max)) {
      throw new TypeError(
        `${name} must contain positive integers${max ? ` no greater than ${max}` : ""}`,
      );
    }
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function parseSize(value: number | string, name: string): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
    return value;
  }

  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|kib|mib|gib)$/);
  if (!match) {
    throw new TypeError(`${name} must be bytes or a size string such as "5mb"`);
  }

  const bytes = Number(match[1]) * SIZE_UNITS[match[2]];
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new TypeError(`${name} must resolve to a positive safe integer`);
  }
  return bytes;
}

function normalizeRemotePattern(pattern: FarmImageRemotePattern): FarmImageRemotePattern {
  const hostname = pattern.hostname.trim().toLowerCase();
  if (!hostname || hostname.includes("/") || hostname.includes(":")) {
    throw new TypeError("images.remotePatterns[].hostname must be a hostname or wildcard hostname");
  }
  if (pattern.pathname && !pattern.pathname.startsWith("/")) {
    throw new TypeError("images.remotePatterns[].pathname must start with /");
  }
  if (pattern.search && !pattern.search.startsWith("?")) {
    throw new TypeError("images.remotePatterns[].search must start with ?");
  }
  return Object.freeze({ ...pattern, hostname });
}

function normalizeLocalPattern(pattern: FarmImageLocalPattern): FarmImageLocalPattern {
  if (!pattern.pathname.startsWith("/")) {
    throw new TypeError("images.localPatterns[].pathname must start with /");
  }
  if (pattern.search && !pattern.search.startsWith("?")) {
    throw new TypeError("images.localPatterns[].search must start with ?");
  }
  return Object.freeze({ ...pattern });
}
