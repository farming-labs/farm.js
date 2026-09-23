import { AsyncLocalStorage } from "node:async_hooks";
import { subscribeFarmCacheInvalidation, subscribeFarmCacheTask } from "./cache-invalidation";
import {
  getRequestSourceOrigin,
  matchesAllowedOrigin,
  matchesHostHeader,
  normalizeAllowedOriginPattern,
} from "./request-origin";
import { serializeServerFnFailure, type SerializedServerFnFailure } from "./server-fn-error";
import { parseBodySizeLimit } from "./server-http";

const SERVER_ACTION_ALLOWED_ORIGINS_LABEL = "serverActions.allowedOrigins";

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

export type SanitizedServerActionError =
  | {
      name: "ServerActionError";
      message: "Server function failed";
    }
  | SerializedServerFnFailure;

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
  cacheTasks: Set<Promise<void>>;
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
  const allowedOrigins = (config?.allowedOrigins ?? []).map((value) =>
    normalizeAllowedOriginPattern(value, SERVER_ACTION_ALLOWED_ORIGINS_LABEL),
  );
  const bodySizeLimit = parseBodySizeLimit(
    config?.bodySizeLimit ?? DEFAULT_SERVER_ACTION_BODY_SIZE_LIMIT,
    "serverActions.bodySizeLimit",
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
  const sourceOrigin = resolveSourceOrigin(request);
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

export function sanitizeServerActionError(error: unknown): SanitizedServerActionError {
  const declaredFailure = serializeServerFnFailure(error);
  if (declaredFailure) return declaredFailure;

  return {
    name: "ServerActionError",
    message: "Server function failed",
  };
}

export async function runWithServerActionRequest<T>(
  request: Request,
  callback: () => T | Promise<T>,
): Promise<T> {
  throwIfAborted(request.signal);
  const context: ServerActionExecutionContext = {
    request,
    signal: request.signal,
    invalidations: new Set(),
    cacheTasks: new Set(),
  };

  return getServerActionStorage().run(context, async () => {
    try {
      const result = await callback();
      await Promise.all(context.cacheTasks);
      return result;
    } catch (error) {
      await Promise.allSettled(context.cacheTasks);
      throw error;
    }
  });
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

subscribeFarmCacheTask((task) => {
  getServerActionExecutionContext()?.cacheTasks.add(task);
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

/**
 * Adapt the shared origin resolution onto the server-action error contract:
 * an unusable Origin/Referer is a 403 here, while a request that simply
 * carried neither header returns null for the caller to judge.
 */
function resolveSourceOrigin(request: Request): string | null {
  const result = getRequestSourceOrigin(request);

  if (!result.ok) {
    throw new ServerActionRequestError(
      "INVALID_ORIGIN",
      403,
      result.reason === "opaque-origin"
        ? "Opaque origins are not allowed"
        : "Invalid request origin",
    );
  }

  return result.origin;
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
        const error = new ServerActionRequestError(
          "BODY_TOO_LARGE",
          413,
          "Server action body is too large",
        );
        // As with API bodies, a cloned stream may wait for its untouched tee
        // branch. Cleanup must neither delay rejection nor replace its error.
        void reader.cancel(error).catch(() => {});
        throw error;
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
