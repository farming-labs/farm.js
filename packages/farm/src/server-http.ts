export const DEFAULT_FARM_SERVER_BODY_SIZE_LIMIT = 10_000_000;
export const DEFAULT_FARM_SERVER_HEADERS_TIMEOUT = 60_000;
export const DEFAULT_FARM_SERVER_REQUEST_TIMEOUT = 300_000;
export const DEFAULT_FARM_SERVER_KEEP_ALIVE_TIMEOUT = 5_000;
export const DEFAULT_FARM_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT = 30_000;
const MAX_FARM_SERVER_TIMEOUT = 2_147_483_647;

export type FarmServerDuration = number | `${number}${"ms" | "s" | "m" | "h"}`;

export interface FarmServerHealthConfig {
  /** Liveness endpoint. It remains healthy while a production process drains. */
  livenessPath?: string;
  /** Readiness endpoint. It returns 503 until startup completes and while draining. */
  readinessPath?: string;
}

export interface ResolvedFarmServerHealthConfig {
  enabled: boolean;
  livenessPath: string;
  readinessPath: string;
}

export interface FarmServerConfig {
  /** Maximum request body size for API routes, integrations, workflows, and uploads. */
  bodySizeLimit?: number | string;
  /** Trust proxy-provided client IP headers. Enable only behind a trusted proxy. */
  trustProxy?: boolean;
  /** Maximum time for a Node client to send complete request headers. */
  headersTimeout?: FarmServerDuration;
  /** Maximum time for a Node client to send the complete request. */
  requestTimeout?: FarmServerDuration;
  /** How long an idle Node keep-alive connection remains open after a response. */
  keepAliveTimeout?: FarmServerDuration;
  /** Maximum time the Node adapter drains traffic before forcing shutdown. */
  gracefulShutdownTimeout?: FarmServerDuration;
  /** Production liveness and readiness endpoints. Set to false to disable them. */
  health?: false | FarmServerHealthConfig;
}

export interface ResolvedFarmServerConfig {
  bodySizeLimit: number;
  trustProxy: boolean;
  headersTimeout: number;
  requestTimeout: number;
  keepAliveTimeout: number;
  gracefulShutdownTimeout: number;
  health: ResolvedFarmServerHealthConfig;
}

export type FarmRequestBodyErrorCode = "BODY_TOO_LARGE" | "INVALID_CONTENT_LENGTH";

export class FarmRequestBodyError extends Error {
  readonly code: FarmRequestBodyErrorCode;
  readonly status: number;

  constructor(code: FarmRequestBodyErrorCode, status: number, message: string) {
    super(message);
    this.name = "FarmRequestBodyError";
    this.code = code;
    this.status = status;
  }
}

export function resolveFarmServerConfig(
  config: FarmServerConfig | ResolvedFarmServerConfig | undefined,
): ResolvedFarmServerConfig {
  const headersTimeout = parseFarmServerDuration(
    config?.headersTimeout ?? DEFAULT_FARM_SERVER_HEADERS_TIMEOUT,
    "server.headersTimeout",
  );
  const requestTimeout = parseFarmServerDuration(
    config?.requestTimeout ?? DEFAULT_FARM_SERVER_REQUEST_TIMEOUT,
    "server.requestTimeout",
  );
  if (headersTimeout > requestTimeout) {
    throw new TypeError("server.headersTimeout must not exceed server.requestTimeout");
  }

  return Object.freeze({
    bodySizeLimit: parseBodySizeLimit(
      config?.bodySizeLimit ?? DEFAULT_FARM_SERVER_BODY_SIZE_LIMIT,
      "server.bodySizeLimit",
    ),
    trustProxy: config?.trustProxy === true,
    headersTimeout,
    requestTimeout,
    keepAliveTimeout: parseFarmServerDuration(
      config?.keepAliveTimeout ?? DEFAULT_FARM_SERVER_KEEP_ALIVE_TIMEOUT,
      "server.keepAliveTimeout",
    ),
    gracefulShutdownTimeout: parseFarmServerDuration(
      config?.gracefulShutdownTimeout ?? DEFAULT_FARM_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT,
      "server.gracefulShutdownTimeout",
    ),
    health: resolveFarmServerHealthConfig(config?.health),
  });
}

export function parseFarmServerDuration(
  value: FarmServerDuration,
  optionName = "duration",
): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${optionName} must be a positive safe integer`);
    }
    if (value > MAX_FARM_SERVER_TIMEOUT) {
      throw new TypeError(`${optionName} must not exceed ${MAX_FARM_SERVER_TIMEOUT} milliseconds`);
    }
    return value;
  }

  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/);
  if (!match) {
    throw new TypeError(`${optionName} must be milliseconds or a duration such as "30s" or "2m"`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000;
  const milliseconds = Math.floor(amount * multiplier);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new TypeError(`${optionName} must resolve to a positive safe integer`);
  }
  if (milliseconds > MAX_FARM_SERVER_TIMEOUT) {
    throw new TypeError(`${optionName} must not exceed ${MAX_FARM_SERVER_TIMEOUT} milliseconds`);
  }
  return milliseconds;
}

function resolveFarmServerHealthConfig(
  config: false | FarmServerHealthConfig | ResolvedFarmServerHealthConfig | undefined,
): ResolvedFarmServerHealthConfig {
  if (config === false || (config && "enabled" in config && config.enabled === false)) {
    return Object.freeze({
      enabled: false,
      livenessPath: "/_farm/health/live",
      readinessPath: "/_farm/health/ready",
    });
  }

  const livenessPath = normalizeHealthPath(
    config?.livenessPath ?? "/_farm/health/live",
    "server.health.livenessPath",
  );
  const readinessPath = normalizeHealthPath(
    config?.readinessPath ?? "/_farm/health/ready",
    "server.health.readinessPath",
  );
  if (livenessPath === readinessPath) {
    throw new TypeError("server.health livenessPath and readinessPath must be different");
  }

  return Object.freeze({ enabled: true, livenessPath, readinessPath });
}

function normalizeHealthPath(value: string, optionName: string): string {
  const path = value.trim();
  if (!path.startsWith("/") || path.includes("?") || path.includes("#") || path.includes("*")) {
    throw new TypeError(`${optionName} must be an absolute pathname without a query or wildcard`);
  }
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

export function parseBodySizeLimit(value: number | string, optionName = "bodySizeLimit"): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${optionName} must be a positive safe integer`);
    }
    return value;
  }

  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|kib|mib|gib)?$/);
  if (!match) {
    throw new TypeError(`${optionName} must be bytes or a size string such as "500kb" or "10mb"`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "b";
  const multiplier: Record<string, number> = {
    b: 1,
    kb: 1_000,
    mb: 1_000_000,
    gb: 1_000_000_000,
    kib: 1_024,
    mib: 1_048_576,
    gib: 1_073_741_824,
  };
  const bytes = Math.floor(amount * multiplier[unit]);

  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new TypeError(`${optionName} must resolve to a positive safe integer`);
  }

  return bytes;
}

export async function bufferFarmRequestBody(request: Request, limit: number): Promise<Request> {
  if (request.method === "GET" || request.method === "HEAD" || request.body === null) {
    return request;
  }

  const bytes = await readFarmRequestBody(request, limit);
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Request(request, {
    // oxlint-disable-next-line unicorn/no-invalid-fetch-options -- GET and HEAD return above.
    body: body.buffer,
  });
}

export async function readFarmRequestBody(request: Request, limit: number): Promise<Uint8Array> {
  try {
    validateContentLength(request.headers.get("content-length"), limit);
  } catch (error) {
    await request.body?.cancel(error).catch(() => {});
    throw error;
  }
  throwIfAborted(request.signal);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancelBodyRead = () => {
    void reader.cancel(request.signal.reason).catch(() => {});
  };
  request.signal.addEventListener("abort", cancelBodyRead, { once: true });

  try {
    while (true) {
      throwIfAborted(request.signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("Request body is too large");
        throw new FarmRequestBodyError("BODY_TOO_LARGE", 413, "Request body is too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (request.signal.aborted) throwIfAborted(request.signal);
    throw error;
  } finally {
    request.signal.removeEventListener("abort", cancelBodyRead);
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readNodeRequestBody(
  request: {
    headers: Record<string, string | string[] | undefined>;
    on(event: "data", listener: (chunk: unknown) => void): unknown;
    on(event: "end", listener: () => void): unknown;
    on(event: "error", listener: (error: Error) => void): unknown;
    removeListener?(event: string, listener: (...args: any[]) => void): unknown;
    resume?(): unknown;
  },
  limit: number,
): Promise<Buffer> {
  const rawContentLength = request.headers["content-length"];
  const contentLength = Array.isArray(rawContentLength) ? rawContentLength[0] : rawContentLength;
  try {
    validateContentLength(contentLength, limit);
  } catch (error) {
    request.resume?.();
    throw error;
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const cleanup = () => {
      request.removeListener?.("data", onData);
      request.removeListener?.("end", onEnd);
      request.removeListener?.("error", onError);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      request.resume?.();
      reject(error);
    };
    const onData = (chunk: unknown) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any);
      total += bytes.byteLength;
      if (total > limit) {
        rejectOnce(new FarmRequestBodyError("BODY_TOO_LARGE", 413, "Request body is too large"));
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, total));
    };
    const onError = (error: Error) => rejectOnce(error);

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

export function createFarmRequestBodyErrorResponse(error: unknown): Response | null {
  if (!(error instanceof FarmRequestBodyError)) return null;

  return new Response(error.status === 413 ? "Payload Too Large" : "Bad Request", {
    status: error.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function validateContentLength(value: string | null | undefined, limit: number): void {
  const contentLength = value?.trim();
  if (!contentLength) return;
  if (!/^\d+$/.test(contentLength)) {
    throw new FarmRequestBodyError("INVALID_CONTENT_LENGTH", 400, "Invalid content-length header");
  }
  if (Number(contentLength) > limit) {
    throw new FarmRequestBodyError("BODY_TOO_LARGE", 413, "Request body is too large");
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}
