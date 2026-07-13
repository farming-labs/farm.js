import { createElement, type ReactElement } from "react";
import { invokeAPIRouteEndpoint, matchAPIRoute, type APIRouteParams } from "./api/route-manager";
import { getFarmDataCache } from "./cache";
import { resolveFarmRouteContext, withFarmRouteContext } from "./route-context";
import {
  createRouteModuleFromProgrammaticPage,
  type InferProgrammaticRouteData,
  type ProgrammaticApiRoute,
  type ProgrammaticPageRoute,
  type ProgrammaticRouteComponentProps,
  type ProgrammaticRouteMethod,
} from "./routes";
import {
  buildFarmRoutePath,
  matchFarmRoute,
  type FarmRouterPathParams,
  type FarmRouterQueryValue,
} from "./router";
import { runWithServerActionRequest } from "./server-action-security";
import type { ServerFn } from "./server-fn";
import type { FarmContextFactory, MiddlewareProps, PluginContextProps, RouteModule } from "./types";

export type FarmTestQuery = URLSearchParams | Record<string, FarmRouterQueryValue>;
export type FarmTestPathParams = FarmRouterPathParams;
export type FarmTestFormValues = Record<string, FormDataEntryValue | readonly FormDataEntryValue[]>;

export interface FarmTestRequestOptions extends Omit<RequestInit, "body" | "headers"> {
  origin?: string;
  headers?: HeadersInit;
  query?: FarmTestQuery;
  cookies?: Record<string, string>;
  json?: unknown;
  form?: FormData | FarmTestFormValues;
  body?: BodyInit | null;
}

export interface FarmTestHarnessOptions<TContext = unknown> {
  origin?: string;
  headers?: HeadersInit;
  cookies?: Record<string, string>;
  context?: FarmContextFactory<TContext>;
}

type AnyProgrammaticPageRoute = ProgrammaticPageRoute<any, any, any, any>;

export type InferFarmTestRouteParams<TRoute> =
  TRoute extends ProgrammaticPageRoute<infer TParams, any, any, any> ? TParams : never;

export type InferFarmTestRouteSearch<TRoute> =
  TRoute extends ProgrammaticPageRoute<any, infer TSearch, any, any> ? TSearch : never;

export type InferFarmTestRouteData<TRoute> =
  TRoute extends ProgrammaticPageRoute<any, any, infer TDataHooks, any>
    ? InferProgrammaticRouteData<TDataHooks>
    : never;

export type FarmTestRouteProps<TRoute extends AnyProgrammaticPageRoute> =
  ProgrammaticRouteComponentProps<
    InferFarmTestRouteParams<TRoute>,
    InferFarmTestRouteSearch<TRoute>,
    InferFarmTestRouteData<TRoute>
  >;

type FarmTestRouteParamsInput<TRoute> =
  InferFarmTestRouteParams<TRoute> extends Record<string, unknown>
    ? Partial<InferFarmTestRouteParams<TRoute>>
    : FarmTestPathParams;

type FarmTestRouteSearchInput<TRoute> =
  InferFarmTestRouteSearch<TRoute> extends Record<string, unknown>
    ? Partial<InferFarmTestRouteSearch<TRoute>> | URLSearchParams
    : FarmTestQuery;

export interface FarmTestRouteOptions<
  TRoute extends AnyProgrammaticPageRoute,
  TContext = unknown,
> extends Pick<FarmTestRequestOptions, "origin" | "headers" | "cookies" | "signal"> {
  path?: string | URL;
  params?: FarmTestRouteParamsInput<TRoute>;
  search?: FarmTestRouteSearchInput<TRoute>;
  context?: TContext;
  middleware?: MiddlewareProps;
  pluginContext?: PluginContextProps;
}

export interface FarmTestRouteResult<TRoute extends AnyProgrammaticPageRoute> {
  route: TRoute;
  module: RouteModule;
  request: Request;
  props: FarmTestRouteProps<TRoute>;
  element: ReactElement;
  canonicalPath?: string;
}

export interface FarmTestApiOptions extends FarmTestRequestOptions {
  path?: string | URL;
  params?: FarmTestPathParams;
  throwOnError?: boolean;
}

export interface FarmTestEndpointOptions extends FarmTestRequestOptions {
  path?: string | URL;
  params?: APIRouteParams;
  throwOnError?: boolean;
}

export interface FarmTestServerFnOptions extends Pick<
  FarmTestRequestOptions,
  "origin" | "headers" | "cookies" | "signal"
> {
  path?: string | URL;
  request?: Request;
}

export type FarmTestServerFnArguments<TInput> = [unknown] extends [TInput]
  ? [input?: TInput | FormData, options?: FarmTestServerFnOptions]
  : [input: TInput | FormData, options?: FarmTestServerFnOptions];

export interface FarmTestHarness<TContext = unknown> {
  request(path?: string | URL, options?: FarmTestRequestOptions): Request;
  route<TRoute extends AnyProgrammaticPageRoute>(
    route: TRoute,
    options?: FarmTestRouteOptions<TRoute, TContext>,
  ): Promise<FarmTestRouteResult<TRoute>>;
  api(route: ProgrammaticApiRoute, options?: FarmTestApiOptions): Promise<Response>;
  endpoint(endpoint: unknown, options?: FarmTestEndpointOptions): Promise<Response>;
  serverFn<TInput, TResult>(
    serverFn: ServerFn<TInput, TResult>,
    ...args: FarmTestServerFnArguments<TInput>
  ): Promise<TResult>;
  clearCache(): void;
}

/** Create a deterministic Web Request without depending on a test runner. */
export function createTestRequest(
  path: string | URL = "/",
  options: FarmTestRequestOptions = {},
): Request {
  const url = resolveTestURL(path, options.origin);
  applyQuery(url.searchParams, options.query);

  const headers = new Headers(options.headers);
  applyCookies(headers, options.cookies);
  const { body, hasBody } = resolveRequestBody(options, headers);
  const method = (options.method ?? (hasBody ? "POST" : "GET")).toUpperCase();

  if ((method === "GET" || method === "HEAD") && body != null) {
    throw new TypeError(`Farm test requests cannot send a body with ${method}`);
  }

  const {
    origin: _origin,
    query: _query,
    cookies: _cookies,
    json: _json,
    form: _form,
    body: _body,
    headers: _headers,
    ...requestInit
  } = options;

  return new Request(url, {
    ...requestInit,
    method,
    headers,
    body,
  });
}

/**
 * Create test helpers that exercise Farm's real route, API, and server-function runtimes.
 * The harness has no dependency on Vitest, Jest, or a DOM environment.
 */
export function createFarmTestHarness<TContext = unknown>(
  options: FarmTestHarnessOptions<TContext> = {},
): FarmTestHarness<TContext> {
  const origin = normalizeOrigin(options.origin);

  const request = (path: string | URL = "/", requestOptions: FarmTestRequestOptions = {}) =>
    createTestRequest(path, mergeRequestDefaults(options, origin, requestOptions));

  return {
    request,

    async route<TRoute extends AnyProgrammaticPageRoute>(
      route: TRoute,
      routeOptions: FarmTestRouteOptions<TRoute, TContext> = {},
    ): Promise<FarmTestRouteResult<TRoute>> {
      const requestPath =
        routeOptions.path ??
        buildFarmRoutePath(route.path, (routeOptions.params ?? {}) as FarmRouterPathParams);
      const routeRequest = request(requestPath, {
        origin: routeOptions.origin,
        headers: routeOptions.headers,
        cookies: routeOptions.cookies,
        signal: routeOptions.signal,
        query: routeOptions.search as FarmTestQuery | undefined,
      });
      const url = new URL(routeRequest.url);
      const params = resolvePageParams(route.path, url.pathname, routeOptions.params);
      const search = readSearchParams(url.searchParams);
      const routeContext = Object.prototype.hasOwnProperty.call(routeOptions, "context")
        ? routeOptions.context
        : await resolveFarmRouteContext(
            { context: options.context },
            {
              request: routeRequest,
              params,
              search,
              path: url.pathname,
            },
          );
      const rawProps = withFarmRouteContext(
        {
          params,
          searchParams: Promise.resolve(search),
          path: url.pathname,
          middleware: routeOptions.middleware,
          context: routeOptions.pluginContext,
        },
        routeContext,
      );
      const routeModule = createRouteModuleFromProgrammaticPage(route);
      const resolveProps = (
        routeModule as RouteModule & {
          __farmResolveRouteProps?: (props: typeof rawProps) => Promise<Record<string, unknown>>;
        }
      ).__farmResolveRouteProps;
      const resolvedProps = resolveProps
        ? await resolveProps(rawProps)
        : { ...rawProps, search, searchParams: Promise.resolve(search) };
      const canonicalPath = readCanonicalPath(resolvedProps);
      const componentProps = stripInternalRouteProps(resolvedProps) as FarmTestRouteProps<TRoute>;

      return {
        route,
        module: routeModule,
        request: routeRequest,
        props: componentProps,
        element: createElement(route.component, componentProps),
        canonicalPath,
      };
    },

    async api(route, apiOptions = {}) {
      const requestPath =
        apiOptions.path ?? buildFarmRoutePath(route.path, apiOptions.params ?? {});
      const method = apiOptions.method ?? getDefaultApiMethod(route);
      const apiRequest = request(requestPath, omitApiControlOptions({ ...apiOptions, method }));
      const match = matchAPIRoute(new Map([[route.path, route]]), new URL(apiRequest.url).pathname);

      if (!match) {
        return jsonErrorResponse("Not Found", 404);
      }

      const endpoint = match.route.methods[apiRequest.method as ProgrammaticRouteMethod];
      if (!endpoint) {
        return jsonErrorResponse("Method Not Allowed", 405);
      }

      return invokeTestEndpoint(endpoint, apiRequest, match.params, apiOptions.throwOnError);
    },

    async endpoint(endpoint, endpointOptions = {}) {
      const endpointRecord = endpoint as { __method?: string; __path?: string };
      const endpointPath = endpointOptions.path ?? endpointRecord.__path ?? "/__farm/test/endpoint";
      const endpointRequest = request(endpointPath, {
        ...omitEndpointControlOptions(endpointOptions),
        method: endpointOptions.method ?? endpointRecord.__method ?? "GET",
      });

      return invokeTestEndpoint(
        endpoint,
        endpointRequest,
        endpointOptions.params,
        endpointOptions.throwOnError,
      );
    },

    async serverFn<TInput, TResult>(
      serverFn: ServerFn<TInput, TResult>,
      ...args: FarmTestServerFnArguments<TInput>
    ): Promise<TResult> {
      const [input, serverFnOptions = {}] = args;
      const actionRequest =
        serverFnOptions.request ??
        request(serverFnOptions.path ?? "/__farm/test/server-fn", {
          origin: serverFnOptions.origin,
          headers: serverFnOptions.headers,
          cookies: serverFnOptions.cookies,
          signal: serverFnOptions.signal,
          method: "POST",
        });

      return await runWithServerActionRequest(actionRequest, () => serverFn(input as TInput));
    },

    clearCache() {
      getFarmDataCache().clear();
    },
  };
}

function resolveTestURL(path: string | URL, origin: string | undefined): URL {
  const url = path instanceof URL ? new URL(path) : new URL(path, `${normalizeOrigin(origin)}/`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Farm test requests require an HTTP(S) URL, received ${url.protocol}`);
  }
  return url;
}

function normalizeOrigin(origin = "http://farm.test"): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new TypeError(`Invalid Farm test origin: ${JSON.stringify(origin)}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Farm test origins must use HTTP(S), received ${url.protocol}`);
  }

  return url.origin;
}

function mergeRequestDefaults<TContext>(
  harnessOptions: FarmTestHarnessOptions<TContext>,
  origin: string,
  requestOptions: FarmTestRequestOptions,
): FarmTestRequestOptions {
  const headers = new Headers(harnessOptions.headers);
  new Headers(requestOptions.headers).forEach((value, key) => headers.set(key, value));

  return {
    ...requestOptions,
    origin: requestOptions.origin ?? origin,
    headers,
    cookies: {
      ...harnessOptions.cookies,
      ...requestOptions.cookies,
    },
  };
}

function applyQuery(searchParams: URLSearchParams, query: FarmTestQuery | undefined): void {
  if (!query) return;

  if (query instanceof URLSearchParams) {
    for (const key of new Set(query.keys())) {
      searchParams.delete(key);
      for (const value of query.getAll(key)) searchParams.append(key, value);
    }
    return;
  }

  for (const [key, rawValue] of Object.entries(query)) {
    searchParams.delete(key);
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value == null) continue;
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new TypeError(`Invalid query value for ${JSON.stringify(key)}`);
      }
      searchParams.append(key, String(value));
    }
  }
}

function applyCookies(headers: Headers, cookies: Record<string, string> | undefined): void {
  if (!cookies || Object.keys(cookies).length === 0) return;

  const value = Object.entries(cookies)
    .map(([name, cookieValue]) => `${encodeURIComponent(name)}=${encodeURIComponent(cookieValue)}`)
    .join("; ");
  const current = headers.get("cookie");
  headers.set("cookie", current ? `${current}; ${value}` : value);
}

function resolveRequestBody(
  options: FarmTestRequestOptions,
  headers: Headers,
): { body: BodyInit | null; hasBody: boolean } {
  const sources = [
    options.json !== undefined,
    options.form !== undefined,
    options.body !== undefined,
  ];
  if (sources.filter(Boolean).length > 1) {
    throw new TypeError("Farm test requests accept only one of json, form, or body");
  }

  if (options.json !== undefined) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return { body: JSON.stringify(options.json), hasBody: true };
  }

  if (options.form !== undefined) {
    const formData = options.form instanceof FormData ? options.form : createFormData(options.form);
    return { body: formData, hasBody: true };
  }

  return {
    body: options.body ?? null,
    hasBody: options.body !== undefined,
  };
}

function createFormData(values: FarmTestFormValues): FormData {
  const formData = new FormData();
  for (const [key, rawValue] of Object.entries(values)) {
    const entries = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of entries) formData.append(key, value);
  }
  return formData;
}

function resolvePageParams(
  pattern: string,
  pathname: string,
  explicitParams: Record<string, unknown> | undefined,
): Record<string, string> {
  const matchedParams = matchFarmRoute(pattern, pathname);
  if (!matchedParams) {
    throw new Error(
      `Path ${JSON.stringify(pathname)} does not match route ${JSON.stringify(pattern)}`,
    );
  }

  if (!explicitParams) return matchedParams;

  return Object.fromEntries(
    Object.entries(explicitParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map(String).join("/") : String(value),
    ]),
  );
}

function readSearchParams(searchParams: URLSearchParams): Record<string, string> {
  const search: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    search[key] = value;
  });
  return search;
}

function readCanonicalPath(props: Record<string, unknown>): string | undefined {
  return typeof props.__farmCanonicalPath === "string" ? props.__farmCanonicalPath : undefined;
}

function stripInternalRouteProps(props: Record<string, unknown>): Record<string, unknown> {
  const { __farmRoutePropsResolved, __farmCanonicalPath, ...componentProps } = props;
  return componentProps;
}

function getDefaultApiMethod(route: ProgrammaticApiRoute): ProgrammaticRouteMethod {
  if (route.methods.GET) return "GET";
  return (Object.keys(route.methods)[0] as ProgrammaticRouteMethod | undefined) ?? "GET";
}

function omitApiControlOptions(options: FarmTestApiOptions): FarmTestRequestOptions {
  const { path: _path, params: _params, throwOnError: _throwOnError, ...requestOptions } = options;
  return requestOptions;
}

function omitEndpointControlOptions(options: FarmTestEndpointOptions): FarmTestRequestOptions {
  const { path: _path, params: _params, throwOnError: _throwOnError, ...requestOptions } = options;
  return requestOptions;
}

async function invokeTestEndpoint(
  endpoint: unknown,
  request: Request,
  params: APIRouteParams = {},
  throwOnError = false,
): Promise<Response> {
  try {
    return await invokeAPIRouteEndpoint(endpoint, request, params);
  } catch (error) {
    if (throwOnError) throw error;
    return jsonErrorResponse(error instanceof Error ? error.message : "Internal Server Error", 500);
  }
}

function jsonErrorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}
