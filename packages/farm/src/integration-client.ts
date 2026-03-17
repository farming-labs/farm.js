import type {
  FarmIntegrationAPI,
  FarmIntegrationAPIBodyFormat,
  FarmIntegrationAPIOperation,
} from "./integration-api";
import type { FarmIntegration as FarmIntegrationDefinition } from "./integrations";

export type IntegrationClientOptions = {
  baseURL?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  isServer?: false | undefined;
};

type IntegrationRequestOptionsBase = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
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
  request: IntegrationServerRequestLike;
  forwardHeaders?: boolean | readonly string[];
};

export type IntegrationServerClientRequestOptions =
  IntegrationRequestOptionsBase & {
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

type IsNever<T> = [T] extends [never] ? true : false;

type OperationInput<T> = IsNever<ExtractOperationBody<T>> extends true
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

type ExtractAPIFromSource<TSource> = TSource extends { api?: infer TAPI }
  ? NonNullable<TAPI> extends FarmIntegrationAPI
    ? NonNullable<TAPI>
    : never
  : TSource extends FarmIntegrationAPI
    ? TSource
    : never;

type IsServerRegisteredOperation<T> = T extends { isServer: true } ? true : false;

type IntegrationAPIToClient<TAPI> = {
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

export type IntegrationClient<TSources extends Record<string, any>> = {
  [K in keyof TSources]: IntegrationAPIToClient<ExtractAPIFromSource<TSources[K]>>;
};

export type IntegrationClientRoot<TSources extends Record<string, any>> = {
  integrations: IntegrationClient<TSources>;
};

type IntegrationAPIToServerClient<TAPI> = {
  [K in keyof TAPI]: TAPI[K] extends FarmIntegrationAPIOperation<any, any, any>
    ? ServerOperation<TAPI[K]>
    : TAPI[K] extends Record<string, any>
      ? IntegrationAPIToServerClient<TAPI[K]>
      : never;
};

export type IntegrationServerClient<TSources extends Record<string, any>> = {
  [K in keyof TSources]: IntegrationAPIToServerClient<ExtractAPIFromSource<TSources[K]>>;
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
      throw new Error(
        `Integration "${source.type}" does not expose a client API definition.`,
      );
    }

    return source.api as FarmIntegrationAPI;
  }

  return source as FarmIntegrationAPI;
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

async function executeClientOperation(
  operation: FarmIntegrationAPIOperation<any, any, any>,
  input: Record<string, unknown>,
  options: Pick<IntegrationClientOptions, "baseURL" | "headers" | "credentials">,
  requestOptions?: IntegrationClientRequestOptions,
) {
  try {
    const baseURL =
      options.baseURL ||
      (typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:3000");
    const url = new URL(operation.path, baseURL);
    appendQuery(url, input.query as Record<string, unknown> | undefined);

    const headers = new Headers({
      "x-farm-integration-client": "1",
      ...(options.headers || {}),
      ...(operation.headers || {}),
      ...(requestOptions?.headers || {}),
    });

    if (operation.responseFormat !== "response") {
      headers.set("accept", "application/json");
    }

    const response = await fetch(url.toString(), {
      method: operation.method,
      headers,
      body: createBody(operation.bodyFormat, input.body, headers),
      credentials:
        requestOptions?.credentials ??
        operation.credentials ??
        options.credentials ??
        "include",
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
    "baseURL" | "headers" | "credentials" | "request" | "forwardHeaders"
  >,
  requestOptions?: IntegrationServerClientRequestOptions,
) {
  try {
    const serverRequestOptions =
      requestOptions &&
      ("request" in requestOptions ||
        "baseURL" in requestOptions ||
        "forwardHeaders" in requestOptions)
        ? requestOptions
        : undefined;
    const request = resolveRequestLike(
      serverRequestOptions?.request ?? options.request,
    );
    const baseURL = resolveServerBaseURL(
      serverRequestOptions?.baseURL ?? options.baseURL,
      request,
    );
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

    const response = await fetch(url.toString(), {
      method: operation.method,
      headers,
      body: createBody(operation.bodyFormat, input.body, headers),
      credentials:
        requestOptions?.credentials ??
        operation.credentials ??
        options.credentials ??
        "include",
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
  const rawSources =
    "integrations" in sources
      ? sources.integrations
      : sources;
  const isServer = options.isServer === true;

  const namespaces = Object.entries(rawSources).map(([key, source]) => {
    const api = resolveSourceAPI(
      source as FarmIntegrationDefinition | FarmIntegrationAPI,
    );
    return [key, api] as const;
  });

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
          ? createServerNamespaceProxy(match[1], options as IntegrationServerClientOptions)
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

  return integrationNamespaces as
    | IntegrationClient<TSources>
    | IntegrationServerClient<TSources>;
}

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
  options: Omit<IntegrationServerClientOptions, "isServer">,
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
    server(serverOptions) {
      return createIntegrationServerClient(sources, {
        ...options,
        ...serverOptions,
      });
    },
  };
}

function createNamespaceProxy(api: FarmIntegrationAPI, options: IntegrationClientOptions) {
  const cache = new Map<string, any>();

  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") {
          return undefined;
        }

        if (cache.has(property)) {
          return cache.get(property);
        }

        const value = (api as Record<string, unknown>)[property];
        if (!value) {
          return undefined;
        }

        if (isOperation(value)) {
          if (value.isServer === true) {
            const caller = async () => {
              throw new Error(
                `Integration method "${property}" is registered with isServer: true and is only available from a server integration client.`,
              );
            };

            cache.set(property, caller);
            return caller;
          }

          const caller = async (
            input: Record<string, unknown> = {},
            requestOptions?: IntegrationClientRequestOptions,
          ) => {
            if (typeof window === "undefined") {
              throw new Error(
                "Client integration API cannot be called on the server. Pass { isServer: true, request } to createIntegrationClient(...).",
              );
            }

            return executeClientOperation(value, input, options, requestOptions);
          };

          cache.set(property, caller);
          return caller;
        }

        const namespace = createNamespaceProxy(value as FarmIntegrationAPI, options);
        cache.set(property, namespace);
        return namespace;
      },
    },
  );
}

function createServerNamespaceProxy(
  api: FarmIntegrationAPI,
  options: IntegrationServerClientOptions,
) {
  const cache = new Map<string, any>();

  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") {
          return undefined;
        }

        if (cache.has(property)) {
          return cache.get(property);
        }

        const value = (api as Record<string, unknown>)[property];
        if (!value) {
          return undefined;
        }

        if (isOperation(value)) {
          const caller = async (
            input: Record<string, unknown> = {},
            requestOptions?: IntegrationServerClientRequestOptions,
          ) => {
            if (typeof window !== "undefined") {
              throw new Error(
                "Server integration API cannot be called in the browser. Remove { isServer: true } and create a client integration API instead.",
              );
            }

            return executeServerOperation(
              value,
              input,
              options,
              requestOptions,
            );
          };

          cache.set(property, caller);
          return caller;
        }

        const namespace = createServerNamespaceProxy(value as FarmIntegrationAPI, options);
        cache.set(property, namespace);
        return namespace;
      },
    },
  );
}
