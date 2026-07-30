import { _runWithCurrentRequest } from "../server/request";
import {
  decodeFarmCacheInvalidations,
  encodeFarmCacheInvalidations,
  FARM_CACHE_INVALIDATION_HEADER,
} from "../cache-invalidation";
import { isEndpointFailure, type EndpointFailure } from "./endpoint";

export type APIRouteParamValue = string | string[];
export type APIRouteParams = Record<string, APIRouteParamValue>;

export interface APIRouteMatch<T extends { path: string }> {
  route: T;
  params: APIRouteParams;
}

export function matchAPIRoute<T extends { path: string }>(
  routes: Map<string, T>,
  pathname: string,
): APIRouteMatch<T> | null {
  const exactRoute = routes.get(pathname);
  if (exactRoute) {
    return { route: exactRoute, params: {} };
  }

  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname !== pathname) {
    const normalizedRoute = routes.get(normalizedPathname);
    if (normalizedRoute) {
      return { route: normalizedRoute, params: {} };
    }
  }

  for (const route of routes.values()) {
    const params = matchRoutePath(route.path, pathname);
    if (params) {
      return { route, params };
    }
  }

  return null;
}

export async function invokeAPIRouteEndpoint(
  endpoint: any,
  request: Request,
  params: APIRouteParams = {},
): Promise<Response> {
  return _runWithCurrentRequest(request, () =>
    invokeAPIRouteEndpointInContext(endpoint, request, params),
  );
}

async function invokeAPIRouteEndpointInContext(
  endpoint: any,
  request: Request,
  params: APIRouteParams,
): Promise<Response> {
  const farmHandler = endpoint.__handler || (isFarmContextHandler(endpoint) ? endpoint : null);

  if (!farmHandler) {
    const result = await endpoint(request, {
      params: Promise.resolve(params),
    });
    return normalizeRouteResponse(result);
  }

  const url = new URL(request.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  let body: any = undefined;
  if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
    body = await readRequestBody(request);
  }

  const headers = Object.fromEntries(request.headers.entries());
  const types = endpoint.__types || {};

  const queryValidation = validateInput(types.query, query, "Invalid query parameters");
  if (queryValidation instanceof Response) {
    return queryValidation;
  }

  const bodyValidation = validateInput(types.body, body, "Invalid request body");
  if (bodyValidation instanceof Response) {
    return bodyValidation;
  }

  const headersValidation = validateInput(types.headers, headers, "Invalid request headers");
  if (headersValidation instanceof Response) {
    return headersValidation;
  }

  const handlerContext = {
    query: queryValidation,
    body: bodyValidation,
    headers: headersValidation,
    request,
    context: {},
    params,
  };
  let execution: {
    result: unknown;
    context: unknown;
    handlerExecuted: boolean;
    invalidations: readonly string[];
  };
  try {
    execution =
      typeof endpoint.__farmInvoke === "function"
        ? await endpoint.__farmInvoke(handlerContext)
        : {
            result: await farmHandler(handlerContext),
            context: handlerContext.context,
            handlerExecuted: true,
            invalidations: [],
          };
  } catch (error) {
    if (isEndpointFailure(error)) {
      return createEndpointFailureResponse(error);
    }
    throw error;
  }

  const response = normalizeRouteResponse(execution.result);
  return attachEndpointInvalidations(response, execution.invalidations);
}

export function normalizeRouteResponse(result: unknown): Response {
  if (isWebResponse(result)) {
    return result;
  }

  if (result === undefined) {
    return new Response(null, { status: 204 });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function isWebResponse(value: unknown): value is Response {
  return (
    value instanceof Response ||
    (typeof value === "object" &&
      value !== null &&
      "headers" in value &&
      "status" in value &&
      typeof (value as Response).arrayBuffer === "function")
  );
}

function attachEndpointInvalidations(response: Response, keys: readonly string[]): Response {
  const existing = decodeFarmCacheInvalidations(
    response.headers.get(FARM_CACHE_INVALIDATION_HEADER),
  );
  const encoded = encodeFarmCacheInvalidations([...existing, ...keys]);
  if (!encoded) return response;

  const headers = new Headers(response.headers);
  headers.set(FARM_CACHE_INVALIDATION_HEADER, encoded);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createEndpointFailureResponse(failure: EndpointFailure<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: failure.code,
        message: failure.message,
        data: failure.data,
      },
    }),
    {
      status: failure.status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
      },
    },
  );
}

function isFarmContextHandler(endpoint: unknown): boolean {
  if (typeof endpoint !== "function") {
    return false;
  }

  const source = Function.prototype.toString.call(endpoint).trim();
  const arrowMatch = source.match(/^(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/);
  const functionMatch = source.match(/^(?:async\s*)?function[^(]*\(([^)]*)\)/);
  const firstParameter = (arrowMatch?.[1] || arrowMatch?.[2] || functionMatch?.[1] || "")
    .split(",")[0]
    .trim();

  return firstParameter === "ctx" || firstParameter === "context" || firstParameter.startsWith("{");
}

async function readRequestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();

  try {
    const text = await request.clone().text();
    if (!text) return undefined;
    if (contentType === "application/x-www-form-urlencoded") {
      return searchParamsToObject(new URLSearchParams(text));
    }
    if (contentType === "application/json" || contentType?.endsWith("+json")) {
      return JSON.parse(text);
    }

    // Preserve the previous permissive behavior for callers that omit the
    // content type but still send JSON.
    return JSON.parse(text);
  } catch {
    // The body format is unsupported or malformed. Schema validation below
    // will turn the missing value into a typed 400 response when applicable.
  }

  return undefined;
}

function searchParamsToObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of searchParams) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const current = output[key];
    if (current === undefined) {
      output[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      output[key] = [current, value];
    }
  }
  return output;
}

function validateInput(schema: any, value: unknown, error: string): unknown | Response {
  if (!schema || typeof schema.parse !== "function") {
    return value;
  }

  try {
    return schema.parse(value);
  } catch (validationError: any) {
    return new Response(
      JSON.stringify({
        error,
        details: validationError.errors || validationError.issues || validationError.message,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

function matchRoutePath(routePath: string, pathname: string): APIRouteParams | null {
  const routeSegments = getPathSegments(routePath);
  const pathnameSegments = getPathSegments(pathname);
  const params: APIRouteParams = {};
  let pathIndex = 0;

  for (const routeSegment of routeSegments) {
    const dynamicSegment = parseDynamicSegment(routeSegment);

    if (dynamicSegment?.catchAll) {
      const remainingSegments = pathnameSegments.slice(pathIndex).map(decodePathSegment);
      if (remainingSegments.length === 0 && !dynamicSegment.optional) {
        return null;
      }
      if (remainingSegments.length > 0) {
        params[dynamicSegment.name] = remainingSegments;
      }
      pathIndex = pathnameSegments.length;
      continue;
    }

    const pathnameSegment = pathnameSegments[pathIndex];
    if (pathnameSegment === undefined) {
      return null;
    }

    if (dynamicSegment) {
      params[dynamicSegment.name] = decodePathSegment(pathnameSegment);
      pathIndex++;
      continue;
    }

    if (routeSegment !== pathnameSegment) {
      return null;
    }

    pathIndex++;
  }

  return pathIndex === pathnameSegments.length ? params : null;
}

function getPathSegments(pathname: string): string[] {
  return normalizePathname(pathname)
    .split("/")
    .filter((segment) => segment.length > 0);
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }

  return pathname;
}

function parseDynamicSegment(
  segment: string,
): { name: string; catchAll: boolean; optional: boolean } | null {
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll?.[1]) {
    return { name: optionalCatchAll[1], catchAll: true, optional: true };
  }

  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll?.[1]) {
    return { name: catchAll[1], catchAll: true, optional: false };
  }

  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic?.[1]) {
    return { name: dynamic[1], catchAll: false, optional: false };
  }

  return null;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
