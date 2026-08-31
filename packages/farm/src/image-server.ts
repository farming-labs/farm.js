import type {
  FarmImageFormat,
  FarmImageLocalPattern,
  FarmImageRemotePattern,
  ResolvedFarmImageConfig,
} from "./image-config";

export interface FarmImageTransformInput {
  source: Uint8Array;
  sourceUrl: URL;
  sourceType: string;
  width: number;
  quality: number;
  accept: string;
  formats: readonly FarmImageFormat[];
  signal: AbortSignal;
}

export interface FarmImageTransformResult {
  body: Uint8Array;
  contentType: string;
}

export type FarmImageTransformer = (
  input: FarmImageTransformInput,
) => Promise<FarmImageTransformResult>;

export interface CreateFarmImageHandlerOptions {
  fetch?: typeof globalThis.fetch;
  transform: FarmImageTransformer;
  validateRemoteUrl?: (url: URL) => void | Promise<void>;
  onError?: (error: unknown, request: Request) => void;
  cacheEntries?: number;
}

export type FarmImageHandler = (request: Request) => Promise<Response | null>;

type OptimizedImage = FarmImageTransformResult & {
  etag: string;
  cacheControl: string;
  expiresAt: number;
};

type FarmImageRequestErrorCode =
  | "BODY_TOO_LARGE"
  | "DISALLOWED_SOURCE"
  | "INVALID_METHOD"
  | "INVALID_PARAMETER"
  | "PRIVATE_SOURCE"
  | "TOO_MANY_REDIRECTS"
  | "UNSUPPORTED_IMAGE";

export class FarmImageRequestError extends Error {
  readonly code: FarmImageRequestErrorCode;
  readonly status: number;

  constructor(code: FarmImageRequestErrorCode, status: number, message: string) {
    super(message);
    this.name = "FarmImageRequestError";
    this.code = code;
    this.status = status;
  }
}

export function createFarmImageHandler(
  config: ResolvedFarmImageConfig,
  options: CreateFarmImageHandlerOptions,
): FarmImageHandler {
  const fetcher = options.fetch ?? globalThis.fetch;
  const cache = new FarmImageMemoryCache(options.cacheEntries ?? 100);
  const allowedWidths = new Set([...config.deviceSizes, ...config.imageSizes]);
  const allowedQualities = new Set(config.qualities);

  return async function handleFarmImage(request): Promise<Response | null> {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname !== config.path) return null;

    try {
      if (config.provider === "none") {
        throw new FarmImageRequestError(
          "DISALLOWED_SOURCE",
          404,
          "The Farm image optimizer is disabled",
        );
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new FarmImageRequestError(
          "INVALID_METHOD",
          405,
          "The Farm image optimizer only accepts GET and HEAD",
        );
      }

      const sourceUrl = await resolveImageSourceUrl(requestUrl, config, options.validateRemoteUrl);
      const width = parseAllowedInteger(requestUrl.searchParams.get("w"), allowedWidths, "width");
      const quality = parseAllowedInteger(
        requestUrl.searchParams.get("q"),
        allowedQualities,
        "quality",
      );
      const accept = request.headers.get("accept") ?? "";
      const cacheKey = `${sourceUrl.href}\n${width}\n${quality}\n${accept}`;
      let optimized = cache.get(cacheKey);

      if (!optimized) {
        const fetchedSource = await fetchImageSource(
          sourceUrl,
          requestUrl.origin,
          config,
          fetcher,
          options.validateRemoteUrl,
          request.signal,
        );
        const source = await readResponseWithLimit(
          fetchedSource.response,
          config.maximumResponseBody,
        );
        const sourceType = detectImageContentType(source);
        validateSourceType(sourceType, config);
        throwIfAborted(request.signal);

        const result = await options.transform({
          source,
          sourceUrl: fetchedSource.url,
          sourceType,
          width,
          quality,
          accept,
          formats: config.formats,
          signal: request.signal,
        });
        throwIfAborted(request.signal);
        validateTransformedResult(result, config);

        optimized = {
          ...result,
          etag: createImageEtag(result.body),
          cacheControl: `public, max-age=${config.minimumCacheTTL}, stale-while-revalidate=${Math.max(
            config.minimumCacheTTL,
            60,
          )}`,
          expiresAt: Date.now() + config.minimumCacheTTL * 1_000,
        };
        cache.set(cacheKey, optimized);
      }

      return createOptimizedImageResponse(request, optimized, config);
    } catch (error) {
      if (!(error instanceof FarmImageRequestError) && !isAbortError(error)) {
        options.onError?.(error, request);
      }
      return createFarmImageErrorResponse(error);
    }
  };
}

export function createCloudflareImageTransformer(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): FarmImageTransformer {
  return async ({ sourceUrl, width, quality, accept, formats, signal }) => {
    const format = selectOutputFormat(accept, formats);
    const response = await fetcher(sourceUrl, {
      signal,
      headers: { accept: "image/*" },
      cf: {
        image: {
          fit: "scale-down",
          width,
          quality,
          ...(format ? { format: format === "image/avif" ? "avif" : "webp" } : {}),
        },
      },
    } as RequestInit);

    if (!response.ok) {
      throw new FarmImageRequestError(
        "UNSUPPORTED_IMAGE",
        response.status === 404 ? 404 : 502,
        "Cloudflare could not transform the source image",
      );
    }

    const body = new Uint8Array(await response.arrayBuffer());
    return {
      body,
      contentType:
        normalizeImageContentType(response.headers.get("content-type")) ||
        detectImageContentType(body),
    };
  };
}

export function selectOutputFormat(
  accept: string,
  formats: readonly FarmImageFormat[],
): FarmImageFormat | undefined {
  const qualityByFormat = new Map<string, number>();

  for (const range of accept.split(",")) {
    const [rawType, ...parameters] = range.split(";");
    const type = rawType.trim().toLowerCase();
    if (!type) continue;

    let quality = 1;
    for (const parameter of parameters) {
      const [rawName, rawValue] = parameter.split("=", 2);
      if (rawName.trim().toLowerCase() !== "q") continue;
      const parsed = Number(rawValue?.trim());
      quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
      break;
    }

    qualityByFormat.set(type, Math.max(qualityByFormat.get(type) ?? 0, quality));
  }

  let selected: FarmImageFormat | undefined;
  let selectedQuality = 0;
  for (const format of formats) {
    const quality = qualityByFormat.get(format) ?? 0;
    if (quality > selectedQuality) {
      selected = format;
      selectedQuality = quality;
    }
  }
  return selected;
}

export function isPrivateImageAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "::" || value === "::1") return true;
  if (/^(?:fc|fd)[0-9a-f]{2}:/.test(value) || /^fe[89ab][0-9a-f]:/.test(value)) return true;
  if (value.startsWith("::ffff:")) return isPrivateImageAddress(value.slice(7));

  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return false;

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function parseAllowedInteger(
  raw: string | null,
  allowed: ReadonlySet<number>,
  name: string,
): number {
  if (!raw || !/^\d+$/.test(raw)) {
    throw new FarmImageRequestError(
      "INVALID_PARAMETER",
      400,
      `Image ${name} must be an allowed integer`,
    );
  }
  const value = Number(raw);
  if (!allowed.has(value)) {
    throw new FarmImageRequestError("INVALID_PARAMETER", 400, `Image ${name} is not configured`);
  }
  return value;
}

async function resolveImageSourceUrl(
  requestUrl: URL,
  config: ResolvedFarmImageConfig,
  validateRemoteUrl: CreateFarmImageHandlerOptions["validateRemoteUrl"],
): Promise<URL> {
  const raw = requestUrl.searchParams.get("url");
  if (!raw || raw.length > 4096 || raw.startsWith("//")) {
    throw new FarmImageRequestError("INVALID_PARAMETER", 400, "Invalid image source URL");
  }

  let sourceUrl: URL;
  try {
    sourceUrl = raw.startsWith("/") ? new URL(raw, requestUrl.origin) : new URL(raw);
  } catch {
    throw new FarmImageRequestError("INVALID_PARAMETER", 400, "Invalid image source URL");
  }

  await validateImageSourceUrl(sourceUrl, requestUrl.origin, config, validateRemoteUrl);
  return sourceUrl;
}

async function validateImageSourceUrl(
  sourceUrl: URL,
  requestOrigin: string,
  config: ResolvedFarmImageConfig,
  validateRemoteUrl: CreateFarmImageHandlerOptions["validateRemoteUrl"],
): Promise<void> {
  if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") {
    throw new FarmImageRequestError("DISALLOWED_SOURCE", 400, "Unsupported image protocol");
  }
  if (sourceUrl.username || sourceUrl.password || sourceUrl.hash) {
    throw new FarmImageRequestError("DISALLOWED_SOURCE", 400, "Unsafe image source URL");
  }

  if (sourceUrl.origin === requestOrigin) {
    if (
      sourceUrl.pathname === config.path ||
      !matchesLocalPatterns(sourceUrl, config.localPatterns)
    ) {
      throw new FarmImageRequestError(
        "DISALLOWED_SOURCE",
        400,
        "Local image source is not allowed",
      );
    }
    return;
  }

  if (!matchesRemoteSource(sourceUrl, config)) {
    throw new FarmImageRequestError("DISALLOWED_SOURCE", 400, "Remote image source is not allowed");
  }
  if (!config.dangerouslyAllowLocalIP && isPrivateImageAddress(sourceUrl.hostname)) {
    throw new FarmImageRequestError("PRIVATE_SOURCE", 400, "Private image source is not allowed");
  }
  if (!config.dangerouslyAllowLocalIP) {
    await validateRemoteUrl?.(sourceUrl);
  }
}

async function fetchImageSource(
  initialUrl: URL,
  requestOrigin: string,
  config: ResolvedFarmImageConfig,
  fetcher: typeof globalThis.fetch,
  validateRemoteUrl: CreateFarmImageHandlerOptions["validateRemoteUrl"],
  signal: AbortSignal,
): Promise<{ response: Response; url: URL }> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; ; redirectCount += 1) {
    throwIfAborted(signal);
    const response = await fetcher(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        "user-agent": "Farm.js Image Optimizer",
      },
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) {
        throw new FarmImageRequestError(
          "UNSUPPORTED_IMAGE",
          response.status === 404 ? 404 : 502,
          "Could not fetch source image",
        );
      }
      return { response, url: currentUrl };
    }

    if (redirectCount >= config.maximumRedirects) {
      throw new FarmImageRequestError(
        "TOO_MANY_REDIRECTS",
        400,
        "Source image exceeded the redirect limit",
      );
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new FarmImageRequestError("UNSUPPORTED_IMAGE", 502, "Invalid image redirect");
    }
    currentUrl = new URL(location, currentUrl);
    await validateImageSourceUrl(currentUrl, requestOrigin, config, validateRemoteUrl);
  }
}

async function readResponseWithLimit(response: Response, limit: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > limit) {
    throw new FarmImageRequestError("BODY_TOO_LARGE", 413, "Source image is too large");
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > limit) {
      await reader.cancel();
      throw new FarmImageRequestError("BODY_TOO_LARGE", 413, "Source image is too large");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function detectImageContentType(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const signature = new TextDecoder().decode(bytes.slice(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12) {
    const riff = new TextDecoder().decode(bytes.slice(0, 4));
    const webp = new TextDecoder().decode(bytes.slice(8, 12));
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
    const box = new TextDecoder().decode(bytes.slice(4, 12));
    if (box.startsWith("ftypavif") || box.startsWith("ftypavis")) return "image/avif";
  }

  const prefix = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (prefix.startsWith("<svg") || (prefix.startsWith("<?xml") && prefix.includes("<svg"))) {
    return "image/svg+xml";
  }
  return "";
}

function validateSourceType(type: string, config: ResolvedFarmImageConfig): void {
  if (!type || (type === "image/svg+xml" && !config.dangerouslyAllowSVG)) {
    throw new FarmImageRequestError("UNSUPPORTED_IMAGE", 415, "Unsupported source image");
  }
}

function validateTransformedResult(
  result: FarmImageTransformResult,
  config: ResolvedFarmImageConfig,
): void {
  if (!(result.body instanceof Uint8Array) || result.body.byteLength === 0) {
    throw new Error("The image transformer returned an empty response");
  }
  if (result.body.byteLength > config.maximumResponseBody) {
    throw new FarmImageRequestError("BODY_TOO_LARGE", 413, "Optimized image is too large");
  }
  const contentType = normalizeImageContentType(result.contentType);
  if (!contentType || (contentType === "image/svg+xml" && !config.dangerouslyAllowSVG)) {
    throw new Error("The image transformer returned an unsupported content type");
  }
  result.contentType = contentType;
}

function normalizeImageContentType(value: string | null): string {
  const type = value?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return type.startsWith("image/") ? type : "";
}

function matchesRemoteSource(url: URL, config: ResolvedFarmImageConfig): boolean {
  if (config.domains.includes(url.hostname.toLowerCase())) return true;
  return config.remotePatterns.some((pattern) => matchesRemotePattern(url, pattern));
}

function matchesRemotePattern(url: URL, pattern: FarmImageRemotePattern): boolean {
  return (
    (!pattern.protocol || url.protocol === `${pattern.protocol}:`) &&
    matchesHostname(url.hostname, pattern.hostname) &&
    (pattern.port === undefined || url.port === pattern.port) &&
    matchesGlob(url.pathname, pattern.pathname ?? "/**") &&
    (pattern.search === undefined || url.search === pattern.search)
  );
}

function matchesLocalPatterns(url: URL, patterns: readonly FarmImageLocalPattern[]): boolean {
  return patterns.some(
    (pattern) =>
      matchesGlob(url.pathname, pattern.pathname) &&
      (pattern.search === undefined || url.search === pattern.search),
  );
}

function matchesHostname(hostname: string, pattern: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  if (normalizedPattern.startsWith("**.")) {
    const suffix = normalizedPattern.slice(3);
    return normalizedHostname === suffix || normalizedHostname.endsWith(`.${suffix}`);
  }
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    const prefix = normalizedHostname.slice(0, -(suffix.length + 1));
    return normalizedHostname.endsWith(`.${suffix}`) && !!prefix && !prefix.includes(".");
  }
  return normalizedHostname === normalizedPattern;
}

function matchesGlob(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*");
  return new RegExp(`^${source}$`).test(value);
}

function createOptimizedImageResponse(
  request: Request,
  image: OptimizedImage,
  config: ResolvedFarmImageConfig,
): Response {
  const headers = new Headers({
    "cache-control": image.cacheControl,
    "content-type": image.contentType,
    "content-length": String(image.body.byteLength),
    "content-disposition": "inline",
    etag: image.etag,
    vary: "Accept",
    "x-content-type-options": "nosniff",
  });
  if (image.contentType === "image/svg+xml" && config.dangerouslyAllowSVG) {
    headers.set("content-security-policy", "default-src 'none'; sandbox");
  }
  if (request.headers.get("if-none-match") === image.etag) {
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  const body =
    request.method === "HEAD"
      ? null
      : image.body.buffer.slice(
          image.body.byteOffset,
          image.body.byteOffset + image.body.byteLength,
        );
  return new Response(body as ArrayBuffer | null, { status: 200, headers });
}

function createFarmImageErrorResponse(error: unknown): Response {
  const status =
    error instanceof FarmImageRequestError ? error.status : isAbortError(error) ? 499 : 500;
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  if (status === 405) headers.set("allow", "GET, HEAD");

  const message =
    status === 400
      ? "Invalid image request"
      : status === 404
        ? "Image not found"
        : status === 405
          ? "Method not allowed"
          : status === 413
            ? "Image is too large"
            : status === 415
              ? "Unsupported image"
              : status === 499
                ? "Image request cancelled"
                : "Image optimization failed";
  return new Response(message, { status, headers });
}

function createImageEtag(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"farm-${bytes.byteLength.toString(16)}-${(hash >>> 0).toString(16)}"`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The image request was aborted", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

class FarmImageMemoryCache {
  private readonly entries = new Map<string, OptimizedImage>();

  constructor(private readonly capacity: number) {}

  get(key: string): OptimizedImage | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    if (value.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: OptimizedImage): void {
    if (this.capacity <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}
