import { AsyncLocalStorage } from "node:async_hooks";
import type { FarmRequest } from "../types";
import { _setCurrentRequestResolver } from "./request-bridge";

const requestStore = new AsyncLocalStorage<Request>();

_setCurrentRequestResolver(() => requestStore.getStore());

export function createWebRequestFromFarmRequest(req: FarmRequest): Request {
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req.headers.host || "localhost";
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "http";
  const fullUrl = new URL(req.url || "/", `${proto}://${host}`).toString();

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

  return new Request(fullUrl, {
    method: req.method,
    headers,
  });
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
