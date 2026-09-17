import type {
  FarmImageFormat,
  FarmImageLocalPattern,
  FarmImageRemotePattern,
  ResolvedFarmImageConfig,
} from "./image-config";
import { matchesFarmIfNoneMatch } from "./server-http";

export interface FarmImageTransformInput {
  source: Uint8Array;
  sourceUrl: URL;
  sourceType: string;
  width: number;
  quality: number;
  accept: string;
  formats: readonly FarmImageFormat[];
  signal: AbortSignal;
  /**
   * Byte ceiling for any source the transformer fetches itself. Supplied by the
   * image handler; transformers that re-fetch the origin (Cloudflare) must
   * enforce it, since they bypass the handler's bounded read.
   */
  maximumResponseBody?: number;
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
  /** Node-only fetcher that validates the DNS result used for remote connections. @internal */
  fetchRemote?: typeof globalThis.fetch;
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
  // Identical concurrent misses share one fetch + transform. Without this a
  // burst for an uncached image (a new page going live, a CDN cold start)
  // fetches the origin and runs the codec once per request.
  const inflight = new Map<string, InflightOptimization>();
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
      // Key on the format the Accept header negotiates to, not the header text.
      // Both transformers derive their output from `selectOutputFormat(accept,
      // formats)` alone, so every header that negotiates to the same format
      // produces byte-identical output. Keying on the raw header let a caller
      // vary it freely (`image/webp,*/*;q=0.8`, reordered lists, extra params)
      // and force an uncached fetch and transform each time.
      const negotiatedFormat = selectOutputFormat(accept, config.formats) ?? "";
      const cacheKey = `${sourceUrl.href}\n${width}\n${quality}\n${negotiatedFormat}`;
      let optimized = cache.get(cacheKey);

      if (!optimized) {
        optimized = await runCoalesced(inflight, cacheKey, request.signal, async (signal) => {
          const fetchedSource = await fetchImageSource(
            sourceUrl,
            requestUrl.origin,
            config,
            fetcher,
            options.fetchRemote,
            options.validateRemoteUrl,
            signal,
          );
          const source = await readResponseWithLimit(
            fetchedSource.response,
            config.maximumResponseBody,
          );
          const sourceType = detectImageContentType(source);
          validateSourceType(sourceType, config);
          throwIfAborted(signal);

          const result = await options.transform({
            source,
            sourceUrl: fetchedSource.url,
            sourceType,
            width,
            quality,
            accept,
            formats: config.formats,
            signal,
            maximumResponseBody: config.maximumResponseBody,
          });
          throwIfAborted(signal);
          validateTransformedResult(result, config);

          const entry = {
            ...result,
            etag: createImageEtag(result.body),
            cacheControl: `public, max-age=${config.minimumCacheTTL}, stale-while-revalidate=${Math.max(
              config.minimumCacheTTL,
              60,
            )}`,
            expiresAt: Date.now() + config.minimumCacheTTL * 1_000,
          };
          cache.set(cacheKey, entry);
          return entry;
        });
      }

      return createOptimizedImageResponse(request, optimized, config);
    } catch (error) {
      if (!(error instanceof FarmImageRequestError) && !isAbortError(error)) {
        try {
          options.onError?.(error, request);
        } catch {
          // Error reporting must not replace the optimizer's sanitized response.
        }
      }
      return createFarmImageErrorResponse(error);
    }
  };
}

/** Mirrors the `images.maximumResponseBody` default ("10mb"). */
const DEFAULT_IMAGE_TRANSFORM_BODY_LIMIT = 10 * 1024 * 1024;

export function createCloudflareImageTransformer(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): FarmImageTransformer {
  return async ({ sourceUrl, width, quality, accept, formats, signal, maximumResponseBody }) => {
    const format = selectOutputFormat(accept, formats);
    // Cloudflare resizing works by letting the edge fetch the origin, so this
    // request cannot reuse the bytes the handler already read. It still must not
    // be a weaker fetch than the validated one: `redirect: "manual"` keeps it
    // from silently following a hop the handler never validated, and the body is
    // read under the same ceiling as the handler's own read.
    const response = await fetcher(sourceUrl, {
      signal,
      redirect: "manual",
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

    if (response.status >= 300 && response.status < 400) {
      void cancelResponseBody(response);
      throw new FarmImageRequestError(
        "UNSUPPORTED_IMAGE",
        502,
        "Source image redirected after validation",
      );
    }

    if (!response.ok) {
      throw new FarmImageRequestError(
        "UNSUPPORTED_IMAGE",
        response.status === 404 ? 404 : 502,
        "Cloudflare could not transform the source image",
      );
    }

    const body = await readResponseWithLimit(
      response,
      maximumResponseBody ?? DEFAULT_IMAGE_TRANSFORM_BODY_LIMIT,
    );
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

/**
 * Expand an IPv6 address into its eight 16-bit hextets, or null when the value
 * is not a parseable IPv6 address.
 *
 * Textual comparison is not enough for this boundary: the same address has many
 * spellings, and `new URL()` rewrites some of them. `::ffff:127.0.0.1` becomes
 * `::ffff:7f00:1`, and `::1` may arrive fully expanded, so every form has to be
 * reduced to numbers before any range check.
 */
function parseIpv6Hextets(value: string): number[] | null {
  // Drop any zone index (fe80::1%eth0); it does not affect the address.
  let text = value.split("%", 1)[0] ?? "";
  if (!text.includes(":")) return null;

  // A trailing dotted quad (::ffff:127.0.0.1) contributes the low two hextets.
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const candidate = text.slice(lastColon + 1);
  if (candidate.includes(".")) {
    const octets = parseIpv4Octets(candidate);
    if (!octets) return null;
    tail = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    text = text.slice(0, lastColon);
    // "::1.2.3.4" leaves "::" here, and "1.2.3.4" alone leaves "" — not IPv6.
    if (text === "") return null;
  }

  const compressionParts = text.split("::");
  if (compressionParts.length > 2) return null;

  const parseGroup = (group: string): number[] | null => {
    if (group === "") return [];
    const hextets: number[] = [];
    for (const part of group.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      hextets.push(Number.parseInt(part, 16));
    }
    return hextets;
  };

  const head = parseGroup(compressionParts[0] ?? "");
  const rest = parseGroup(compressionParts[1] ?? "");
  if (!head || !rest) return null;

  const explicit = [...head, ...rest, ...tail];
  if (compressionParts.length === 1) {
    return explicit.length === 8 ? explicit : null;
  }

  // "::" stands for at least one zero hextet.
  if (explicit.length >= 8) return null;
  const zeros = Array.from({ length: 8 - explicit.length }, () => 0);
  return [...head, ...zeros, ...rest, ...tail];
}

function parseIpv4Octets(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.some((part) => part > 255) ? null : octets;
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets as [number, number];
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

export function isPrivateImageAddress(address: string): boolean {
  const value = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  const hextets = parseIpv6Hextets(value);
  if (hextets) {
    const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const zeroPrefix = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0;

    // An address that embeds IPv4 is only as safe as that IPv4 address:
    // IPv4-mapped (::ffff:0:0/96), IPv4-translated (::ffff:0:0:0/96), and the
    // deprecated IPv4-compatible (::/96) forms all reach the v4 host.
    const embedsIpv4 =
      zeroPrefix &&
      ((h4 === 0 && h5 === 0xffff) || (h4 === 0xffff && h5 === 0) || (h4 === 0 && h5 === 0));
    if (embedsIpv4 && (h6 !== 0 || h7 !== 0)) {
      return isPrivateIpv4([h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff]);
    }

    // Unspecified (::) and loopback (::1) in any spelling.
    if (zeroPrefix && h4 === 0 && h5 === 0 && h6 === 0 && (h7 === 0 || h7 === 1)) return true;
    // Unique-local fc00::/7, link-local fe80::/10, multicast ff00::/8.
    if ((h0 & 0xfe00) === 0xfc00) return true;
    if ((h0 & 0xffc0) === 0xfe80) return true;
    if ((h0 & 0xff00) === 0xff00) return true;
    return false;
  }

  const octets = parseIpv4Octets(value);
  return octets ? isPrivateIpv4(octets) : false;
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
  fetchRemote: typeof globalThis.fetch | undefined,
  validateRemoteUrl: CreateFarmImageHandlerOptions["validateRemoteUrl"],
  signal: AbortSignal,
): Promise<{ response: Response; url: URL }> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; ; redirectCount += 1) {
    throwIfAborted(signal);
    const sourceFetcher = currentUrl.origin === requestOrigin ? fetcher : (fetchRemote ?? fetcher);
    const response = await sourceFetcher(currentUrl, {
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
        await cancelResponseBody(response);
        throw new FarmImageRequestError(
          "UNSUPPORTED_IMAGE",
          response.status === 404 ? 404 : 502,
          "Could not fetch source image",
        );
      }
      return { response, url: currentUrl };
    }

    if (redirectCount >= config.maximumRedirects) {
      await cancelResponseBody(response);
      throw new FarmImageRequestError(
        "TOO_MANY_REDIRECTS",
        400,
        "Source image exceeded the redirect limit",
      );
    }
    const location = response.headers.get("location");
    if (!location) {
      await cancelResponseBody(response);
      throw new FarmImageRequestError("UNSUPPORTED_IMAGE", 502, "Invalid image redirect");
    }
    await cancelResponseBody(response);
    currentUrl = new URL(location, currentUrl);
    await validateImageSourceUrl(currentUrl, requestOrigin, config, validateRemoteUrl);
  }
}

type InflightOptimization = {
  promise: Promise<OptimizedImage>;
  controller: AbortController;
  waiters: number;
};

/**
 * Share one in-flight optimization between identical concurrent requests.
 *
 * The shared work runs under its own AbortController rather than any single
 * request's signal, so one caller going away cannot cancel the image everyone
 * else is waiting for. The controller is aborted only when the last waiter
 * leaves, so an abandoned burst still stops promptly.
 */
async function runCoalesced(
  inflight: Map<string, InflightOptimization>,
  key: string,
  requestSignal: AbortSignal,
  run: (signal: AbortSignal) => Promise<OptimizedImage>,
): Promise<OptimizedImage> {
  let entry = inflight.get(key);
  if (!entry) {
    const controller = new AbortController();
    const created: InflightOptimization = {
      controller,
      waiters: 0,
      promise: undefined as unknown as Promise<OptimizedImage>,
    };
    created.promise = run(controller.signal).finally(() => {
      if (inflight.get(key) === created) inflight.delete(key);
    });
    // Every waiter can detach before the shared work settles: an already
    // aborted request returns early without ever attaching to this promise,
    // and the last waiter leaving aborts the controller. Keep one no-op
    // handler so that rejection is never reported as unhandled. Waiters still
    // observe it, because this does not replace the promise they await.
    created.promise.catch(() => {});
    inflight.set(key, created);
    entry = created;
  }

  const pending = entry;
  pending.waiters += 1;
  try {
    return await raceRequestAbort(pending.promise, requestSignal);
  } finally {
    pending.waiters -= 1;
    if (pending.waiters === 0 && inflight.get(key) === pending) {
      inflight.delete(key);
      pending.controller.abort();
    }
  }
}

function raceRequestAbort(
  promise: Promise<OptimizedImage>,
  signal: AbortSignal,
): Promise<OptimizedImage> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));

  return new Promise<OptimizedImage>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function readResponseWithLimit(response: Response, limit: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > limit) {
    // Cleanup (including an unread tee branch) must not delay the size rejection.
    void cancelResponseBody(response);
    throw new FarmImageRequestError("BODY_TOO_LARGE", 413, "Source image is too large");
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > limit) {
        const error = new FarmImageRequestError("BODY_TOO_LARGE", 413, "Source image is too large");
        void reader.cancel(error).catch(() => {});
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup must not replace the request error or redirect result.
  }
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
  if (matchesFarmIfNoneMatch(request.headers.get("if-none-match"), image.etag)) {
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
