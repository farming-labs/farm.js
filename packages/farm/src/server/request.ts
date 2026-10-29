import { AsyncLocalStorage } from "node:async_hooks";
import { Readable } from "node:stream";
import type { FarmRequest } from "../types";
import {
  _setAppRequestView,
  _setCspNonceResolver,
  _setCurrentRequestResolver,
  _setSharedCacheScopeRunner,
} from "./request-bridge";

const REQUEST_STORAGE_KEY = Symbol.for("@farm.js/core/request-storage");

function getRequestStore(): AsyncLocalStorage<Request> {
  const runtime = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  const existing = runtime[REQUEST_STORAGE_KEY];
  if (existing instanceof AsyncLocalStorage) {
    return existing as AsyncLocalStorage<Request>;
  }

  const storage = new AsyncLocalStorage<Request>();
  runtime[REQUEST_STORAGE_KEY] = storage;
  return storage;
}

const requestStore = getRequestStore();

// Set while a function whose result every request shares (unstable_cache) runs.
// A request read there would cache one visitor's cookies or headers for all of
// them, and a later cache hit reads nothing, so the shared-response checks that
// count reads cannot see it. Refuse the read instead.
const SHARED_CACHE_SCOPE_KEY = Symbol.for("@farm.js/core/shared-cache-scope");

function getSharedCacheScopeStore(): AsyncLocalStorage<string> {
  const runtime = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  const existing = runtime[SHARED_CACHE_SCOPE_KEY];
  if (existing instanceof AsyncLocalStorage) return existing as AsyncLocalStorage<string>;
  const storage = new AsyncLocalStorage<string>();
  runtime[SHARED_CACHE_SCOPE_KEY] = storage;
  return storage;
}

const sharedCacheScope = getSharedCacheScopeStore();
_setSharedCacheScopeRunner((label, fn) => sharedCacheScope.run(label, fn));

/** @internal Throw when `api` reads the request inside a shared cache function. */
export function _assertRequestReadAllowed(api: string): void {
  const scope = sharedCacheScope.getStore();
  if (!scope) return;
  throw new Error(
    `${api} cannot be called inside ${scope}: its result is cached and shared by every ` +
      "request, so one visitor's request data would be served to others. Read it outside " +
      "the cached function and pass the value in as an argument, which also makes it part " +
      "of the cache key.",
  );
}

// How many times app code read each request through getCurrentRequest(),
// headers(), or cookies(). Renderers compare it across a render: HTML that
// read the request is per-visitor and must not enter a shared shell or CDN
// cache, wherever the read lives (page, layout, or an imported helper).
const REQUEST_READS_KEY = Symbol.for("@farm.js/core/request-reads");

function getRequestReads(): WeakMap<Request, number> {
  const runtime = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  return ((runtime[REQUEST_READS_KEY] as WeakMap<Request, number> | undefined) ??= new WeakMap());
}

const requestReads = getRequestReads();

function countRequestRead(request: Request): void {
  requestReads.set(request, (requestReads.get(request) ?? 0) + 1);
}

// One view per request, so code keying on it (per-request dedupe) sees one value.
const appRequestViews = new WeakMap<Request, Request>();

/**
 * The request a server function or server query gets during a render. It is a
 * real Request (fetch() and new Request() accept it) whose header reads count
 * against the rendered request; handing it over is not a read. The URL is not
 * counted: shared PPR and ISR caches already key on it.
 */
function getAppRequestView(request: Request): Request {
  const existing = appRequestViews.get(request);
  if (existing) return existing;
  let view: Request;
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Copying a request with a body would take it from the caller; such a
    // request is never a shared render anyway, so count it up front.
    countRequestRead(request);
    view = request;
  } else {
    view = new Request(request);
    Object.defineProperties(view, {
      // The rendered request's own signal, so aborting it reaches the handler unchanged.
      signal: { configurable: true, get: () => request.signal },
      headers: {
        configurable: true,
        get() {
          _assertRequestReadAllowed("request.headers");
          countRequestRead(request);
          return request.headers;
        },
      },
      clone: {
        configurable: true,
        value() {
          _assertRequestReadAllowed("request.clone()");
          countRequestRead(request);
          return request.clone();
        },
      },
    });
  }
  appRequestViews.set(request, view);
  return view;
}

_setCurrentRequestResolver(() => requestStore.getStore());

// The CSP nonce of the response being rendered. It is scoped apart from the
// request because rewrites and middleware replace the Request object while
// the response (and its nonce) stays the same.
const CSP_NONCE_STORAGE_KEY = Symbol.for("@farm.js/core/csp-nonce-storage");

function getCspNonceStore(): AsyncLocalStorage<string> {
  const runtime = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  const existing = runtime[CSP_NONCE_STORAGE_KEY];
  if (existing instanceof AsyncLocalStorage) return existing as AsyncLocalStorage<string>;
  const storage = new AsyncLocalStorage<string>();
  runtime[CSP_NONCE_STORAGE_KEY] = storage;
  return storage;
}

const cspNonceStore = getCspNonceStore();
_setCspNonceResolver(() => cspNonceStore.getStore());

/** @internal Run `fn` while rendering a response that carries `nonce`. */
export function _runWithFarmCspNonce<T>(nonce: string | undefined, fn: () => T): T {
  return nonce ? cspNonceStore.run(nonce, fn) : fn();
}
_setAppRequestView(getAppRequestView);

export interface FarmRequestURLOptions {
  origin?: string | URL;
  trustProxy?: boolean;
}

export function resolveFarmRequestURL(req: FarmRequest, options: FarmRequestURLOptions = {}): URL {
  if (options.origin) {
    return new URL(req.url || "/", options.origin);
  }

  const forwardedHost = options.trustProxy
    ? firstForwardedHeaderValue(req.headers["x-forwarded-host"])
    : undefined;
  const fallbackHost = firstForwardedHeaderValue(req.headers.host) || "localhost";
  const forwardedProto = options.trustProxy
    ? firstForwardedHeaderValue(req.headers["x-forwarded-proto"])
    : undefined;
  const normalizedProto = forwardedProto?.toLowerCase();
  const proto =
    normalizedProto === "https" || normalizedProto === "http"
      ? normalizedProto
      : isEncryptedFarmRequest(req)
        ? "https"
        : "http";
  return new URL(req.url || "/", resolveRequestOrigin(proto, forwardedHost, fallbackHost));
}

/**
 * The public origin of a web `Request`, for the production runtime. The
 * adapter's `request.url` is authoritative unless `trustProxy` is on; then
 * `X-Forwarded-Host` and `X-Forwarded-Proto` override it with the same
 * validation `resolveFarmRequestURL` applies to a Node request in development.
 */
export function resolveFarmWebRequestOrigin(
  request: Request,
  options: Pick<FarmRequestURLOptions, "trustProxy"> = {},
): string {
  const url = new URL(request.url);
  if (!options.trustProxy) return url.origin;

  const forwardedHost = firstForwardedHeaderValue(
    request.headers.get("x-forwarded-host") ?? undefined,
  );
  const forwardedProto = firstForwardedHeaderValue(
    request.headers.get("x-forwarded-proto") ?? undefined,
  )?.toLowerCase();
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : url.protocol === "https:"
        ? "https"
        : "http";
  return resolveRequestOrigin(proto, forwardedHost, url.host);
}

export function createWebRequestFromFarmRequest(
  req: FarmRequest,
  options: FarmRequestURLOptions = {},
): Request {
  const fullUrl = resolveFarmRequestURL(req, options).toString();

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }

  const method = (req.method || "GET").toUpperCase();
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }

  return new Request(fullUrl, init);
}

function isEncryptedFarmRequest(req: FarmRequest): boolean {
  return Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted);
}

function firstForwardedHeaderValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const token = first?.split(",", 1)[0]?.trim();
  return token || undefined;
}

function resolveRequestOrigin(proto: "http" | "https", host: string | undefined, fallback: string) {
  for (const candidate of [host, fallback, "localhost"]) {
    if (!candidate) continue;
    if (/[\s/?#@\\]/u.test(candidate)) continue;
    try {
      const url = new URL(`${proto}://${candidate}`);
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) continue;
      return url.origin;
    } catch {
      // Try the next host instead of turning an untrusted proxy header into a 500.
    }
  }
  return `${proto}://localhost`;
}

export async function _runWithCurrentRequest<T>(
  request: Request,
  fn: () => Promise<T> | T,
): Promise<T> {
  return requestStore.run(request, fn);
}

export function getCurrentRequest(): Request {
  _assertRequestReadAllowed("getCurrentRequest()");
  const request = requestStore.getStore();
  if (!request) {
    throw new Error(
      "No current request is available. getCurrentRequest() can only be used during server rendering.",
    );
  }

  countRequestRead(request);
  return request;
}

/**
 * @internal How many times app code has read `request` (default: the current
 * request). Compare two readings to learn whether a render read the request.
 */
export function _getRequestReadCount(
  request: Request | undefined = requestStore.getStore(),
): number {
  return request ? (requestReads.get(request) ?? 0) : 0;
}

// Some runtimes (StackBlitz WebContainers among them) lose AsyncLocalStorage
// context across async boundaries mid-render. Callers whose feature can
// degrade gracefully should use this instead of getCurrentRequest() so a
// missing store never turns into a 500.
export function getCurrentRequestOrNull(): Request | null {
  return requestStore.getStore() ?? null;
}
