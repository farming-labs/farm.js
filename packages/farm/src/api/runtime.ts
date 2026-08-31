import { _runWithCurrentRequest } from "../server/request";
import {
  decodeFarmCacheInvalidations,
  encodeFarmCacheInvalidations,
  FARM_CACHE_INVALIDATION_HEADER,
} from "../cache-invalidation";
import { isEndpointFailure, type EndpointFailure } from "./endpoint";
import {
  bufferFarmRequestBody,
  createFarmRequestBodyErrorResponse,
  DEFAULT_FARM_SERVER_BODY_SIZE_LIMIT,
} from "../server-http";
import { DEFAULT_FARM_API_BASE_PATH, normalizeFarmAPIBasePath } from "./config";
import { resolveFarmAPICanonicalPathname } from "./server-path";
import { compareRouteSpecificity, type RouteSegmentSpecificity } from "../routing/specificity";

export type APIRouteParamValue = string | string[];
export type APIRouteParams = Record<string, APIRouteParamValue>;

export interface APIRouteMatch<T extends { path: string }> {
  route: T;
  params: APIRouteParams;
}

interface APIRouteMethodTable {
  methods: string[];
  endpoints: Record<string, any>;
}

export function resolveAPIRouteEndpoint(
  route: APIRouteMethodTable,
  method: string,
): any | undefined {
  const normalizedMethod = method.toUpperCase();
  return (
    route.endpoints[normalizedMethod] ??
    (normalizedMethod === "HEAD" ? route.endpoints.GET : undefined)
  );
}

export function getAllowedAPIRouteMethods(route: APIRouteMethodTable): string[] {
  const methods = [...route.methods];
  const getIndex = methods.indexOf("GET");
  if (getIndex >= 0 && !methods.includes("HEAD")) {
    methods.splice(getIndex + 1, 0, "HEAD");
  }
  return methods;
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

  let bestMatch: APIRouteMatch<T> | null = null;
  let bestSpecificity: RouteSegmentSpecificity[] | null = null;

  for (const route of routes.values()) {
    const params = matchRoutePath(route.path, pathname);
    if (!params) continue;

    const specificity = getAPIRouteSpecificity(route.path);
    if (bestSpecificity === null || compareRouteSpecificity(specificity, bestSpecificity) < 0) {
      bestMatch = { route, params };
      bestSpecificity = specificity;
    }
  }

  return bestMatch;
}

/** Match canonical routes through a configurable same-origin public API path. */
export function matchAPIRouteAtBasePath<T extends { path: string }>(
  routes: Map<string, T>,
  pathname: string,
  serverBasePath = DEFAULT_FARM_API_BASE_PATH,
): APIRouteMatch<T> | null {
  const directMatch = matchAPIRoute(routes, pathname);
  if (directMatch) return directMatch;

  const canonicalPathname = resolveFarmAPICanonicalPathname(pathname, serverBasePath);
  return canonicalPathname === pathname ? null : matchAPIRoute(routes, canonicalPathname);
}

/** Test whether a pathname belongs to the configured local API surface. */
export function isFarmAPIPathname(
  pathname: string,
  serverBasePath = DEFAULT_FARM_API_BASE_PATH,
): boolean {
  const basePath = normalizeFarmAPIBasePath(serverBasePath);
  return basePath !== "/" && (pathname === basePath || pathname.startsWith(`${basePath}/`));
}

export async function invokeAPIRouteEndpoint(
  endpoint: any,
  request: Request,
  params: APIRouteParams = {},
  bodySizeLimit = DEFAULT_FARM_SERVER_BODY_SIZE_LIMIT,
): Promise<Response> {
  try {
    request = await bufferFarmRequestBody(request, bodySizeLimit);
  } catch (error) {
    const response = createFarmRequestBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const response = await _runWithCurrentRequest(request, () =>
    invokeAPIRouteEndpointInContext(endpoint, request, params),
  );

  if (request.method.toUpperCase() !== "HEAD") {
    return response;
  }

  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function invokeAPIRouteEndpointInContext(
  endpoint: any,
  request: Request,
  params: APIRouteParams,
): Promise<Response> {
  const queryContentTypeError = validateQueryContentType(request);
  if (queryContentTypeError) {
    return queryContentTypeError;
  }

  const farmHandler = endpoint.__handler || (isFarmContextHandler(endpoint) ? endpoint : null);

  if (!farmHandler) {
    const result = await endpoint(request, {
      params: Promise.resolve(params),
    });
    return normalizeRouteResponse(result);
  }

  const url = new URL(request.url);
  // Repeated keys collect into arrays, the same representation the rest of the
  // framework hands to routes, and the same helper this path already uses for
  // urlencoded and multipart bodies. Spread back onto a normal object so an
  // endpoint without a query schema still receives the object shape it did
  // before; `entriesToObject` has already dropped the prototype-poisoning keys.
  const query: Record<string, string | string[]> = {
    ...searchParamsToObject(url.searchParams),
  };

  let body: any = undefined;
  if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
    const parsedBody = await readRequestBody(request);
    if (parsedBody.error) return parsedBody.error;
    body = parsedBody.body;
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

function validateQueryContentType(request: Request): Response | null {
  if (request.method.toUpperCase() !== "QUERY" || request.headers.has("content-type")) {
    return null;
  }

  return new Response(
    JSON.stringify({
      error: "Invalid QUERY request",
      message: "QUERY requests must include a Content-Type header.",
    }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    },
  );
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

interface RequestBodyParseResult {
  body?: unknown;
  error?: Response;
}

async function readRequestBody(request: Request): Promise<RequestBodyParseResult> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();

  try {
    if (contentType === "multipart/form-data") {
      return { body: formDataToObject(await request.clone().formData()) };
    }

    const text = await request.clone().text();
    if (!text) return { body: undefined };
    if (contentType === "application/x-www-form-urlencoded") {
      return { body: searchParamsToObject(new URLSearchParams(text)) };
    }
    if (contentType === "application/json" || contentType?.endsWith("+json")) {
      return { body: JSON.parse(text) };
    }

    // Preserve the previous permissive behavior for callers that omit the
    // content type but still send JSON.
    return { body: JSON.parse(text) };
  } catch {
    if (contentType === "application/json" || contentType?.endsWith("+json")) {
      return {
        error: new Response(
          JSON.stringify({
            error: "Invalid request body",
            message: "The request body is not valid JSON.",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      };
    }
    // The body format is unsupported or malformed. Schema validation below
    // will turn the missing value into a typed 400 response when applicable.
  }

  return { body: undefined };
}

function formDataToObject(
  formData: FormData,
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  return entriesToObject(formData.entries());
}

function searchParamsToObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  return entriesToObject(searchParams.entries());
}

function entriesToObject<TValue>(
  entries: IterableIterator<[string, TValue]>,
): Record<string, TValue | TValue[]> {
  const output: Record<string, TValue | TValue[]> = Object.create(null);
  for (const [key, value] of entries) {
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

function getAPIRouteSpecificity(routePath: string): RouteSegmentSpecificity[] {
  return getPathSegments(routePath).map((segment) => {
    const dynamic = parseDynamicSegment(segment);
    if (!dynamic) return "static";
    if (!dynamic.catchAll) return "dynamic";
    return dynamic.optional ? "optional-catch-all" : "catch-all";
  });
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
