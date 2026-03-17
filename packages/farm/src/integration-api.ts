export type FarmIntegrationAPIMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export type FarmIntegrationAPIBodyFormat = "json" | "form" | "none";
export type FarmIntegrationAPIResponseFormat = "json" | "text" | "response";

export interface FarmIntegrationAPIOperation<
  TBody = never,
  TQuery = never,
  TResponse = unknown,
  TServer extends boolean = false,
> {
  readonly kind: "farm-integration-api-operation";
  path: string;
  method: FarmIntegrationAPIMethod;
  bodyFormat?: FarmIntegrationAPIBodyFormat;
  responseFormat?: FarmIntegrationAPIResponseFormat;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  isServer?: TServer;
  __types?: {
    body: TBody;
    query: TQuery;
    response: TResponse;
  };
}

export type FarmIntegrationAPI = {
  [key: string]: FarmIntegrationAPI | FarmIntegrationAPIOperation<any, any, any>;
};

type IntegrationAPIBuilderOptions<TServer extends boolean = false> = Omit<
  FarmIntegrationAPIOperation<any, any, any, TServer>,
  "kind" | "method" | "path" | "__types"
>;

export function defineIntegrationAPIOperation<
  TBody = never,
  TQuery = never,
  TResponse = unknown,
  TServer extends boolean = false,
>(
  operation: Omit<
    FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>,
    "kind" | "__types"
  >,
): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer> {
  return {
    kind: "farm-integration-api-operation",
    ...operation,
  };
}

export function defineIntegrationAPI<TAPI extends FarmIntegrationAPI>(api: TAPI): TAPI {
  return api;
}

function operation<
  TBody = never,
  TQuery = never,
  TResponse = unknown,
  TServer extends boolean = false,
>(
  method: FarmIntegrationAPIMethod,
  path: string,
  options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer> {
  return defineIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>({
    path,
    method,
    ...options,
  });
}

function get<TResponse = unknown, TServer extends boolean = false>(
  path: string,
  options?: IntegrationAPIBuilderOptions<TServer>,
): FarmIntegrationAPIOperation<never, never, TResponse, TServer>;
function get<TQuery = never, TResponse = unknown, TServer extends boolean = false>(
  path: string,
  options?: IntegrationAPIBuilderOptions<TServer>,
): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer>;
function get(
  path: string,
  options: IntegrationAPIBuilderOptions<boolean> = {} as IntegrationAPIBuilderOptions<boolean>,
) {
  return operation<never, any, any, boolean>("GET", path, options);
}

export const api = {
  get,
  post<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    path: string,
    options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ) {
    return operation<TBody, TQuery, TResponse, TServer>("POST", path, {
      bodyFormat: "json",
      ...options,
    });
  },
  put<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    path: string,
    options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ) {
    return operation<TBody, TQuery, TResponse, TServer>("PUT", path, {
      bodyFormat: "json",
      ...options,
    });
  },
  patch<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    path: string,
    options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ) {
    return operation<TBody, TQuery, TResponse, TServer>("PATCH", path, {
      bodyFormat: "json",
      ...options,
    });
  },
  delete<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    path: string,
    options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ) {
    return operation<TBody, TQuery, TResponse, TServer>("DELETE", path, {
      bodyFormat: "json",
      ...options,
    });
  },
  options<TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    path: string,
    options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ) {
    return operation<never, TQuery, TResponse, TServer>("OPTIONS", path, options);
  },
  head<TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    path: string,
    options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ) {
    return operation<never, TQuery, TResponse, TServer>("HEAD", path, options);
  },
  form: {
    post<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
    ) {
      return operation<TBody, TQuery, TResponse, TServer>("POST", path, {
        bodyFormat: "form",
        ...options,
      });
    },
    put<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
    ) {
      return operation<TBody, TQuery, TResponse, TServer>("PUT", path, {
        bodyFormat: "form",
        ...options,
      });
    },
    patch<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
    ) {
      return operation<TBody, TQuery, TResponse, TServer>("PATCH", path, {
        bodyFormat: "form",
        ...options,
      });
    },
    delete<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
    ) {
      return operation<TBody, TQuery, TResponse, TServer>("DELETE", path, {
        bodyFormat: "form",
        ...options,
      });
    },
  },
};

export const endpoint = api;
