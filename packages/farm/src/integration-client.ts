import type {
  FarmIntegrationAPI,
  FarmIntegrationAPIBodyFormat,
  FarmIntegrationAPIOperation,
} from "./integration-api";
import type { FarmIntegration as FarmIntegrationDefinition } from "./integrations";
import { resolveFarmAPIRequestURL } from "./api/config";

/**
 * Small per-call integration metadata. When sent from a browser, values are
 * client-controlled and should be validated before authorization decisions.
 */
export type IntegrationClientData = Record<string, unknown>;

export type IntegrationClientOptions = {
  baseURL?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  data?: IntegrationClientData;
  isServer?: false | undefined;
};

type IntegrationRequestOptionsBase = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  data?: IntegrationClientData;
};

export type IntegrationClientRequestOptions = IntegrationRequestOptionsBase;

export type IntegrationServerRequestLike =
  | Request
  | {
      url?: string;
      headers?: HeadersInit;
    };

export type IntegrationServerClientOptions = Omit<IntegrationClientOptions, "isServer"> & {
  isServer: true;
  request?: IntegrationServerRequestLike;
  forwardHeaders?: boolean | readonly string[];
};

export type IntegrationServerClientRequestOptions = IntegrationRequestOptionsBase & {
  baseURL?: string;
  request?: IntegrationServerRequestLike;
  forwardHeaders?: boolean | readonly string[];
};

export class IntegrationClientError<TData = unknown> extends Error {
  readonly status: number;
  readonly response: Response;
  readonly data: TData | undefined;

  constructor(message: string, response: Response, data?: TData) {
    super(message);
    this.name = "IntegrationClientError";
    this.status = response.status;
    this.response = response;
    this.data = data;
  }
}

export type IntegrationOperationResult<
  TData = unknown,
  TError = IntegrationClientError<unknown> | Error,
> = {
  data: TData | null;
  error: TError | null;
};

type ExtractOperationBody<T> = T extends {
  __types?: { body: infer TBody };
}
  ? TBody
  : never;

type ExtractOperationQuery<T> = T extends {
  __types?: { query: infer TQuery };
}
  ? TQuery
  : never;

type ExtractOperationResponse<T> = T extends {
  __types?: { response: infer TResponse };
}
  ? TResponse
  : unknown;

export type InferIntegrationOperationBody<T> = ExtractOperationBody<T>;
export type InferIntegrationOperationQuery<T> = ExtractOperationQuery<T>;
export type InferIntegrationOperationResponse<T> = ExtractOperationResponse<T>;

type IsNever<T> = [T] extends [never] ? true : false;

type OperationInput<T> =
  IsNever<ExtractOperationBody<T>> extends true
    ? IsNever<ExtractOperationQuery<T>> extends true
      ? {}
      : { query?: ExtractOperationQuery<T> }
    : IsNever<ExtractOperationQuery<T>> extends true
      ? { body: ExtractOperationBody<T> }
      : { body: ExtractOperationBody<T>; query?: ExtractOperationQuery<T> };

type ClientOperation<T> = (
  options?: OperationInput<T>,
  requestOptions?: IntegrationClientRequestOptions,
) => Promise<IntegrationOperationResult<ExtractOperationResponse<T>>>;

type ServerOperation<T> = (
  options?: OperationInput<T>,
  requestOptions?: IntegrationServerClientRequestOptions,
) => Promise<IntegrationOperationResult<ExtractOperationResponse<T>>>;

type IsUnion<T, U = T> = T extends any ? ([U] extends [T] ? false : true) : never;

type SingleKey<T> = [T] extends [never] ? never : IsUnion<T> extends true ? never : T;

type ExtractAPIFromSource<TSource> = TSource extends { api?: infer TAPI }
  ? NonNullable<TAPI> extends FarmIntegrationAPI
    ? NonNullable<TAPI>
    : never
  : TSource extends FarmIntegrationAPI
    ? TSource
    : never;

type SourceKeysWithAPI<TSources extends Record<string, any>> = {
  [K in keyof TSources]: [ExtractAPIFromSource<TSources[K]>] extends [never] ? never : K;
}[keyof TSources];

type IsServerRegisteredOperation<T> = T extends { isServer: true } ? true : false;

type ClientOperationKeys<TAPI> = {
  [K in keyof TAPI]: TAPI[K] extends FarmIntegrationAPIOperation<any, any, any, any>
    ? IsServerRegisteredOperation<TAPI[K]> extends true
      ? never
      : K
    : never;
}[keyof TAPI];

type ClientNamespaceShape<TAPI> = {
  [K in keyof TAPI as TAPI[K] extends FarmIntegrationAPIOperation<any, any, any, any>
    ? IsServerRegisteredOperation<TAPI[K]> extends true
      ? never
      : K
    : K]: TAPI[K] extends FarmIntegrationAPIOperation<any, any, any, any>
    ? ClientOperation<TAPI[K]>
    : TAPI[K] extends Record<string, any>
      ? IntegrationAPIToClient<TAPI[K]>
      : never;
};

type SingleClientOperationKey<TAPI> =
  Exclude<keyof TAPI, ClientOperationKeys<TAPI>> extends never
    ? SingleKey<ClientOperationKeys<TAPI>>
    : never;

type IntegrationAPIToClient<TAPI> =
  TAPI extends FarmIntegrationAPIOperation<any, any, any, any>
    ? ClientOperation<TAPI>
    : TAPI extends Record<string, any>
      ? [SingleClientOperationKey<TAPI>] extends [never]
        ? ClientNamespaceShape<TAPI>
        : SingleClientOperationKey<TAPI> extends keyof TAPI
          ? ClientOperation<TAPI[SingleClientOperationKey<TAPI>]> & ClientNamespaceShape<TAPI>
          : ClientNamespaceShape<TAPI>
      : never;

export type IntegrationClient<TSources extends Record<string, any>> = {
  [K in SourceKeysWithAPI<TSources>]: IntegrationAPIToClient<ExtractAPIFromSource<TSources[K]>>;
};

export type IntegrationClientRoot<TSources extends Record<string, any>> = {
  integrations: IntegrationClient<TSources>;
};

type ServerOperationKeys<TAPI> = {
  [K in keyof TAPI]: TAPI[K] extends FarmIntegrationAPIOperation<any, any, any> ? K : never;
}[keyof TAPI];

type ServerNamespaceShape<TAPI> = {
  [K in keyof TAPI]: TAPI[K] extends FarmIntegrationAPIOperation<any, any, any>
    ? ServerOperation<TAPI[K]>
    : TAPI[K] extends Record<string, any>
      ? IntegrationAPIToServerClient<TAPI[K]>
      : never;
};

type SingleServerOperationKey<TAPI> =
  Exclude<keyof TAPI, ServerOperationKeys<TAPI>> extends never
    ? SingleKey<ServerOperationKeys<TAPI>>
    : never;

type IntegrationAPIToServerClient<TAPI> =
  TAPI extends FarmIntegrationAPIOperation<any, any, any>
    ? ServerOperation<TAPI>
    : TAPI extends Record<string, any>
      ? [SingleServerOperationKey<TAPI>] extends [never]
        ? ServerNamespaceShape<TAPI>
        : SingleServerOperationKey<TAPI> extends keyof TAPI
          ? ServerOperation<TAPI[SingleServerOperationKey<TAPI>]> & ServerNamespaceShape<TAPI>
          : ServerNamespaceShape<TAPI>
      : never;

export type IntegrationServerClient<TSources extends Record<string, any>> = {
  [K in SourceKeysWithAPI<TSources>]: IntegrationAPIToServerClient<
    ExtractAPIFromSource<TSources[K]>
  >;
};

export type IntegrationServerClientRoot<TSources extends Record<string, any>> = {
  integrations: IntegrationServerClient<TSources>;
};

export type IntegrationClientAliases<TSources extends Record<string, any>> =
  IntegrationClient<TSources> & {
    integrations: IntegrationClient<TSources>;
  };

export type IntegrationServerClientAliases<TSources extends Record<string, any>> =
  IntegrationServerClient<TSources> & {
    integrations: IntegrationServerClient<TSources>;
  };

export type IntegrationAPI<TSources extends Record<string, any>> =
  IntegrationClientAliases<TSources> & {
    server: (
      options: Omit<IntegrationServerClientOptions, "isServer">,
    ) => IntegrationServerClientAliases<TSources>;
  };

export type IntegrationClients<TSources extends Record<string, any>> = {
  api: IntegrationServerClientAliases<TSources>;
  apiClient: IntegrationClientAliases<TSources>;
};

type ResolvedIntegrationNamespace = readonly [
  string,
  FarmIntegrationAPI,
  FarmIntegrationDefinition | FarmIntegrationAPI,
];

type RegisteredIntegrationRuntime = {
  integration: FarmIntegrationDefinition;
  config: unknown;
  isDev: boolean;
  isProd: boolean;
};

const INTEGRATION_RUNTIME_REGISTRY_KEY = Symbol.for("farm.integrationRuntimeRegistry");
const CURRENT_REQUEST_RESOLVER_KEY = Symbol.for("farm.currentRequestResolver");
const INTEGRATION_REQUEST_DISPATCHER_KEY = Symbol.for("farm.integrationRequestDispatcher");

type IntegrationRequestDispatcher = (
  runtime: RegisteredIntegrationRuntime,
  request: Request,
  options?: { currentRequest?: Request; data?: IntegrationClientData; internal?: boolean },
) => Promise<Response | null>;

type GlobalWithIntegrationRuntimeRegistry = typeof globalThis & {
  [INTEGRATION_RUNTIME_REGISTRY_KEY]?: Map<string, RegisteredIntegrationRuntime>;
  [CURRENT_REQUEST_RESOLVER_KEY]?: () => Request | undefined;
  [INTEGRATION_REQUEST_DISPATCHER_KEY]?: IntegrationRequestDispatcher;
};

type GlobalWithIntegrationAPIManifest = typeof globalThis & {
  __FARM_INTEGRATION_API_MANIFEST__?: Record<string, FarmIntegrationAPI>;
  window?: {
    __FARM_INTEGRATION_API_MANIFEST__?: Record<string, FarmIntegrationAPI>;
  };
};

function isOperation(value: unknown): value is FarmIntegrationAPIOperation<any, any, any, any> {
  return (
    !!value &&
    typeof value === "object" &&
    (value as FarmIntegrationAPIOperation<any, any, any, any>).kind ===
      "farm-integration-api-operation"
  );
}

function resolveSourceAPI(
  source: FarmIntegrationDefinition | FarmIntegrationAPI,
): FarmIntegrationAPI {
  if ("kind" in source && source.kind === "farm-integration") {
    if (!source.api) {
      throw new Error(`Integration "${source.type}" does not expose a client API definition.`);
    }

    return source.api as FarmIntegrationAPI;
  }

  return source as FarmIntegrationAPI;
}

function tryResolveSourceAPI(
  source: FarmIntegrationDefinition | FarmIntegrationAPI,
): FarmIntegrationAPI | null {
  if ("kind" in source && source.kind === "farm-integration") {
    if (!source.api) {
      return null;
    }

    return source.api as FarmIntegrationAPI;
  }

  return source as FarmIntegrationAPI;
}

function getIntegrationRuntimeRegistry() {
  const globalState = globalThis as GlobalWithIntegrationRuntimeRegistry;
  return (
    globalState[INTEGRATION_RUNTIME_REGISTRY_KEY] || new Map<string, RegisteredIntegrationRuntime>()
  );
}

function getRegisteredIntegrationRuntimeLocal(
  key: string,
): RegisteredIntegrationRuntime | undefined {
  return getIntegrationRuntimeRegistry().get(key);
}

function getRegisteredIntegrationsLocal(): Record<string, FarmIntegrationDefinition> {
  return Object.fromEntries(
    Array.from(getIntegrationRuntimeRegistry().entries()).map(([key, runtime]) => [
      key,
      runtime.integration,
    ]),
  );
}

function resolveCurrentRequestLocal(): Request | undefined {
  const globalState = globalThis as GlobalWithIntegrationRuntimeRegistry;
  return globalState[CURRENT_REQUEST_RESOLVER_KEY]?.();
}

function resolveIntegrationRequestDispatcherLocal(): IntegrationRequestDispatcher | undefined {
  const globalState = globalThis as GlobalWithIntegrationRuntimeRegistry;
  return globalState[INTEGRATION_REQUEST_DISPATCHER_KEY];
}

const INTEGRATION_DATA_HEADER = "x-farm-integration-data";
const INTEGRATION_DATA_HEADER_MAX_LENGTH = 16 * 1024;
const BLOCKED_INTEGRATION_DATA_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isIntegrationClientData(value: unknown): value is IntegrationClientData {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPlainIntegrationDataObject(value: unknown): value is Record<string, unknown> {
  if (!isIntegrationClientData(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeIntegrationClientDataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeIntegrationClientDataValue(item));
  }

  if (!isPlainIntegrationDataObject(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (BLOCKED_INTEGRATION_DATA_KEYS.has(key)) {
      continue;
    }

    sanitized[key] = sanitizeIntegrationClientDataValue(item);
  }

  return sanitized;
}

function normalizeIntegrationClientData(
  value: IntegrationClientData | undefined,
): IntegrationClientData | undefined {
  if (!isIntegrationClientData(value)) {
    return undefined;
  }

  const sanitized = sanitizeIntegrationClientDataValue(value);
  return isIntegrationClientData(sanitized) && Object.keys(sanitized).length > 0
    ? sanitized
    : undefined;
}

function getIntegrationDataHeaderByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function mergeIntegrationClientData(
  ...values: Array<IntegrationClientData | undefined>
): IntegrationClientData | undefined {
  let merged: IntegrationClientData | undefined;

  for (const value of values) {
    const data = normalizeIntegrationClientData(value);
    if (!data) {
      continue;
    }

    merged = {
      ...merged,
      ...data,
    };
  }

  return merged && Object.keys(merged).length > 0 ? merged : undefined;
}

function serializeIntegrationClientData(data: IntegrationClientData): string {
  const serialized = JSON.stringify(data);
  if (getIntegrationDataHeaderByteLength(serialized) > INTEGRATION_DATA_HEADER_MAX_LENGTH) {
    throw new Error(
      `Integration client data must be smaller than ${INTEGRATION_DATA_HEADER_MAX_LENGTH} bytes when sent over HTTP headers.`,
    );
  }

  return serialized;
}

function appendIntegrationClientDataHeader(
  headers: Headers,
  data: IntegrationClientData | undefined,
) {
  if (!data) {
    return;
  }

  headers.set(INTEGRATION_DATA_HEADER, serializeIntegrationClientData(data));
}

function resolveAutomaticClientNamespaces(): ResolvedIntegrationNamespace[] {
  const globalState = globalThis as GlobalWithIntegrationAPIManifest;
  const manifest =
    globalState.window?.__FARM_INTEGRATION_API_MANIFEST__ ||
    globalState.__FARM_INTEGRATION_API_MANIFEST__ ||
    {};

  return Object.entries(manifest).map(([key, api]) => [key, api, api] as const);
}

function resolveAutomaticServerNamespaces(): ResolvedIntegrationNamespace[] {
  return Object.entries(getRegisteredIntegrationsLocal()).flatMap(([key, source]) => {
    const api = tryResolveSourceAPI(source);
    return api ? [[key, api, source] as ResolvedIntegrationNamespace] : [];
  });
}

function appendQuery(url: URL, query: Record<string, unknown> | undefined) {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) {
          url.searchParams.append(key, String(item));
        }
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }
}

function appendHeaders(target: Headers, source: HeadersInit | undefined) {
  if (!source) {
    return;
  }

  const headers = new Headers(source);
  headers.forEach((value, key) => {
    target.set(key, value);
  });
}

const DEFAULT_FORWARDED_HEADERS = [
  "authorization",
  "cookie",
  "x-client-ip",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
] as const;

function resolveRequestLike(request: IntegrationServerRequestLike | undefined) {
  if (!request) {
    return undefined;
  }

  if (request instanceof Request) {
    return {
      url: request.url,
      headers: request.headers,
    };
  }

  return {
    url: request.url,
    headers: request.headers ? new Headers(request.headers) : undefined,
  };
}

function resolveServerBaseURL(
  explicitBaseURL: string | undefined,
  request: ReturnType<typeof resolveRequestLike>,
) {
  if (explicitBaseURL) {
    return explicitBaseURL;
  }

  if (request?.url) {
    try {
      return new URL(request.url).origin;
    } catch {
      // Fall back to forwarded headers below.
    }
  }

  const headers = request?.headers;
  const host = headers?.get("x-forwarded-host") || headers?.get("host");
  if (host) {
    const proto = headers?.get("x-forwarded-proto") || "http";
    return `${proto}://${host}`;
  }

  return "http://localhost:3000";
}

function resolveForwardHeaders(
  request: ReturnType<typeof resolveRequestLike>,
  forwardHeaders: boolean | readonly string[] | undefined,
) {
  if (!request?.headers || forwardHeaders === false) {
    return new Headers();
  }

  const allowed =
    Array.isArray(forwardHeaders) && forwardHeaders.length > 0
      ? new Set(forwardHeaders.map((item) => item.toLowerCase()))
      : new Set<string>(DEFAULT_FORWARDED_HEADERS);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (allowed.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  return headers;
}

function createBody(
  format: FarmIntegrationAPIBodyFormat | undefined,
  body: unknown,
  headers: Headers,
): BodyInit | undefined {
  if (body == null || format === "none") {
    return undefined;
  }

  if (format === "form") {
    if (body instanceof FormData || body instanceof URLSearchParams) {
      return body;
    }

    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value == null) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (item != null) {
            form.append(key, String(item));
          }
        }
        continue;
      }

      form.set(key, String(value));
    }

    headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    return form;
  }

  headers.set("content-type", "application/json");
  return JSON.stringify(body);
}

async function parseResponseData(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return await response.json();
  }

  return await response.text();
}

async function safeParseResponseData(response: Response): Promise<unknown> {
  try {
    return await parseResponseData(response);
  } catch {
    return undefined;
  }
}

function createResponseError(response: Response, errorData: unknown) {
  const message =
    typeof errorData === "string"
      ? errorData
      : typeof errorData === "object" && errorData
        ? String(
            (errorData as { error?: string; message?: string }).error ||
              (errorData as { error?: string; message?: string }).message ||
              response.statusText,
          )
        : response.statusText || "Integration request failed.";

  return new IntegrationClientError(message, response, errorData);
}

function normalizeExecutionError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string" && error.length > 0) {
    return new Error(error);
  }

  return new Error("Integration request failed.");
}

async function finalizeOperationResponse(
  operation: FarmIntegrationAPIOperation<any, any, any>,
  response: Response,
) {
  if (!response.ok) {
    const errorData = await safeParseResponseData(response);
    return {
      data: null,
      error: createResponseError(response, errorData),
    };
  }

  if (operation.responseFormat === "response") {
    return {
      data: response,
      error: null,
    };
  }

  return {
    data: (await parseResponseData(response)) as unknown,
    error: null,
  };
}

async function executeClientOperation(
  operation: FarmIntegrationAPIOperation<any, any, any>,
  input: Record<string, unknown>,
  options: Pick<IntegrationClientOptions, "baseURL" | "headers" | "credentials" | "data">,
  requestOptions?: IntegrationClientRequestOptions,
) {
  try {
    if (!operation.path) {
      return {
        data: null,
        error: new Error(
          "Integration API operation path is missing. Pass a path to api.get/post/... or wrap pathless methods with api.route(path, { ... }).",
        ),
      };
    }

    const baseURL =
      options.baseURL ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    const url = resolveFarmAPIRequestURL(operation.path, baseURL);
    appendQuery(url, input.query as Record<string, unknown> | undefined);

    const headers = new Headers({
      "x-farm-integration-client": "1",
      ...options.headers,
      ...operation.headers,
      ...requestOptions?.headers,
    });

    if (operation.responseFormat !== "response") {
      headers.set("accept", "application/json");
    }

    appendIntegrationClientDataHeader(
      headers,
      mergeIntegrationClientData(options.data, requestOptions?.data),
    );

    const response = await fetch(url.toString(), {
      method: operation.method,
      headers,
      body: createBody(operation.bodyFormat, input.body, headers),
      credentials:
        requestOptions?.credentials ?? operation.credentials ?? options.credentials ?? "include",
      signal: requestOptions?.signal,
    });

    if (!response.ok) {
      const errorData = await safeParseResponseData(response);
      return {
        data: null,
        error: createResponseError(response, errorData),
      };
    }

    if (operation.responseFormat === "response") {
      return {
        data: response,
        error: null,
      };
    }

    return {
      data: (await parseResponseData(response)) as unknown,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: normalizeExecutionError(error),
    };
  }
}

async function executeServerOperation(
  operation: FarmIntegrationAPIOperation<any, any, any>,
  input: Record<string, unknown>,
  options: Pick<
    IntegrationServerClientOptions,
    "baseURL" | "headers" | "credentials" | "data" | "request" | "forwardHeaders"
  >,
  requestOptions?: IntegrationServerClientRequestOptions,
  integrationKey?: string,
  source?: FarmIntegrationDefinition | FarmIntegrationAPI,
) {
  try {
    if (!operation.path) {
      return {
        data: null,
        error: new Error(
          "Integration API operation path is missing. Pass a path to api.get/post/... or wrap pathless methods with api.route(path, { ... }).",
        ),
      };
    }

    const serverRequestOptions =
      requestOptions &&
      ("request" in requestOptions ||
        "baseURL" in requestOptions ||
        "forwardHeaders" in requestOptions)
        ? requestOptions
        : undefined;
    const currentRequest =
      serverRequestOptions?.request instanceof Request
        ? serverRequestOptions.request
        : options.request instanceof Request
          ? options.request
          : resolveCurrentRequestLocal();
    const request = resolveRequestLike(
      serverRequestOptions?.request ?? options.request ?? currentRequest,
    );
    const baseURL = resolveServerBaseURL(serverRequestOptions?.baseURL ?? options.baseURL, request);
    const url = new URL(operation.path, baseURL);
    appendQuery(url, input.query as Record<string, unknown> | undefined);

    const headers = new Headers();
    appendHeaders(
      headers,
      resolveForwardHeaders(
        request,
        serverRequestOptions?.forwardHeaders ?? options.forwardHeaders,
      ),
    );
    appendHeaders(headers, options.headers);
    appendHeaders(headers, operation.headers);
    appendHeaders(headers, requestOptions?.headers);
    headers.set("x-farm-integration-client", "1");

    if (operation.responseFormat !== "response") {
      headers.set("accept", "application/json");
    }

    const data = mergeIntegrationClientData(options.data, requestOptions?.data);

    if (integrationKey) {
      const runtime =
        "kind" in (source || {}) &&
        (source as FarmIntegrationDefinition).kind === "farm-integration"
          ? getRegisteredIntegrationRuntimeLocal(integrationKey) || {
              integration: source as FarmIntegrationDefinition,
              config: {},
              isDev: process.env.NODE_ENV !== "production",
              isProd: process.env.NODE_ENV === "production",
            }
          : getRegisteredIntegrationRuntimeLocal(integrationKey);

      if (runtime) {
        const dispatchIntegrationRequest = resolveIntegrationRequestDispatcherLocal();
        const directResponse = dispatchIntegrationRequest
          ? await dispatchIntegrationRequest(
              runtime,
              new Request(url.toString(), {
                method: operation.method,
                headers,
                body: createBody(operation.bodyFormat, input.body, headers),
              }),
              {
                currentRequest,
                data,
                internal: true,
              },
            )
          : null;

        if (directResponse) {
          return await finalizeOperationResponse(operation, directResponse);
        }
      }
    }

    appendIntegrationClientDataHeader(headers, data);

    const response = await fetch(url.toString(), {
      method: operation.method,
      headers,
      body: createBody(operation.bodyFormat, input.body, headers),
      credentials:
        requestOptions?.credentials ?? operation.credentials ?? options.credentials ?? "include",
      signal: requestOptions?.signal,
    });

    return await finalizeOperationResponse(operation, response);
  } catch (error) {
    return {
      data: null,
      error: normalizeExecutionError(error),
    };
  }
}

export function createIntegrationClient<TSources extends Record<string, any>>(
  sources: { integrations: TSources },
  options: IntegrationServerClientOptions,
): IntegrationServerClientAliases<TSources>;
export function createIntegrationClient<TSources extends Record<string, any>>(
  sources: { integrations: TSources },
  options?: IntegrationClientOptions,
): IntegrationClientAliases<TSources>;
export function createIntegrationClient<TSources extends Record<string, any>>(
  sources: TSources,
  options: IntegrationServerClientOptions,
): IntegrationServerClient<TSources>;
export function createIntegrationClient<TSources extends Record<string, any>>(
  sources: TSources,
  options?: IntegrationClientOptions,
): IntegrationClient<TSources>;
export function createIntegrationClient<TSources extends Record<string, any>>(
  sources: TSources | { integrations: TSources },
  options: IntegrationClientOptions | IntegrationServerClientOptions = {},
):
  | IntegrationClient<TSources>
  | IntegrationClientAliases<TSources>
  | IntegrationServerClient<TSources>
  | IntegrationServerClientAliases<TSources> {
  const rawSources = "integrations" in sources ? sources.integrations : sources;
  const isServer = options.isServer === true;

  const namespaces = Object.entries(rawSources)
    .map(([key, source]) => {
      const api = tryResolveSourceAPI(source as FarmIntegrationDefinition | FarmIntegrationAPI);
      if (!api) {
        return null;
      }
      return [key, api, source as FarmIntegrationDefinition | FarmIntegrationAPI] as const;
    })
    .filter(
      (
        value,
      ): value is readonly [
        string,
        FarmIntegrationAPI,
        FarmIntegrationDefinition | FarmIntegrationAPI,
      ] => value !== null,
    );

  const cache = new Map<string, any>();

  const integrationNamespaces = new Proxy(
    {},
    {
      get(target, property) {
        if (typeof property !== "string") {
          return undefined;
        }

        if (Reflect.has(target, property)) {
          return Reflect.get(target, property);
        }

        if (cache.has(property)) {
          return cache.get(property);
        }

        const match = namespaces.find(([key]) => key === property);
        if (!match) {
          return undefined;
        }

        const namespace = isServer
          ? createServerNamespaceProxy(
              match[0],
              match[2],
              match[1],
              options as IntegrationServerClientOptions,
            )
          : createNamespaceProxy(match[1], options);
        cache.set(property, namespace);
        return namespace;
      },
    },
  ) as
    | IntegrationClient<TSources>
    | IntegrationClientAliases<TSources>
    | IntegrationServerClient<TSources>
    | IntegrationServerClientAliases<TSources>;

  if ("integrations" in sources) {
    Object.defineProperty(integrationNamespaces, "integrations", {
      value: integrationNamespaces,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    return integrationNamespaces as
      | IntegrationClientAliases<TSources>
      | IntegrationServerClientAliases<TSources>;
  }

  return integrationNamespaces as IntegrationClient<TSources> | IntegrationServerClient<TSources>;
}

function createAutomaticIntegrationAliases<TSources extends Record<string, any>>(
  isServer: boolean,
  options: IntegrationClientOptions | IntegrationServerClientOptions = {},
): IntegrationClientAliases<TSources> | IntegrationServerClientAliases<TSources> {
  const cache = isServer ? new Map<string, any>() : null;

  const integrationNamespaces = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") {
          return undefined;
        }

        if (property === "integrations") {
          return integrationNamespaces;
        }

        if (cache?.has(property)) {
          return cache.get(property);
        }

        const namespaces = isServer
          ? resolveAutomaticServerNamespaces()
          : resolveAutomaticClientNamespaces();
        const match = namespaces.find(([key]) => key === property);
        if (!match) {
          return undefined;
        }

        const namespace = isServer
          ? createServerNamespaceProxy(
              match[0],
              match[2],
              match[1],
              options as IntegrationServerClientOptions,
            )
          : createNamespaceProxy(match[1], options as IntegrationClientOptions);

        cache?.set(property, namespace);
        return namespace;
      },
    },
  ) as IntegrationClientAliases<TSources> | IntegrationServerClientAliases<TSources>;

  Object.defineProperty(integrationNamespaces, "integrations", {
    value: integrationNamespaces,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return integrationNamespaces;
}

export function integrationsClient<
  TSources extends Record<string, any>,
>(): IntegrationClientAliases<TSources>;
export function integrationsClient<TSources extends Record<string, any>>(
  options: IntegrationClientOptions,
): IntegrationClientAliases<TSources>;
export function integrationsClient<TSources extends Record<string, any>>(
  options: IntegrationClientOptions = {},
): IntegrationClientAliases<TSources> {
  return createAutomaticIntegrationAliases<TSources>(
    false,
    options,
  ) as IntegrationClientAliases<TSources>;
}

export function integrationsServer<
  TSources extends Record<string, any>,
>(): IntegrationServerClientAliases<TSources>;
export function integrationsServer<TSources extends Record<string, any>>(
  options: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationServerClientAliases<TSources>;
export function integrationsServer<TSources extends Record<string, any>>(
  options: Omit<IntegrationServerClientOptions, "isServer"> = {},
): IntegrationServerClientAliases<TSources> {
  return createAutomaticIntegrationAliases<TSources>(true, {
    ...options,
    isServer: true,
  }) as IntegrationServerClientAliases<TSources>;
}

export function createIntegrationServerClient<TSources extends Record<string, any>>(sources: {
  integrations: TSources;
}): IntegrationServerClientAliases<TSources>;
export function createIntegrationServerClient<TSources extends Record<string, any>>(
  sources: TSources,
): IntegrationServerClient<TSources>;
export function createIntegrationServerClient<TSources extends Record<string, any>>(
  sources: { integrations: TSources },
  options: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationServerClientAliases<TSources>;
export function createIntegrationServerClient<TSources extends Record<string, any>>(
  sources: TSources,
  options: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationServerClient<TSources>;
export function createIntegrationServerClient<TSources extends Record<string, any>>(
  sources: TSources | { integrations: TSources },
  options: Omit<IntegrationServerClientOptions, "isServer"> = {},
): IntegrationServerClient<TSources> | IntegrationServerClientAliases<TSources> {
  return createIntegrationClient(sources, {
    ...options,
    isServer: true,
  }) as IntegrationServerClient<TSources> | IntegrationServerClientAliases<TSources>;
}

export function createIntegrationApi<TSources extends Record<string, any>>(
  sources: { integrations: TSources },
  options: IntegrationClientOptions = {},
): IntegrationAPI<TSources> {
  const client = createIntegrationClient(sources, options);

  return {
    ...client,
    server(serverOptions = {}) {
      return createIntegrationServerClient(sources, {
        ...options,
        ...serverOptions,
      });
    },
  };
}

function isIntegrationClientOptionsInput(value: unknown): value is IntegrationClientOptions {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ("baseURL" in value ||
      "headers" in value ||
      "credentials" in value ||
      "data" in value ||
      "isServer" in value)
  );
}

function resolveIntegrationServerOptions(
  clientOptions: IntegrationClientOptions = {},
  serverOptions: Omit<IntegrationServerClientOptions, "isServer"> = {},
): Omit<IntegrationServerClientOptions, "isServer"> {
  const data = mergeIntegrationClientData(clientOptions.data, serverOptions.data);

  return {
    baseURL: clientOptions.baseURL,
    headers: clientOptions.headers,
    credentials: clientOptions.credentials,
    ...serverOptions,
    ...(data ? { data } : {}),
  };
}

export function createIntegrationClients<TSources extends Record<string, any>>(
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources>;
export function createIntegrationClients<TSources extends Record<string, any>>(
  sources: TSources,
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources>;
export function createIntegrationClients<TSources extends Record<string, any>>(
  sources: { integrations: TSources },
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources>;
export function createIntegrationClients<TSources extends Record<string, any>>(
  sources?: TSources | { integrations: TSources },
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources> {
  if (arguments.length === 0 || isIntegrationClientOptionsInput(sources)) {
    const automaticClientOptions = isIntegrationClientOptionsInput(sources) ? sources : {};
    const automaticServerOptions = arguments.length > 1 ? clientOptions : undefined;

    return {
      api: integrationsServer<TSources>(
        resolveIntegrationServerOptions(
          automaticClientOptions,
          automaticServerOptions as Omit<IntegrationServerClientOptions, "isServer"> | undefined,
        ),
      ),
      apiClient: integrationsClient<TSources>(automaticClientOptions),
    };
  }

  const explicitSources =
    sources && "integrations" in sources ? sources.integrations : (sources as TSources);

  return {
    api: createIntegrationServerClient(
      {
        integrations: explicitSources,
      },
      resolveIntegrationServerOptions(clientOptions, serverOptions),
    ) as IntegrationServerClientAliases<TSources>,
    apiClient: createIntegrationClient(
      {
        integrations: explicitSources,
      },
      clientOptions,
    ) as IntegrationClientAliases<TSources>,
  };
}

export function createIntegrations<TSources extends Record<string, any>>(
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources>;
export function createIntegrations<TSources extends Record<string, any>>(
  sources: TSources,
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources>;
export function createIntegrations<TSources extends Record<string, any>>(
  sources: { integrations: TSources },
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources>;
export function createIntegrations<TSources extends Record<string, any>>(
  sources?: TSources | { integrations: TSources } | IntegrationClientOptions,
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources> {
  if (arguments.length === 0) {
    return createIntegrationClients<TSources>();
  }

  return createIntegrationClients<TSources>(
    sources as TSources,
    clientOptions,
    serverOptions,
  ) as IntegrationClients<TSources>;
}

function createClientSafeIntegrationAPI(
  api: FarmIntegrationAPI | undefined,
): FarmIntegrationAPI | undefined {
  if (!api) {
    return undefined;
  }

  const entries = Object.entries(api as Record<string, unknown>).map(([key, value]) => {
    if (isOperation(value)) {
      return [
        key,
        {
          kind: value.kind,
          path: value.path,
          method: value.method,
          bodyFormat: value.bodyFormat,
          responseFormat: value.responseFormat,
          credentials: value.credentials,
          isServer: value.isServer,
          __pathless: value.__pathless,
        },
      ];
    }

    if (value && typeof value === "object") {
      return [key, createClientSafeIntegrationAPI(value as FarmIntegrationAPI)];
    }

    return [key, value];
  });

  return Object.fromEntries(entries) as FarmIntegrationAPI;
}

export function getIntegrationAPIManifest(): Record<string, FarmIntegrationAPI> {
  const manifestEntries = Object.entries(getRegisteredIntegrationsLocal())
    .map(([key, integration]) => {
      const api = createClientSafeIntegrationAPI(integration.api);
      return api ? ([key, api] as const) : null;
    })
    .filter((value): value is readonly [string, FarmIntegrationAPI] => value !== null);

  return Object.fromEntries(manifestEntries);
}

export function integrationClients<TSources extends Record<string, any>>(
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources>;
export function integrationClients<TSources extends Record<string, any>>(
  sources: TSources,
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources>;
export function integrationClients<TSources extends Record<string, any>>(
  sources: { integrations: TSources },
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources>;
export function integrationClients<TSources extends Record<string, any>>(
  sources?: TSources | { integrations: TSources },
  clientOptions?: IntegrationClientOptions,
  serverOptions?: Omit<IntegrationServerClientOptions, "isServer">,
): IntegrationClients<TSources> {
  if (arguments.length === 0) {
    return createIntegrationClients<TSources>();
  }

  return createIntegrationClients<TSources>(
    sources as TSources,
    clientOptions,
    serverOptions,
  ) as IntegrationClients<TSources>;
}

function resolveSingleNamespaceOperation(api: FarmIntegrationAPI) {
  const entries = Object.entries(api as Record<string, unknown>);
  if (entries.length !== 1) {
    return null;
  }

  const [, value] = entries[0]!;
  return isOperation(value) ? value : null;
}

function createClientOperationCaller(
  operation: FarmIntegrationAPIOperation<any, any, any, any>,
  property: string,
  options: IntegrationClientOptions,
) {
  if (operation.isServer === true) {
    return async () => {
      throw new Error(
        `Integration method "${property}" is registered with isServer: true and is only available from a server integration client.`,
      );
    };
  }

  return async (
    input: Record<string, unknown> = {},
    requestOptions?: IntegrationClientRequestOptions,
  ) => {
    if (typeof window === "undefined") {
      throw new Error(
        "Client integration API cannot be called on the server. Pass { isServer: true } to createIntegrationClient(...) during server rendering, or provide { isServer: true, request } outside it.",
      );
    }

    return executeClientOperation(operation, input, options, requestOptions);
  };
}

function createServerOperationCaller(
  operation: FarmIntegrationAPIOperation<any, any, any, any>,
  options: IntegrationServerClientOptions,
  integrationKey: string,
  source: FarmIntegrationDefinition | FarmIntegrationAPI,
) {
  return async (
    input: Record<string, unknown> = {},
    requestOptions?: IntegrationServerClientRequestOptions,
  ) => {
    if (typeof window !== "undefined") {
      throw new Error(
        "Server integration API cannot be called in the browser. Remove { isServer: true } and create a client integration API instead.",
      );
    }

    return executeServerOperation(
      operation,
      input,
      options,
      requestOptions,
      integrationKey,
      source,
    );
  };
}

function createNamespaceProxy(api: FarmIntegrationAPI, options: IntegrationClientOptions) {
  const cache = new Map<string, any>();
  const directOperation = resolveSingleNamespaceOperation(api);
  const target = directOperation
    ? createClientOperationCaller(directOperation, directOperation.method.toLowerCase(), options)
    : {};

  return new Proxy(target, {
    get(targetObject, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(targetObject, property, receiver);
      }

      if (cache.has(property)) {
        return cache.get(property);
      }

      const value = (api as Record<string, unknown>)[property];
      if (!value) {
        return Reflect.get(targetObject, property, receiver);
      }

      if (isOperation(value)) {
        const caller = createClientOperationCaller(value, property, options);
        cache.set(property, caller);
        return caller;
      }

      const namespace = createNamespaceProxy(value as FarmIntegrationAPI, options);
      cache.set(property, namespace);
      return namespace;
    },
  });
}

function createServerNamespaceProxy(
  integrationKey: string,
  source: FarmIntegrationDefinition | FarmIntegrationAPI,
  api: FarmIntegrationAPI,
  options: IntegrationServerClientOptions,
) {
  const cache = new Map<string, any>();
  const directOperation = resolveSingleNamespaceOperation(api);
  const target = directOperation
    ? createServerOperationCaller(directOperation, options, integrationKey, source)
    : {};

  return new Proxy(target, {
    get(targetObject, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(targetObject, property, receiver);
      }

      if (cache.has(property)) {
        return cache.get(property);
      }

      const value = (api as Record<string, unknown>)[property];
      if (!value) {
        return Reflect.get(targetObject, property, receiver);
      }

      if (isOperation(value)) {
        const caller = createServerOperationCaller(value, options, integrationKey, source);
        cache.set(property, caller);
        return caller;
      }

      const namespace = createServerNamespaceProxy(
        integrationKey,
        source,
        value as FarmIntegrationAPI,
        options,
      );
      cache.set(property, namespace);
      return namespace;
    },
  });
}
