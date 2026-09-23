import { AsyncLocalStorage } from "node:async_hooks";
import { Readable } from "node:stream";
import type { FarmRequest } from "../types";
import { _setCurrentRequestResolver } from "./request-bridge";

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

_setCurrentRequestResolver(() => requestStore.getStore());

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
  const request = requestStore.getStore();
  if (!request) {
    throw new Error(
      "No current request is available. getCurrentRequest() can only be used during server rendering.",
    );
  }

  return request;
}

// Some runtimes (StackBlitz WebContainers among them) lose AsyncLocalStorage
// context across async boundaries mid-render. Callers whose feature can
// degrade gracefully should use this instead of getCurrentRequest() so a
// missing store never turns into a 500.
export function getCurrentRequestOrNull(): Request | null {
  return requestStore.getStore() ?? null;
}
