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
    _output?: TValue;
    parse?(value: unknown): MaybePromise<TValue>;
    safeParse?(value: unknown): MaybePromise<FarmIntegrationValidationResult<TValue>>;
    safeParseAsync?(value: unknown): Promise<FarmIntegrationValidationResult<TValue>>;
    "~standard"?: {
      validate(value: unknown): MaybePromise<
        | {
            value: TValue;
          }
        | {
            issues: readonly {
              path?: readonly (string | number)[];
              code?: string;
              message: string;
            }[];
          }
      >;
      types?: {
        output: TValue;
      };
    };
  }

  export interface FarmIntegrationRouteInputSchemas<TBody = unknown, TQuery = unknown> {
    body?: FarmIntegrationInputSchema<TBody>;
    query?: FarmIntegrationInputSchema<TQuery>;
  }

  export interface FarmRequestStore {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown, options?: { exposeToPage?: boolean }): void;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    snapshot(options?: { exposedOnly?: boolean }): Map<string, unknown>;
  }

  /** @deprecated Use FarmRequestStore. */
  export type FarmIntegrationRequestContextStore = FarmRequestStore;

  export const FARM_INTEGRATION_INTERNAL_DISPATCH_CONTEXT_KEY: "farm.integration.internalDispatch";

  export type FarmIntegrationRouteDb<TSchema extends FarmIntegrationSchema | undefined> = Record<
    string,
    any
  >;

  export interface FarmIntegrationRouteStorageArgs<
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > {
    getClient(): Promise<unknown | undefined>;
    getOrm(): Promise<FarmIntegrationRouteDb<TSchema>>;
  }

  export interface FarmIntegrationRouteArgs<
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > {
    db: FarmIntegrationRouteDb<TSchema>;
    getDb(): Promise<FarmIntegrationRouteDb<TSchema>>;
    storage: FarmIntegrationRouteStorageArgs<TSchema>;
  }

  export interface FarmIntegrationConfigContext<
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > {
    key: string;
    integration: FarmIntegration<TSchema, any>;
    appConfig: Record<string, unknown>;
    config: Record<string, unknown>;
    args: FarmIntegrationRouteArgs<TSchema>;
    env: Record<string, string | undefined>;
    isDev: boolean;
    isProd: boolean;
  }

  export interface FarmIntegrationConfigDefinition<
    TConfig = unknown,
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > {
    schema?: FarmIntegrationInputSchema<TConfig>;
    env?: Record<string, string | readonly string[]>;
    defaults?:
      | Partial<TConfig>
      | ((context: FarmIntegrationConfigContext<TSchema>) => MaybePromise<Partial<TConfig>>);
    input?:
      | Partial<TConfig>
      | ((context: FarmIntegrationConfigContext<TSchema>) => MaybePromise<Partial<TConfig>>);
    resolve?(
      context: FarmIntegrationConfigContext<TSchema>,
    ): MaybePromise<TConfig | Partial<TConfig> | undefined>;
  }

  export type FarmIntegrationConfigInput<
    TConfig = unknown,
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > = FarmIntegrationInputSchema<TConfig> | FarmIntegrationConfigDefinition<TConfig, TSchema>;

  export type FarmIntegrationLifecycleLogLevel = "info" | "warn" | "error";

  export interface FarmIntegrationLifecycleLogger {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  }

  export interface FarmIntegrationLifecycleContext<
    TConfig = unknown,
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > extends FarmIntegrationConfigContext<TSchema> {
    integration: FarmIntegration<TSchema, TConfig>;
    integrationConfig: TConfig;
    log: FarmIntegrationLifecycleLogger;
    reason?: string;
    cleanup(callback?: () => MaybePromise<void>): Promise<void>;
  }

  export type FarmIntegrationLifecycleHook<
    TConfig = unknown,
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > = (context: FarmIntegrationLifecycleContext<TConfig, TSchema>) => MaybePromise<void>;

  /**
   * Small per-call integration metadata. Values received over HTTP are
   * client-controlled and should be validated before authorization decisions.
   */
  export type FarmIntegrationData = Record<string, unknown>;

  export interface FarmIntegrationHandlerContext<
    TBody = unknown,
    TQuery = unknown,
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > {
    request: Request;
    requestId: string;
    url: URL;
    pathname: string;
    method: string;
    params: FarmIntegrationRouteParams;
    input: FarmIntegrationRouteInput<TBody, TQuery>;
    args: FarmIntegrationRouteArgs<TSchema>;
    data: FarmIntegrationData;
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
    req: FarmRequestStore;
    /** @deprecated Use req instead. */
    requestContext: FarmRequestStore;
    config: Record<string, unknown>;
    isDev: boolean;
    isProd: boolean;
  }

  export interface FarmIntegrationRouteHookContext<
    TBody = unknown,
    TQuery = unknown,
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > extends FarmIntegrationHandlerContext<TBody, TQuery, TSchema> {
    response?: Response;
  }

  export type FarmIntegrationRouteHook<
    TBody = unknown,
    TQuery = unknown,
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > = {
    bivarianceHack(
      request: Request,
      context: FarmIntegrationRouteHookContext<TBody, TQuery, TSchema>,
    ): Promise<Response | void> | Response | void;
  }["bivarianceHack"];

  export interface FarmIntegrationRoute<
    TBody = unknown,
    TQuery = unknown,
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > {
    path: string;
    method?: FarmIntegrationRouteMethod;
    methods?: readonly FarmIntegrationRouteMethod[];
    middleware?: readonly FarmIntegrationRouteMiddleware<TSchema>[];
    before?: readonly FarmIntegrationRouteHook<TBody, TQuery, TSchema>[];
    after?: readonly FarmIntegrationRouteHook<TBody, TQuery, TSchema>[];
    rawBody?: boolean;
    bodyFormat?: FarmIntegrationAPIBodyFormat;
    body?: FarmIntegrationInputSchema<TBody>;
    query?: FarmIntegrationInputSchema<TQuery>;
    input?: FarmIntegrationRouteInputSchemas<TBody, TQuery>;
    handler(
      request: Request,
      context: FarmIntegrationHandlerContext<TBody, TQuery, TSchema>,
    ): Promise<Response> | Response;
  }

  export interface FarmIntegrationRouteMiddleware<
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > {
    handler(
      request: Request,
      context: FarmIntegrationHandlerContext<unknown, unknown, TSchema>,
    ): Promise<Response | void> | Response | void;
  }

  export interface FarmTypedIntegrationRoute<
    TPath extends string = string,
    TBody = never,
    TQuery = never,
    TResponse = unknown,
    TServer extends boolean = false,
    TMethod extends FarmIntegrationAPIMethod = FarmIntegrationAPIMethod,
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > extends FarmIntegrationRoute<TBody, TQuery, TSchema> {
    path: TPath;
    method: TMethod;
    __operation: FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;
  }

  export interface FarmIntegrationMiddleware<
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > {
    matcher?: string | string[];
    handler(
      request: Request,
      context: FarmIntegrationHandlerContext<unknown, unknown, TSchema>,
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

  export type FarmIntegrationEndpointValue<
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > =
    | FarmIntegrationRoute<any, any, TSchema>
    | readonly FarmIntegrationEndpointValue<TSchema>[]
    | {
        readonly [key: string]: FarmIntegrationEndpointValue<TSchema> | undefined;
      };

  export type FarmIntegrationEndpoints<
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > = {
    readonly [key: string]: FarmIntegrationEndpointValue<TSchema> | undefined;
  };

  export type FarmIntegrationEndpointsFactory<
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  > = (context: {
    endpoint: typeof integrationRoute;
    route: typeof integrationRoute;
    integrationRoute: typeof integrationRoute;
  }) => FarmIntegrationEndpoints<TSchema>;

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

  export interface CreateIntegrationOrmOptions<
    TClient = unknown,
    TSchema extends FarmIntegrationSchema = FarmIntegrationSchema,
  > {
    schema: TSchema;
    config?: {
      storage?: unknown;
    };
    storage?: unknown;
    client?: TClient | (() => TClient | Promise<TClient>);
  }

  export function createIntegrationOrm<
    TClient = unknown,
    TSchema extends FarmIntegrationSchema = FarmIntegrationSchema,
  >(options: CreateIntegrationOrmOptions<TClient, TSchema>): Promise<Record<string, unknown>>;

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
    [key: string]: FarmIntegrationAPI | FarmIntegrationAPIOperation<any, any, any, any, any>;
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
    | "validate"
    | "setup"
    | "ready"
    | "dispose"
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
    level?: FarmIntegrationLifecycleLogLevel;
    message?: string;
    meta?: Record<string, unknown>;
    context: Map<string, unknown>;
  }

  export type FarmIntegrationLogger = (event: FarmIntegrationLogEvent) => void | Promise<void>;

  export interface FarmIntegration<
    TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
    TConfig = unknown,
  > {
    readonly kind: "farm-integration";
    category: FarmIntegrationCategory;
    /** @deprecated Use category instead. */
    slot?: FarmIntegrationCategory;
    type: string;
    instance: unknown;
    api?: FarmIntegrationAPI;
    schema?: TSchema;
    config?: FarmIntegrationConfigInput<TConfig, TSchema>;
    validate?: FarmIntegrationLifecycleHook<TConfig, TSchema>;
    setup?: FarmIntegrationLifecycleHook<TConfig, TSchema>;
    ready?: FarmIntegrationLifecycleHook<TConfig, TSchema>;
    dispose?: FarmIntegrationLifecycleHook<TConfig, TSchema>;
    log?: FarmIntegrationLogger;
    routes?: readonly FarmIntegrationRoute<any, any, TSchema>[];
    endpoints?: FarmIntegrationEndpoints<TSchema>;
    middleware?: readonly FarmIntegrationMiddleware<TSchema>[];
    providers?: readonly FarmIntegrationProvider[];
    documentNavigations?: readonly FarmIntegrationDocumentNavigation[];
    plugins?: readonly FarmPlugin[];
  }

  export type FarmIntegrationInput = Omit<
    FarmIntegration,
    "kind" | "category" | "slot" | "config" | "endpoints"
  > & {
    config?: FarmIntegrationConfigInput;
    endpoints?: FarmIntegrationEndpoints | FarmIntegrationEndpointsFactory;
  } & (
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

  type FarmEndpointSchema<TValue = unknown> = {
    parse(value: unknown): TValue;
  };

  type InferFarmEndpointSchema<TSchema> =
    TSchema extends FarmEndpointSchema<infer TValue> ? TValue : unknown;

  export type FarmTypedEndpoint<TBody = never, TQuery = never, TResponse = unknown> = {
    __types: {
      body: TBody;
      query: TQuery;
      response: TResponse;
    };
    __path?: string;
    __method?: string;
  } & ((options?: { body?: TBody; query?: TQuery }) => Promise<TResponse>);

  export function createEndpoint<
    TBodySchema extends FarmEndpointSchema | undefined = undefined,
    TQuerySchema extends FarmEndpointSchema | undefined = undefined,
    THeadersSchema extends FarmEndpointSchema | undefined = undefined,
    TResponse = unknown,
  >(
    options: {
      method?: FarmIntegrationAPIMethod;
      body?: TBodySchema;
      query?: TQuerySchema;
      headers?: THeadersSchema;
      use?: unknown[];
    },
    handler: (context: {
      body: InferFarmEndpointSchema<TBodySchema>;
      query: InferFarmEndpointSchema<TQuerySchema>;
      headers: THeadersSchema extends FarmEndpointSchema
        ? InferFarmEndpointSchema<THeadersSchema>
        : Record<string, string>;
      request: Request;
      context: unknown;
      params: FarmIntegrationRouteParams;
    }) => TResponse | Promise<TResponse>,
  ): FarmTypedEndpoint<
    InferFarmEndpointSchema<TBodySchema>,
    InferFarmEndpointSchema<TQuerySchema>,
    Awaited<TResponse>
  >;

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
        query?: FarmIntegrationInputSchema<TQuery>;
        input?: FarmIntegrationRouteInputSchemas<never, TQuery>;
        before?: readonly FarmIntegrationRouteHook<never, TQuery>[];
        after?: readonly FarmIntegrationRouteHook<never, TQuery>[];
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
        body?: FarmIntegrationInputSchema<TBody>;
        query?: FarmIntegrationInputSchema<TQuery>;
        input?: FarmIntegrationRouteInputSchemas<TBody, TQuery>;
        before?: readonly FarmIntegrationRouteHook<TBody, TQuery>[];
        after?: readonly FarmIntegrationRouteHook<TBody, TQuery>[];
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
