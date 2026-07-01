declare module "@farmjs/core" {
  export type FarmIntegrationCategory =
    | "auth"
    | "payment"
    | "monitoring"
    | "logging"
    | (string & {});

  /** @deprecated Use FarmIntegrationCategory instead. */
  export type FarmIntegrationSlot = FarmIntegrationCategory;

  export type FarmIntegrationRouteParamValue = string | string[];
  export type FarmIntegrationRouteParams = Record<string, FarmIntegrationRouteParamValue>;
  export type FarmIntegrationRouteMethod =
    | FarmIntegrationAPIMethod
    | Lowercase<FarmIntegrationAPIMethod>
    | "ALL"
    | "all";
  export type FarmIntegrationRouteInputSource = "body" | "query";

  type MaybePromise<T> = T | Promise<T>;

  export interface FarmIntegrationRouteInput<TBody = unknown, TQuery = unknown> {
    body?: TBody;
    query?: TQuery;
  }

  export interface FarmIntegrationValidationIssue {
    source: FarmIntegrationRouteInputSource;
    path?: readonly (string | number)[];
    code?: string;
    message: string;
  }

  export interface FarmIntegrationValidationErrorLike {
    issues?: readonly {
      path?: readonly (string | number)[];
      code?: string;
      message?: string;
    }[];
    message?: string;
  }

  export type FarmIntegrationValidationResult<TValue> =
    | {
        success: true;
        data: TValue;
      }
    | {
        success: false;
        error: FarmIntegrationValidationErrorLike;
      };

  export interface FarmIntegrationInputSchema<TValue = unknown> {
    safeParse?(value: unknown): MaybePromise<FarmIntegrationValidationResult<TValue>>;
    safeParseAsync?(value: unknown): Promise<FarmIntegrationValidationResult<TValue>>;
  }

  export interface FarmIntegrationRouteInputSchemas<TBody = unknown, TQuery = unknown> {
    body?: FarmIntegrationInputSchema<TBody>;
    query?: FarmIntegrationInputSchema<TQuery>;
  }

  export interface FarmIntegrationRequestContextStore {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown, options?: { exposeToPage?: boolean }): void;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    snapshot(options?: { exposedOnly?: boolean }): Map<string, unknown>;
  }

  export interface FarmIntegrationHandlerContext<TBody = unknown, TQuery = unknown> {
    request: Request;
    requestId: string;
    url: URL;
    pathname: string;
    method: string;
    params: FarmIntegrationRouteParams;
    input: FarmIntegrationRouteInput<TBody, TQuery>;
    integration: {
      category: FarmIntegrationCategory;
      /** @deprecated Use category instead. */
      slot: FarmIntegrationCategory;
      type: string;
      instance: unknown;
    };
    route: {
      kind: "route" | "middleware";
      path: string;
      methods: readonly string[];
    };
    requestContext: FarmIntegrationRequestContextStore;
    config: Record<string, unknown>;
    isDev: boolean;
    isProd: boolean;
  }

  export interface FarmIntegrationRoute<TBody = unknown, TQuery = unknown> {
    path: string;
    method?: FarmIntegrationRouteMethod;
    methods?: readonly FarmIntegrationRouteMethod[];
    middleware?: readonly FarmIntegrationRouteMiddleware[];
    rawBody?: boolean;
    bodyFormat?: FarmIntegrationAPIBodyFormat;
    input?: FarmIntegrationRouteInputSchemas<TBody, TQuery>;
    handler(
      request: Request,
      context: FarmIntegrationHandlerContext<TBody, TQuery>,
    ): Promise<Response> | Response;
  }

  export interface FarmIntegrationRouteMiddleware {
    handler(
      request: Request,
      context: FarmIntegrationHandlerContext,
    ): Promise<Response | void> | Response | void;
  }

  export interface FarmTypedIntegrationRoute<
    TPath extends string = string,
    TBody = never,
    TQuery = never,
    TResponse = unknown,
    TServer extends boolean = false,
    TMethod extends FarmIntegrationAPIMethod = FarmIntegrationAPIMethod,
  > extends FarmIntegrationRoute<TBody, TQuery> {
    path: TPath;
    method: TMethod;
    __operation: FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;
  }

  export interface FarmIntegrationMiddleware {
    matcher?: string | string[];
    handler(
      request: Request,
      context: FarmIntegrationHandlerContext,
    ): Promise<Response | void> | Response | void;
  }

  export interface FarmIntegrationProviderProps {
    children: import("react").ReactNode;
  }

  export interface FarmIntegrationProvider {
    name: string;
    type: string;
    props?: Record<string, unknown>;
    component?: import("react").ComponentType<FarmIntegrationProviderProps>;
  }

  export interface FarmIntegrationDocumentNavigation {
    matcher: string | readonly string[];
  }

  export type FarmIntegrationSchemaFieldType =
    | "id"
    | "uuid"
    | "string"
    | "text"
    | "boolean"
    | "integer"
    | "number"
    | "datetime"
    | "json"
    | "enum";

  export interface FarmIntegrationSchemaReference {
    model: string;
    field: string;
    relation?: "belongsTo" | "hasOne" | "hasMany";
    onDelete?: "cascade" | "restrict" | "setNull" | "noAction";
    enforced?: "db" | "app" | "none";
  }

  export interface FarmIntegrationSchemaField {
    type: FarmIntegrationSchemaFieldType;
    name?: string;
    description?: string;
    required?: boolean;
    nullable?: boolean;
    primaryKey?: boolean;
    unique?: boolean;
    index?: boolean;
    list?: boolean;
    default?: unknown;
    values?: readonly string[];
    reference?: FarmIntegrationSchemaReference;
    meta?: Record<string, unknown>;
  }

  export interface FarmIntegrationSchemaConstraint {
    type: "unique" | "index";
    fields: readonly string[];
    name?: string;
    meta?: Record<string, unknown>;
  }

  export interface FarmIntegrationSchemaModel {
    name?: string;
    description?: string;
    fields: Record<string, FarmIntegrationSchemaField>;
    constraints?: readonly FarmIntegrationSchemaConstraint[];
    meta?: Record<string, unknown>;
  }

  export interface FarmIntegrationSchemaModelExtension {
    name?: string;
    description?: string;
    fields?: Record<string, FarmIntegrationSchemaField>;
    constraints?: readonly FarmIntegrationSchemaConstraint[];
    meta?: Record<string, unknown>;
  }

  export interface FarmIntegrationSchemaModelOverride {
    name?: string;
    description?: string;
    fields?: Record<string, Partial<FarmIntegrationSchemaField>>;
    constraints?: readonly FarmIntegrationSchemaConstraint[];
    meta?: Record<string, unknown>;
  }

  export interface FarmIntegrationSchema {
    models: Record<string, FarmIntegrationSchemaModel>;
    meta?: Record<string, unknown>;
    extend?: Record<string, FarmIntegrationSchemaModelExtension>;
    override?: Record<string, FarmIntegrationSchemaModelOverride>;
  }

  export function defineIntegrationSchema<TSchema extends FarmIntegrationSchema>(
    schema: TSchema,
  ): TSchema;

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

  export type FarmIntegrationRouteOperationCarrier<
    TPath extends string = string,
    TOperation extends FarmIntegrationAPIOperation<any, any, any, any> =
      FarmIntegrationAPIOperation<any, any, any, any>,
  > = {
    path: TPath;
    __operation: TOperation;
  };

  type StripRouteClientPrefix<TPath extends string> = TPath extends `/api/${string}/${infer TRest}`
    ? TRest
    : TPath extends `/${string}/${infer TRest}`
      ? TRest
      : TPath extends `/${infer TRest}`
        ? TRest
        : TPath;

  type CamelCaseRouteSegment<TSegment extends string> =
    TSegment extends `${infer THead}-${infer TTail}`
      ? `${THead}${Capitalize<CamelCaseRouteSegment<TTail>>}`
      : TSegment;

  type NormalizeRouteSegment<TSegment extends string> = TSegment extends `[...${infer TName}]`
    ? TName
    : TSegment extends `[${infer TName}]`
      ? TName
      : TSegment extends `${infer TName}(${string}`
        ? TName
        : CamelCaseRouteSegment<TSegment>;

  type RouteNamespaceFromPath<
    TPath extends string,
    TOperation extends FarmIntegrationAPIOperation<any, any, any, any>,
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
  ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;

  export function defineIntegrationAPI<TAPI extends FarmIntegrationAPI>(api: TAPI): TAPI;

  export interface FarmPlugin {
    name: string;
    enforce?: "pre" | "post";
  }

  export type FarmIntegrationLogPhase =
    | "registered"
    | "request:start"
    | "request:end"
    | "request:error";

  export interface FarmIntegrationLogEvent {
    category: FarmIntegrationCategory;
    /** @deprecated Use category instead. */
    slot: FarmIntegrationCategory;
    type: string;
    phase: FarmIntegrationLogPhase;
    route?: {
      kind: "route" | "middleware";
      path: string;
      methods: readonly string[];
    };
    requestId?: string;
    request?: Request;
    response?: Response;
    error?: unknown;
    durationMs?: number;
    context: Map<string, unknown>;
  }

  export type FarmIntegrationLogger = (event: FarmIntegrationLogEvent) => void | Promise<void>;

  export interface FarmIntegration {
    readonly kind: "farm-integration";
    category: FarmIntegrationCategory;
    /** @deprecated Use category instead. */
    slot?: FarmIntegrationCategory;
    type: string;
    instance: unknown;
    api?: FarmIntegrationAPI;
    schema?: FarmIntegrationSchema;
    log?: FarmIntegrationLogger;
    routes?: readonly FarmIntegrationRoute[];
    middleware?: readonly FarmIntegrationMiddleware[];
    providers?: readonly FarmIntegrationProvider[];
    documentNavigations?: readonly FarmIntegrationDocumentNavigation[];
    plugins?: readonly FarmPlugin[];
  }

  export type FarmIntegrationInput = Omit<FarmIntegration, "kind" | "category" | "slot"> &
    (
      | {
          category: FarmIntegrationCategory;
          slot?: FarmIntegrationCategory;
        }
      | {
          category?: FarmIntegrationCategory;
          slot: FarmIntegrationCategory;
        }
    );

  export type DefinedIntegration<TIntegration extends FarmIntegrationInput> = Omit<
    TIntegration,
    "kind" | "category" | "slot" | "api"
  > & {
    readonly kind: "farm-integration";
    category: FarmIntegrationCategory;
    slot: FarmIntegrationCategory;
    api: TIntegration extends { api: infer TAPI extends FarmIntegrationAPI }
      ? TAPI
      : FarmIntegrationAPI | undefined;
  };

  export function defineIntegration<TIntegration extends FarmIntegrationInput>(
    integration: TIntegration,
  ): DefinedIntegration<TIntegration>;

  export const integrationRoute: {
    get<TPath extends string, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: TPath,
      input: {
        middleware?: readonly FarmIntegrationRouteMiddleware[];
        rawBody?: boolean;
        headers?: Record<string, string>;
        credentials?: RequestCredentials;
        responseFormat?: FarmIntegrationAPIResponseFormat;
        isServer?: TServer;
        input?: FarmIntegrationRouteInputSchemas<never, TQuery>;
        handler(
          request: Request,
          context: FarmIntegrationHandlerContext<never, TQuery>,
        ): Promise<Response> | Response;
      },
    ): FarmTypedIntegrationRoute<TPath, never, TQuery, TResponse, TServer, "GET">;
    post<
      TPath extends string,
      TBody = never,
      TResponse = unknown,
      TQuery = never,
      TServer extends boolean = false,
    >(
      path: TPath,
      input: {
        middleware?: readonly FarmIntegrationRouteMiddleware[];
        rawBody?: boolean;
        headers?: Record<string, string>;
        credentials?: RequestCredentials;
        bodyFormat?: FarmIntegrationAPIBodyFormat;
        responseFormat?: FarmIntegrationAPIResponseFormat;
        isServer?: TServer;
        input?: FarmIntegrationRouteInputSchemas<TBody, TQuery>;
        handler(
          request: Request,
          context: FarmIntegrationHandlerContext<TBody, TQuery>,
        ): Promise<Response> | Response;
      },
    ): FarmTypedIntegrationRoute<TPath, TBody, TQuery, TResponse, TServer, "POST">;
  };

  export function getIntegrationProviders(
    integrations: Record<string, FarmIntegration | undefined> | undefined,
  ): Array<Pick<FarmIntegrationProvider, "name" | "type" | "props">>;

  export function getIntegrationDocumentNavigationMatchers(
    integrations: Record<string, FarmIntegration | undefined> | undefined,
  ): string[];

  export function getIntegrationSchemas(
    integrations: Record<string, FarmIntegration | undefined> | undefined,
  ): Record<string, FarmIntegrationSchema>;

  export function getRegisteredIntegrationSchemas(): Record<string, FarmIntegrationSchema>;
}
