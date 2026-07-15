import { AsyncLocalStorage } from "node:async_hooks";
import { subscribeFarmCacheInvalidation } from "./cache-invalidation";

export const DEFAULT_SERVER_ACTION_BODY_SIZE_LIMIT = 1_000_000;

export interface FarmServerActionsConfig {
  /** Additional trusted origins or host patterns, such as https://app.example.com. */
  allowedOrigins?: readonly string[];
  /** Maximum encoded request body size in bytes or as a size string such as "1mb". */
  bodySizeLimit?: number | string;
}

export interface ResolvedFarmServerActionsConfig {
  allowedOrigins: readonly string[];
  bodySizeLimit: number;
}

export type ServerActionRequestKind = "javascript" | "form";

export interface PreparedServerActionRequest {
  body: string | FormData;
  contentType: string;
}

export type SanitizedServerActionError = {
  name: "ServerActionError";
  message: "Server function failed";
};

type ServerActionRequestErrorCode =
  | "BODY_TOO_LARGE"
  | "INVALID_ACTION_ID"
  | "INVALID_BODY"
  | "INVALID_CONTENT_LENGTH"
  | "INVALID_METHOD"
  | "INVALID_ORIGIN"
  | "MISSING_ORIGIN"
  | "UNSUPPORTED_CONTENT_TYPE";

export class ServerActionRequestError extends Error {
  readonly code: ServerActionRequestErrorCode;
  readonly status: number;

  constructor(code: ServerActionRequestErrorCode, status: number, message: string) {
    super(message);
    this.name = "ServerActionRequestError";
    this.code = code;
    this.status = status;
  }
}

type ServerActionExecutionContext = {
  request: Request;
  signal: AbortSignal;
  invalidations: Set<string>;
};

const SERVER_ACTION_STORAGE_KEY = Symbol.for("farm.serverActionStorage");
const FALLBACK_ABORT_CONTROLLER_KEY = Symbol.for("farm.serverActionFallbackAbortController");
const FORM_ACTION_CONTENT_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
]);
const JAVASCRIPT_ACTION_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

type GlobalWithServerActionStorage = typeof globalThis & {
  [SERVER_ACTION_STORAGE_KEY]?: AsyncLocalStorage<ServerActionExecutionContext>;
  [FALLBACK_ABORT_CONTROLLER_KEY]?: AbortController;
};

export function resolveServerActionsConfig(
  config: FarmServerActionsConfig | undefined,
): ResolvedFarmServerActionsConfig {
  const allowedOrigins = (config?.allowedOrigins ?? []).map(normalizeAllowedOriginPattern);
  const bodySizeLimit = parseBodySizeLimit(
    config?.bodySizeLimit ?? DEFAULT_SERVER_ACTION_BODY_SIZE_LIMIT,
  );

  return Object.freeze({
    allowedOrigins: Object.freeze(allowedOrigins),
    bodySizeLimit,
  });
}

export function validateServerActionRequest(
  request: Request,
  config: ResolvedFarmServerActionsConfig,
): void {
  if (request.method.toUpperCase() !== "POST") {
    throw new ServerActionRequestError(
      "INVALID_METHOD",
      405,
      "Server actions only accept POST requests",
    );
  }

  const requestUrl = new URL(request.url);
  const sourceOrigin = getRequestSourceOrigin(request);
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();

  if (!sourceOrigin) {
    if (fetchSite !== "same-origin") {
      throw new ServerActionRequestError(
        "MISSING_ORIGIN",
        403,
        "Server action request is missing same-origin metadata",
      );
    }
    return;
  }

  const matchesRequest =
    sourceOrigin === requestUrl.origin || matchesHostHeader(sourceOrigin, request);
  const matchesConfiguredOrigin = config.allowedOrigins.some((pattern) =>
    matchesAllowedOrigin(sourceOrigin, pattern),
  );

  if (!matchesRequest && !matchesConfiguredOrigin) {
    throw new ServerActionRequestError(
      "INVALID_ORIGIN",
      403,
      "Server action origin does not match the request origin",
    );
  }

  if (fetchSite === "cross-site" && !matchesConfiguredOrigin) {
    throw new ServerActionRequestError(
      "INVALID_ORIGIN",
      403,
      "Cross-site server action request was rejected",
    );
  }
}

export async function prepareServerActionRequest(
  request: Request,
  config: ResolvedFarmServerActionsConfig,
  kind: ServerActionRequestKind,
  actionId?: string | null,
): Promise<PreparedServerActionRequest> {
  validateServerActionRequest(request, config);

  if (kind === "javascript") {
    validateActionId(actionId);
  }

  const contentType = getSupportedContentType(request, kind);
  const bytes = await readBodyWithLimit(request, config.bodySizeLimit);

  if (kind === "form" || contentType === "multipart/form-data") {
    return {
      body: await parseFormData(request, bytes),
      contentType,
    };
  }

  return {
    body: new TextDecoder().decode(bytes),
    contentType,
  };
}

export function createServerActionRequestErrorResponse(error: unknown): Response | null {
  if (!(error instanceof ServerActionRequestError)) {
    return null;
  }

  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  if (error.status === 405) {
    headers.set("allow", "POST");
  }

  return new Response(getPublicErrorMessage(error.status), {
    status: error.status,
    headers,
  });
}

export function sanitizeServerActionError(_error: unknown): SanitizedServerActionError {
  return {
    name: "ServerActionError",
    message: "Server function failed",
  };
}

export function runWithServerActionRequest<T>(
  request: Request,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  throwIfAborted(request.signal);
  return getServerActionStorage().run(
    {
      request,
      signal: request.signal,
      invalidations: new Set(),
    },
    callback,
  );
}

export function getServerActionExecutionContext(): ServerActionExecutionContext | undefined {
  return getServerActionStorage().getStore();
}

export function getServerActionSignal(): AbortSignal {
  return getServerActionExecutionContext()?.signal ?? getFallbackAbortController().signal;
}

export function getServerActionInvalidations(): readonly string[] {
  return Array.from(getServerActionExecutionContext()?.invalidations ?? []);
}

subscribeFarmCacheInvalidation((key) => {
  getServerActionExecutionContext()?.invalidations.add(key);
});

function getServerActionStorage(): AsyncLocalStorage<ServerActionExecutionContext> {
  const globalState = globalThis as GlobalWithServerActionStorage;
  if (!globalState[SERVER_ACTION_STORAGE_KEY]) {
    globalState[SERVER_ACTION_STORAGE_KEY] = new AsyncLocalStorage<ServerActionExecutionContext>();
  }
  return globalState[SERVER_ACTION_STORAGE_KEY]!;
}

function getFallbackAbortController(): AbortController {
  const globalState = globalThis as GlobalWithServerActionStorage;
  if (!globalState[FALLBACK_ABORT_CONTROLLER_KEY]) {
    globalState[FALLBACK_ABORT_CONTROLLER_KEY] = new AbortController();
  }
  return globalState[FALLBACK_ABORT_CONTROLLER_KEY]!;
}

function parseBodySizeLimit(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("serverActions.bodySizeLimit must be a positive safe integer");
    }
    return value;
  }

  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|kib|mib|gib)?$/);
  if (!match) {
    throw new TypeError(
      'serverActions.bodySizeLimit must be bytes or a size string such as "500kb" or "1mb"',
    );
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
    throw new TypeError("serverActions.bodySizeLimit must resolve to a positive safe integer");
  }

  return bytes;
}

function normalizeAllowedOriginPattern(value: string): string {
  const pattern = value.trim().toLowerCase();
  if (!pattern) {
    throw new TypeError("serverActions.allowedOrigins cannot contain empty values");
  }

  if (pattern.includes("*")) {
    if (!/^(?:https?:\/\/)?\*\.[a-z0-9.-]+(?::\d+)?$/.test(pattern)) {
      throw new TypeError(`Invalid serverActions.allowedOrigins pattern: ${JSON.stringify(value)}`);
    }
    return pattern;
  }

  if (pattern.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(pattern);
    } catch {
      throw new TypeError(`Invalid serverActions.allowedOrigins value: ${JSON.stringify(value)}`);
    }

    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new TypeError(
        `serverActions.allowedOrigins must contain origins without paths: ${JSON.stringify(value)}`,
      );
    }
    return parsed.origin;
  }

  if (/[/@?#]/.test(pattern)) {
    throw new TypeError(
      `serverActions.allowedOrigins must contain origins or hosts: ${JSON.stringify(value)}`,
    );
  }

  try {
    return new URL(`http://${pattern}`).host;
  } catch {
    throw new TypeError(`Invalid serverActions.allowedOrigins value: ${JSON.stringify(value)}`);
  }
}

function getRequestSourceOrigin(request: Request): string | null {
  const origin = request.headers.get("origin")?.trim();
  if (origin) {
    return parseSourceOrigin(origin);
  }

  const referer = request.headers.get("referer")?.trim();
  if (referer) {
    return parseSourceOrigin(referer);
  }

  return null;
}

function parseSourceOrigin(value: string): string {
  if (value === "null") {
    throw new ServerActionRequestError("INVALID_ORIGIN", 403, "Opaque origins are not allowed");
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    return parsed.origin;
  } catch {
    throw new ServerActionRequestError("INVALID_ORIGIN", 403, "Invalid request origin");
  }
}

function matchesHostHeader(sourceOrigin: string, request: Request): boolean {
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (!host) return false;

  try {
    const source = new URL(sourceOrigin);
    const target = new URL(request.url);
    return source.protocol === target.protocol && source.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function matchesAllowedOrigin(sourceOrigin: string, pattern: string): boolean {
  const source = new URL(sourceOrigin);
  if (!pattern.includes("*")) {
    return pattern.includes("://") ? source.origin === pattern : source.host === pattern;
  }

  const schemeEnd = pattern.indexOf("://");
  const scheme = schemeEnd === -1 ? null : pattern.slice(0, schemeEnd + 1);
  const hostPattern = pattern.slice(schemeEnd === -1 ? 0 : schemeEnd + 3);
  const [wildcardHost, port] = splitHostAndPort(hostPattern);
  const baseHost = wildcardHost.slice(2);

  if (scheme && source.protocol !== scheme) return false;
  if (port && getEffectivePort(source) !== port) return false;
  if (!port && source.port) return false;

  return source.hostname.endsWith(`.${baseHost}`) && source.hostname !== baseHost;
}

function splitHostAndPort(value: string): [string, string | null] {
  const separator = value.lastIndexOf(":");
  if (separator === -1) return [value, null];
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function getEffectivePort(url: URL): string {
  if (url.port) return url.port;
  if (url.protocol === "https:") return "443";
  if (url.protocol === "http:") return "80";
  return "";
}

function validateActionId(actionId?: string | null): asserts actionId is string {
  if (!actionId || actionId.length > 4096 || hasControlCharacters(actionId)) {
    throw new ServerActionRequestError("INVALID_ACTION_ID", 400, "Invalid server action id");
  }
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function getSupportedContentType(request: Request, kind: ServerActionRequestKind): string {
  const header = request.headers.get("content-type")?.trim().toLowerCase();
  const contentType = header?.split(";", 1)[0]?.trim() ?? "";
  const supported = kind === "form" ? FORM_ACTION_CONTENT_TYPES : JAVASCRIPT_ACTION_CONTENT_TYPES;

  if (!supported.has(contentType)) {
    throw new ServerActionRequestError(
      "UNSUPPORTED_CONTENT_TYPE",
      415,
      "Unsupported server action content type",
    );
  }

  return contentType;
}

async function readBodyWithLimit(request: Request, limit: number): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length")?.trim();
  if (contentLength) {
    if (!/^\d+$/.test(contentLength)) {
      throw new ServerActionRequestError(
        "INVALID_CONTENT_LENGTH",
        400,
        "Invalid content-length header",
      );
    }
    if (Number(contentLength) > limit) {
      throw new ServerActionRequestError("BODY_TOO_LARGE", 413, "Server action body is too large");
    }
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
        await reader.cancel("Server action body is too large");
        throw new ServerActionRequestError(
          "BODY_TOO_LARGE",
          413,
          "Server action body is too large",
        );
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

  throwIfAborted(request.signal);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function parseFormData(request: Request, bytes: Uint8Array): Promise<FormData> {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const copy = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body,
  });

  try {
    return await copy.formData();
  } catch {
    throw new ServerActionRequestError("INVALID_BODY", 400, "Invalid server action form body");
  }
}

function getPublicErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 403:
      return "Forbidden";
    case 405:
      return "Method Not Allowed";
    case 413:
      return "Payload Too Large";
    case 415:
      return "Unsupported Media Type";
    default:
      return "Server Action Request Failed";
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}
