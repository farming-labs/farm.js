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
  TMethod extends FarmIntegrationAPIMethod = FarmIntegrationAPIMethod,
> {
  readonly kind: "farm-integration-api-operation";
  path: string;
  method: TMethod;
  bodyFormat?: FarmIntegrationAPIBodyFormat;
  responseFormat?: FarmIntegrationAPIResponseFormat;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  isServer?: TServer;
  __pathless?: boolean;
  __types?: {
    body: TBody;
    query: TQuery;
    response: TResponse;
  };
}

export type FarmIntegrationAPI = {
  [key: string]: FarmIntegrationAPI | FarmIntegrationAPIOperation<any, any, any>;
};

export type FarmIntegrationRouteOperationCarrier<
  TPath extends string = string,
  TOperation extends FarmIntegrationAPIOperation<any, any, any, any, any> =
    FarmIntegrationAPIOperation<any, any, any, any, any>,
> = {
  path: TPath;
  __operation: TOperation;
};

type IntegrationAPIBuilderOptions<TServer extends boolean = false> = Omit<
  FarmIntegrationAPIOperation<any, any, any, TServer>,
  "kind" | "method" | "path" | "__pathless" | "__types"
>;

export function defineIntegrationAPIOperation<
  TBody = never,
  TQuery = never,
  TResponse = unknown,
  TServer extends boolean = false,
  TMethod extends FarmIntegrationAPIMethod = FarmIntegrationAPIMethod,
>(
  operation: Omit<
    FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, TMethod>,
    "kind" | "__types"
  >,
): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, TMethod> {
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
  TMethod extends FarmIntegrationAPIMethod = FarmIntegrationAPIMethod,
>(
  method: TMethod,
  pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
  maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, TMethod> {
  const hasExplicitPath = typeof pathOrOptions === "string";
  const path = hasExplicitPath ? pathOrOptions : "";
  const options = (
    hasExplicitPath
      ? maybeOptions
      : {
          ...maybeOptions,
          ...pathOrOptions,
        }
  ) as IntegrationAPIBuilderOptions<TServer>;

  return defineIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, TMethod>({
    path,
    method,
    __pathless: !hasExplicitPath,
    ...options,
  });
}

function get<TResponse = unknown, TServer extends boolean = false>(
  path: string,
  options?: IntegrationAPIBuilderOptions<TServer>,
): FarmIntegrationAPIOperation<never, never, TResponse, TServer, "GET">;
function get<TQuery = never, TResponse = unknown, TServer extends boolean = false>(
  path: string,
  options?: IntegrationAPIBuilderOptions<TServer>,
): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer, "GET">;
function get<TResponse = unknown, TServer extends boolean = false>(
  options?: IntegrationAPIBuilderOptions<TServer>,
): FarmIntegrationAPIOperation<never, never, TResponse, TServer, "GET">;
function get<TQuery = never, TResponse = unknown, TServer extends boolean = false>(
  options?: IntegrationAPIBuilderOptions<TServer>,
): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer, "GET">;
function get(
  pathOrOptions?: string | IntegrationAPIBuilderOptions<boolean>,
  maybeOptions: IntegrationAPIBuilderOptions<boolean> = {} as IntegrationAPIBuilderOptions<boolean>,
) {
  return operation<never, any, any, boolean>("GET", pathOrOptions, maybeOptions);
}

function isOperation(value: unknown): value is FarmIntegrationAPIOperation<any, any, any, any> {
  return (
    !!value &&
    typeof value === "object" &&
    (value as FarmIntegrationAPIOperation<any, any, any, any>).kind ===
      "farm-integration-api-operation"
  );
}

function bindRoutePath<TAPI extends FarmIntegrationAPI>(path: string, api: TAPI): TAPI {
  const entries = Object.entries(api as Record<string, unknown>).map(([key, value]) => {
    if (isOperation(value)) {
      return [
        key,
        {
          ...value,
          path,
          __pathless: false,
        },
      ];
    }

    if (value && typeof value === "object") {
      return [key, bindRoutePath(path, value as FarmIntegrationAPI)];
    }

    return [key, value];
  });

  return Object.fromEntries(entries) as TAPI;
}

type RouteOperationsToAPI<
  TOperations extends readonly FarmIntegrationAPIOperation<any, any, any, any, any>[],
> = {
  [TMethod in Lowercase<TOperations[number]["method"] & string>]: Extract<
    TOperations[number],
    { method: Uppercase<TMethod> }
  >;
};

type StripRouteClientPrefix<TPath extends string> = TPath extends `/api/${string}/${infer TRest}`
  ? TRest
  : TPath extends `/${string}/${infer TRest}`
    ? TRest
    : TPath extends `/${infer TRest}`
      ? TRest
      : TPath;

type NormalizeRouteSegment<TSegment extends string> = TSegment extends `[...${infer TName}]`
  ? TName
  : TSegment extends `[${infer TName}]`
    ? TName
    : TSegment extends `${infer TName}(${string}`
      ? TName
      : CamelCaseRouteSegment<TSegment>;

type CamelCaseRouteSegment<TSegment extends string> =
  TSegment extends `${infer THead}-${infer TTail}`
    ? `${THead}${Capitalize<CamelCaseRouteSegment<TTail>>}`
    : TSegment;

type RouteNamespaceFromPath<
  TPath extends string,
  TOperation extends FarmIntegrationAPIOperation<any, any, any, any, any>,
> = TPath extends `${infer THead}/${infer TTail}`
  ? {
      [TKey in NormalizeRouteSegment<THead>]: RouteNamespaceFromPath<TTail, TOperation>;
    }
  : {
      [TKey in NormalizeRouteSegment<TPath>]: {
        [TMethod in Lowercase<TOperation["method"] & string>]: TOperation;
      };
    };

type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (value: TUnion) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

type ExpandRecursively<TValue> = TValue extends (...args: any[]) => any
  ? TValue
  : TValue extends object
    ? { [TKey in keyof TValue]: ExpandRecursively<TValue[TKey]> }
    : TValue;

type RoutesToAPI<TRoutes extends readonly FarmIntegrationRouteOperationCarrier<string, any>[]> =
  ExpandRecursively<
    UnionToIntersection<
      TRoutes[number] extends FarmIntegrationRouteOperationCarrier<infer TPath, infer TOperation>
        ? RouteNamespaceFromPath<StripRouteClientPrefix<TPath>, TOperation>
        : never
    >
  >;

export type InferIntegrationAPIFromRoutes<
  TRoutes extends readonly FarmIntegrationRouteOperationCarrier<string, any>[],
> = RoutesToAPI<TRoutes>;

function route<TAPI extends FarmIntegrationAPI>(path: string, definition: TAPI): TAPI;
function route<TOperations extends readonly FarmIntegrationAPIOperation<any, any, any, any, any>[]>(
  path: string,
  ...operations: TOperations
): RouteOperationsToAPI<TOperations>;
function route(
  path: string,
  definitionOrOperation: FarmIntegrationAPI | FarmIntegrationAPIOperation<any, any, any, any, any>,
  ...operations: readonly FarmIntegrationAPIOperation<any, any, any, any, any>[]
) {
  if (isOperation(definitionOrOperation)) {
    const allOperations = [definitionOrOperation, ...operations];
    return Object.fromEntries(
      allOperations.map((operation) => [
        operation.method.toLowerCase(),
        {
          ...operation,
          path,
          __pathless: false,
        },
      ]),
    );
  }

  return bindRoutePath(path, definitionOrOperation as FarmIntegrationAPI);
}

function normalizeRouteSegment(segment: string): string {
  if (!segment) {
    return "index";
  }

  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return segment.slice(4, -1) || "index";
  }

  if (segment.startsWith("[") && segment.endsWith("]")) {
    return segment.slice(1, -1) || "index";
  }

  const matcherIndex = segment.indexOf("(");
  if (matcherIndex > 0) {
    return segment.slice(0, matcherIndex);
  }

  return camelCaseRouteSegment(segment);
}

function camelCaseRouteSegment(segment: string): string {
  return segment.replace(/-([a-zA-Z0-9])/g, (_match, value: string) => value.toUpperCase());
}

function getRouteClientSegments(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    return ["index"];
  }

  const stripped =
    segments[0] === "api" && segments.length > 2
      ? segments.slice(2)
      : segments.length > 1
        ? segments.slice(1)
        : [segments[segments.length - 1]];

  return stripped.map(normalizeRouteSegment).filter(Boolean);
}

function setRouteOperation(
  target: Record<string, unknown>,
  pathSegments: string[],
  operation: FarmIntegrationAPIOperation<any, any, any, any, any>,
) {
  const [head, ...tail] = pathSegments;
  if (!head) {
    return;
  }

  if (tail.length === 0) {
    const leaf = ((target[head] as Record<string, unknown> | undefined) || {}) as Record<
      string,
      unknown
    >;
    leaf[operation.method.toLowerCase()] = {
      ...operation,
      path: operation.path,
      __pathless: false,
    };
    target[head] = leaf;
    return;
  }

  const branch = ((target[head] as Record<string, unknown> | undefined) || {}) as Record<
    string,
    unknown
  >;
  target[head] = branch;
  setRouteOperation(branch, tail, operation);
}

function fromRoutes<TRoutes extends readonly FarmIntegrationRouteOperationCarrier<string, any>[]>(
  routes: TRoutes,
): RoutesToAPI<TRoutes> {
  const definition: Record<string, unknown> = {};

  for (const route of routes) {
    if (!isOperation(route.__operation)) {
      continue;
    }

    setRouteOperation(definition, getRouteClientSegments(route.path), {
      ...route.__operation,
      path: route.path,
      __pathless: false,
    });
  }

  return definition as RoutesToAPI<TRoutes>;
}

export const api = {
  get,
  route,
  fromRoutes,
  post<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
    maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "POST"> {
    return operation<TBody, TQuery, TResponse, TServer, "POST">("POST", pathOrOptions, {
      bodyFormat: "json",
      ...(typeof pathOrOptions === "string" ? maybeOptions : pathOrOptions),
    });
  },
  put<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
    maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PUT"> {
    return operation<TBody, TQuery, TResponse, TServer, "PUT">("PUT", pathOrOptions, {
      bodyFormat: "json",
      ...(typeof pathOrOptions === "string" ? maybeOptions : pathOrOptions),
    });
  },
  patch<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
    maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PATCH"> {
    return operation<TBody, TQuery, TResponse, TServer, "PATCH">("PATCH", pathOrOptions, {
      bodyFormat: "json",
      ...(typeof pathOrOptions === "string" ? maybeOptions : pathOrOptions),
    });
  },
  delete<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
    maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "DELETE"> {
    return operation<TBody, TQuery, TResponse, TServer, "DELETE">("DELETE", pathOrOptions, {
      bodyFormat: "json",
      ...(typeof pathOrOptions === "string" ? maybeOptions : pathOrOptions),
    });
  },
  options<TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
    maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer, "OPTIONS"> {
    return operation<never, TQuery, TResponse, TServer, "OPTIONS">(
      "OPTIONS",
      pathOrOptions,
      maybeOptions,
    );
  },
  head<TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
    maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
  ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer, "HEAD"> {
    return operation<never, TQuery, TResponse, TServer, "HEAD">(
      "HEAD",
      pathOrOptions,
      maybeOptions,
    );
  },
  form: {
    post<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
      maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "POST"> {
      return operation<TBody, TQuery, TResponse, TServer, "POST">("POST", pathOrOptions, {
        bodyFormat: "form",
        ...(typeof pathOrOptions === "string" ? maybeOptions : pathOrOptions),
      });
    },
    put<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
      maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PUT"> {
      return operation<TBody, TQuery, TResponse, TServer, "PUT">("PUT", pathOrOptions, {
        bodyFormat: "form",
        ...(typeof pathOrOptions === "string" ? maybeOptions : pathOrOptions),
      });
    },
    patch<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
      maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PATCH"> {
      return operation<TBody, TQuery, TResponse, TServer, "PATCH">("PATCH", pathOrOptions, {
        bodyFormat: "form",
        ...(typeof pathOrOptions === "string" ? maybeOptions : pathOrOptions),
      });
    },
    delete<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      pathOrOptions?: string | IntegrationAPIBuilderOptions<TServer>,
      maybeOptions: IntegrationAPIBuilderOptions<TServer> = {} as IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "DELETE"> {
      return operation<TBody, TQuery, TResponse, TServer, "DELETE">("DELETE", pathOrOptions, {
        bodyFormat: "form",
        ...(typeof pathOrOptions === "string" ? maybeOptions : pathOrOptions),
      });
    },
  },
};

export const endpoint = api;
