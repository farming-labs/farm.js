import type { ComponentType, ReactNode } from "react";
import { api as integrationApi, defineIntegrationAPIOperation } from "./integration-api";
import type {
  FarmIntegrationAPI,
  FarmIntegrationAPIBodyFormat,
  FarmIntegrationAPIMethod,
  FarmIntegrationAPIOperation,
  FarmIntegrationAPIResponseFormat,
  FarmIntegrationRouteOperationCarrier,
  InferIntegrationAPIFromRoutes,
} from "./integration-api";
import type { InferFarmIntegrationOrmClient } from "./integration-orm";
import type { FarmPlugin, FarmPluginContext } from "./plugin";
import {
  clearRequestContext,
  deleteRequestContext,
  getRequestContext,
  getRequestContextSnapshot,
  hasRequestContext,
  setRequestContext,
} from "./request-context";
import { sendWebResponse } from "./server/response";
import type { FarmRequest } from "./types";

export { api, defineIntegrationAPI, defineIntegrationAPIOperation } from "./integration-api";
export type {
  FarmIntegrationAPI,
  FarmIntegrationAPIBodyFormat,
  FarmIntegrationAPIMethod,
  FarmIntegrationAPIOperation,
  FarmIntegrationAPIResponseFormat,
} from "./integration-api";

export type FarmIntegrationCategory = "auth" | "payment" | "monitoring" | "logging" | (string & {});

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

export type FarmIntegrationValidationPathSegment =
  | PropertyKey
  | {
      readonly key: PropertyKey;
    };

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
    path?: readonly FarmIntegrationValidationPathSegment[];
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

export type FarmIntegrationStandardValidationResult<TValue> =
  | {
      value: TValue;
    }
  | {
      issues: readonly {
        path?: readonly FarmIntegrationValidationPathSegment[];
        code?: string;
        message: string;
      }[];
    };

export interface FarmIntegrationInputSchema<TValue = unknown> {
  _output?: TValue;
  parse?(value: unknown): MaybePromise<TValue>;
  safeParse?(value: unknown): MaybePromise<FarmIntegrationValidationResult<TValue>>;
  safeParseAsync?(value: unknown): Promise<FarmIntegrationValidationResult<TValue>>;
  "~standard"?: {
    validate(value: unknown): MaybePromise<FarmIntegrationStandardValidationResult<TValue>>;
    types?: {
      output: TValue;
    };
  };
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

export const FARM_INTEGRATION_INTERNAL_DISPATCH_CONTEXT_KEY = "farm.integration.internalDispatch";

export type FarmIntegrationRouteDb<TSchema extends FarmIntegrationSchema | undefined> =
  InferFarmIntegrationOrmClient<TSchema>;

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
  appConfig: FarmPluginContext["config"];
  /** Alias for appConfig. */
  config: FarmPluginContext["config"];
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
  requestContext: FarmIntegrationRequestContextStore;
  config: FarmPluginContext["config"];
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
  __operation: FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, TMethod>;
}

export interface FarmIntegrationRouteMiddleware<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
> {
  handler(
    request: Request,
    context: FarmIntegrationHandlerContext<unknown, unknown, TSchema>,
  ): Promise<Response | void> | Response | void;
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
  children: ReactNode;
}

export interface FarmIntegrationProvider {
  name: string;
  type: string;
  props?: Record<string, unknown>;
  component?: ComponentType<FarmIntegrationProviderProps>;
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
): TSchema {
  return schema;
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

export type FarmIntegrationsUserConfig = Record<string, FarmIntegration<any, any> | undefined>;

type IntegrationRouteBuilderOptions<
  TBody,
  TQuery,
  TServer extends boolean,
  TSchema extends FarmIntegrationSchema | undefined,
> = {
  middleware?: readonly FarmIntegrationRouteMiddleware<TSchema>[];
  before?: readonly FarmIntegrationRouteHook<TBody, TQuery, TSchema>[];
  after?: readonly FarmIntegrationRouteHook<TBody, TQuery, TSchema>[];
  rawBody?: boolean;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  bodyFormat?: FarmIntegrationAPIBodyFormat;
  responseFormat?: FarmIntegrationAPIResponseFormat;
  isServer?: TServer;
  body?: FarmIntegrationInputSchema<TBody>;
  query?: FarmIntegrationInputSchema<TQuery>;
  input?: FarmIntegrationRouteInputSchemas<TBody, TQuery>;
  handler(
    request: Request,
    context: FarmIntegrationHandlerContext<TBody, TQuery, TSchema>,
  ): Promise<Response> | Response;
};

function defineTypedIntegrationRoute<
  TPath extends string,
  TBody,
  TQuery,
  TResponse,
  TServer extends boolean,
  TMethod extends FarmIntegrationAPIMethod,
  TSchema extends FarmIntegrationSchema | undefined,
>(
  method: TMethod,
  path: TPath,
  input: IntegrationRouteBuilderOptions<TBody, TQuery, TServer, TSchema>,
): FarmTypedIntegrationRoute<TPath, TBody, TQuery, TResponse, TServer, TMethod, TSchema> {
  return {
    path,
    method,
    middleware: input.middleware,
    before: input.before,
    after: input.after,
    rawBody: input.rawBody,
    bodyFormat: input.bodyFormat,
    input: normalizeIntegrationRouteInputSchemas(input),
    handler: input.handler,
    __operation: defineIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, TMethod>({
      path,
      method,
      bodyFormat: input.bodyFormat,
      responseFormat: input.responseFormat,
      headers: input.headers,
      credentials: input.credentials,
      isServer: input.isServer,
    }),
  };
}

export interface FarmIntegrationRouteFactory<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
> {
  get<TPath extends string, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    path: TPath,
    input: Omit<IntegrationRouteBuilderOptions<never, TQuery, TServer, TSchema>, "bodyFormat">,
  ): FarmTypedIntegrationRoute<TPath, never, TQuery, TResponse, TServer, "GET", TSchema>;
  post<
    TPath extends string,
    TBody = never,
    TResponse = unknown,
    TQuery = never,
    TServer extends boolean = false,
  >(
    path: TPath,
    input: IntegrationRouteBuilderOptions<TBody, TQuery, TServer, TSchema>,
  ): FarmTypedIntegrationRoute<TPath, TBody, TQuery, TResponse, TServer, "POST", TSchema>;
  put<
    TPath extends string,
    TBody = never,
    TResponse = unknown,
    TQuery = never,
    TServer extends boolean = false,
  >(
    path: TPath,
    input: IntegrationRouteBuilderOptions<TBody, TQuery, TServer, TSchema>,
  ): FarmTypedIntegrationRoute<TPath, TBody, TQuery, TResponse, TServer, "PUT", TSchema>;
  patch<
    TPath extends string,
    TBody = never,
    TResponse = unknown,
    TQuery = never,
    TServer extends boolean = false,
  >(
    path: TPath,
    input: IntegrationRouteBuilderOptions<TBody, TQuery, TServer, TSchema>,
  ): FarmTypedIntegrationRoute<TPath, TBody, TQuery, TResponse, TServer, "PATCH", TSchema>;
  delete<
    TPath extends string,
    TBody = never,
    TResponse = unknown,
    TQuery = never,
    TServer extends boolean = false,
  >(
    path: TPath,
    input: IntegrationRouteBuilderOptions<TBody, TQuery, TServer, TSchema>,
  ): FarmTypedIntegrationRoute<TPath, TBody, TQuery, TResponse, TServer, "DELETE", TSchema>;
  options<
    TPath extends string,
    TResponse = unknown,
    TQuery = never,
    TServer extends boolean = false,
  >(
    path: TPath,
    input: Omit<IntegrationRouteBuilderOptions<never, TQuery, TServer, TSchema>, "bodyFormat">,
  ): FarmTypedIntegrationRoute<TPath, never, TQuery, TResponse, TServer, "OPTIONS", TSchema>;
  head<TPath extends string, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
    path: TPath,
    input: Omit<IntegrationRouteBuilderOptions<never, TQuery, TServer, TSchema>, "bodyFormat">,
  ): FarmTypedIntegrationRoute<TPath, never, TQuery, TResponse, TServer, "HEAD", TSchema>;
}

export interface FarmIntegrationRoutesFactoryContext<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
> {
  route: FarmIntegrationRouteFactory<TSchema>;
  integrationRoute: FarmIntegrationRouteFactory<TSchema>;
}

export type FarmIntegrationRoutesFactory<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
> = (
  context: FarmIntegrationRoutesFactoryContext<TSchema>,
) => readonly FarmIntegrationRoute<any, any, TSchema>[];

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

export interface FarmIntegrationEndpointsFactoryContext<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
> extends FarmIntegrationRoutesFactoryContext<TSchema> {
  endpoint: FarmIntegrationRouteFactory<TSchema>;
}

export type FarmIntegrationEndpointsFactory<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
> = (context: FarmIntegrationEndpointsFactoryContext<TSchema>) => FarmIntegrationEndpoints<TSchema>;

function createIntegrationRouteFactory<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
>(): FarmIntegrationRouteFactory<TSchema> {
  return {
    get<TPath extends string, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: TPath,
      input: Omit<IntegrationRouteBuilderOptions<never, TQuery, TServer, TSchema>, "bodyFormat">,
    ) {
      return defineTypedIntegrationRoute<TPath, never, TQuery, TResponse, TServer, "GET", TSchema>(
        "GET",
        path,
        input,
      );
    },
    post<
      TPath extends string,
      TBody = never,
      TResponse = unknown,
      TQuery = never,
      TServer extends boolean = false,
    >(path: TPath, input: IntegrationRouteBuilderOptions<TBody, TQuery, TServer, TSchema>) {
      return defineTypedIntegrationRoute<TPath, TBody, TQuery, TResponse, TServer, "POST", TSchema>(
        "POST",
        path,
        {
          bodyFormat: "json",
          ...input,
        },
      );
    },
    put<
      TPath extends string,
      TBody = never,
      TResponse = unknown,
      TQuery = never,
      TServer extends boolean = false,
    >(path: TPath, input: IntegrationRouteBuilderOptions<TBody, TQuery, TServer, TSchema>) {
      return defineTypedIntegrationRoute<TPath, TBody, TQuery, TResponse, TServer, "PUT", TSchema>(
        "PUT",
        path,
        {
          bodyFormat: "json",
          ...input,
        },
      );
    },
    patch<
      TPath extends string,
      TBody = never,
      TResponse = unknown,
      TQuery = never,
      TServer extends boolean = false,
    >(path: TPath, input: IntegrationRouteBuilderOptions<TBody, TQuery, TServer, TSchema>) {
      return defineTypedIntegrationRoute<
        TPath,
        TBody,
        TQuery,
        TResponse,
        TServer,
        "PATCH",
        TSchema
      >("PATCH", path, {
        bodyFormat: "json",
        ...input,
      });
    },
    delete<
      TPath extends string,
      TBody = never,
      TResponse = unknown,
      TQuery = never,
      TServer extends boolean = false,
    >(path: TPath, input: IntegrationRouteBuilderOptions<TBody, TQuery, TServer, TSchema>) {
      return defineTypedIntegrationRoute<
        TPath,
        TBody,
        TQuery,
        TResponse,
        TServer,
        "DELETE",
        TSchema
      >("DELETE", path, {
        bodyFormat: "json",
        ...input,
      });
    },
    options<
      TPath extends string,
      TResponse = unknown,
      TQuery = never,
      TServer extends boolean = false,
    >(
      path: TPath,
      input: Omit<IntegrationRouteBuilderOptions<never, TQuery, TServer, TSchema>, "bodyFormat">,
    ) {
      return defineTypedIntegrationRoute<
        TPath,
        never,
        TQuery,
        TResponse,
        TServer,
        "OPTIONS",
        TSchema
      >("OPTIONS", path, input);
    },
    head<
      TPath extends string,
      TResponse = unknown,
      TQuery = never,
      TServer extends boolean = false,
    >(
      path: TPath,
      input: Omit<IntegrationRouteBuilderOptions<never, TQuery, TServer, TSchema>, "bodyFormat">,
    ) {
      return defineTypedIntegrationRoute<TPath, never, TQuery, TResponse, TServer, "HEAD", TSchema>(
        "HEAD",
        path,
        input,
      );
    },
  };
}

export function createIntegrationRoute<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
>(_schema?: TSchema): FarmIntegrationRouteFactory<TSchema> {
  return createIntegrationRouteFactory<TSchema>();
}

export const integrationRoute = createIntegrationRouteFactory<undefined>();

type RegisteredIntegrationRuntime = {
  integration: FarmIntegration;
  config: FarmPluginContext["config"];
  isDev: boolean;
  isProd: boolean;
};

const INTEGRATION_RUNTIME_REGISTRY_KEY = Symbol.for("farm.integrationRuntimeRegistry");
const INTEGRATION_REQUEST_DISPATCHER_KEY = Symbol.for("farm.integrationRequestDispatcher");

type IntegrationRequestDispatcher = (
  runtime: RegisteredIntegrationRuntime,
  request: Request,
  options?: { currentRequest?: Request },
) => Promise<Response | null>;

type GlobalWithIntegrationRuntimeRegistry = typeof globalThis & {
  [INTEGRATION_RUNTIME_REGISTRY_KEY]?: Map<string, RegisteredIntegrationRuntime>;
  [INTEGRATION_REQUEST_DISPATCHER_KEY]?: IntegrationRequestDispatcher;
};

function getIntegrationRuntimeRegistry() {
  const globalState = globalThis as GlobalWithIntegrationRuntimeRegistry;
  if (!globalState[INTEGRATION_RUNTIME_REGISTRY_KEY]) {
    globalState[INTEGRATION_RUNTIME_REGISTRY_KEY] = new Map<string, RegisteredIntegrationRuntime>();
  }

  return globalState[INTEGRATION_RUNTIME_REGISTRY_KEY]!;
}

type FarmIntegrationRoutesInput<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
> = readonly FarmIntegrationRoute<any, any, TSchema>[] | FarmIntegrationRoutesFactory<TSchema>;

type FarmIntegrationEndpointsInput<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
> = FarmIntegrationEndpoints<TSchema> | FarmIntegrationEndpointsFactory<TSchema>;

type FarmIntegrationInput<
  TSchema extends FarmIntegrationSchema | undefined = FarmIntegrationSchema | undefined,
  TConfig = unknown,
> = Omit<
  FarmIntegration<TSchema, TConfig>,
  "kind" | "category" | "slot" | "config" | "routes" | "endpoints"
> & {
  config?: FarmIntegrationConfigInput<TConfig, TSchema>;
  routes?: FarmIntegrationRoutesInput<TSchema>;
  endpoints?: FarmIntegrationEndpointsInput<TSchema>;
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

type FarmIntegrationCategoryInput =
  | {
      category: FarmIntegrationCategory;
      slot?: FarmIntegrationCategory;
    }
  | {
      category?: FarmIntegrationCategory;
      slot: FarmIntegrationCategory;
    };

type FarmIntegrationShapeForInference = FarmIntegrationCategoryInput & {
  api?: FarmIntegrationAPI;
  schema?: FarmIntegrationSchema;
  config?: unknown;
  routes?: unknown;
  endpoints?: unknown;
};

type ExtractIntegrationSchema<TIntegration> = TIntegration extends {
  schema: infer TSchema extends FarmIntegrationSchema;
}
  ? TSchema
  : undefined;

type ResolveIntegrationRoutesInput<TRoutes, TSchema extends FarmIntegrationSchema | undefined> =
  TRoutes extends FarmIntegrationRoutesFactory<TSchema> ? ReturnType<TRoutes> : TRoutes;

type ResolveIntegrationEndpointsInput<
  TEndpoints,
  TSchema extends FarmIntegrationSchema | undefined,
> =
  TEndpoints extends FarmIntegrationEndpointsFactory<TSchema> ? ReturnType<TEndpoints> : TEndpoints;

type ExtractIntegrationRoutesFromRoutesInput<
  TRoutes,
  TSchema extends FarmIntegrationSchema | undefined,
> =
  ResolveIntegrationRoutesInput<TRoutes, TSchema> extends readonly (infer TRoute)[]
    ? TRoute
    : never;

type ExtractIntegrationRoutesFromEndpointValue<TValue> =
  TValue extends FarmIntegrationRouteOperationCarrier<string, any>
    ? TValue
    : TValue extends readonly (infer TItem)[]
      ? ExtractIntegrationRoutesFromEndpointValue<TItem>
      : TValue extends object
        ? ExtractIntegrationRoutesFromEndpointValue<TValue[keyof TValue]>
        : never;

type ExtractIntegrationRoutesFromEndpointsInput<
  TEndpoints,
  TSchema extends FarmIntegrationSchema | undefined,
> = ExtractIntegrationRoutesFromEndpointValue<
  ResolveIntegrationEndpointsInput<TEndpoints, TSchema>
>;

type ExtractIntegrationRouteUnion<TIntegration, TSchema extends FarmIntegrationSchema | undefined> =
  | (TIntegration extends { routes: infer TRoutes }
      ? ExtractIntegrationRoutesFromRoutesInput<TRoutes, TSchema>
      : never)
  | (TIntegration extends { endpoints: infer TEndpoints }
      ? ExtractIntegrationRoutesFromEndpointsInput<TEndpoints, TSchema>
      : never);

type ExtractDefinedIntegrationRoutes<
  TIntegration,
  TSchema extends FarmIntegrationSchema | undefined,
> = [ExtractIntegrationRouteUnion<TIntegration, TSchema>] extends [never]
  ? undefined
  : readonly ExtractIntegrationRouteUnion<TIntegration, TSchema>[];

type ExtractDefinedIntegrationEndpoints<
  TIntegration,
  TSchema extends FarmIntegrationSchema | undefined,
> = TIntegration extends { endpoints: infer TEndpoints }
  ? ResolveIntegrationEndpointsInput<TEndpoints, TSchema>
  : undefined;

type ExtractIntegrationAPIRoutes<
  TIntegration,
  TSchema extends FarmIntegrationSchema | undefined,
> = Extract<
  ExtractIntegrationRouteUnion<TIntegration, TSchema>,
  FarmIntegrationRouteOperationCarrier<string, any>
>;

type ExtractIntegrationCategory<TIntegration extends FarmIntegrationCategoryInput> =
  TIntegration extends {
    category: infer TCategory extends FarmIntegrationCategory;
  }
    ? TCategory
    : TIntegration extends { slot: infer TSlot extends FarmIntegrationCategory }
      ? TSlot
      : FarmIntegrationCategory;

type ExtractDerivedIntegrationAPI<
  TIntegration extends FarmIntegrationShapeForInference,
  TSchema extends FarmIntegrationSchema | undefined = ExtractIntegrationSchema<TIntegration>,
> = TIntegration extends { api: infer TAPI extends FarmIntegrationAPI }
  ? TAPI
  : [ExtractIntegrationAPIRoutes<TIntegration, TSchema>] extends [never]
    ? FarmIntegrationAPI | undefined
    : InferIntegrationAPIFromRoutes<readonly ExtractIntegrationAPIRoutes<TIntegration, TSchema>[]>;

export type DefinedIntegration<
  TIntegration extends FarmIntegrationShapeForInference,
  TSchema extends FarmIntegrationSchema | undefined = ExtractIntegrationSchema<TIntegration>,
> = Omit<TIntegration, "kind" | "category" | "slot" | "api" | "routes" | "endpoints"> & {
  readonly kind: "farm-integration";
  category: ExtractIntegrationCategory<TIntegration>;
  slot: ExtractIntegrationCategory<TIntegration>;
  routes: ExtractDefinedIntegrationRoutes<TIntegration, TSchema>;
  endpoints: ExtractDefinedIntegrationEndpoints<TIntegration, TSchema>;
  api: ExtractDerivedIntegrationAPI<TIntegration, TSchema>;
};

function isIntegrationEndpointRoute(value: unknown): value is FarmIntegrationRoute {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { handler?: unknown }).handler === "function"
  );
}

function flattenIntegrationEndpoints(
  endpoints: FarmIntegrationEndpointValue | FarmIntegrationEndpoints | undefined,
): FarmIntegrationRoute[] {
  if (!endpoints) {
    return [];
  }

  if (Array.isArray(endpoints)) {
    return endpoints.flatMap((endpoint) => flattenIntegrationEndpoints(endpoint));
  }

  if (isIntegrationEndpointRoute(endpoints)) {
    return [endpoints];
  }

  if (typeof endpoints === "object") {
    return Object.values(endpoints).flatMap((endpoint) => flattenIntegrationEndpoints(endpoint));
  }

  return [];
}

export function defineIntegration<
  const TSchema extends FarmIntegrationSchema | undefined,
  const TConfig,
  TIntegration extends FarmIntegrationInput<TSchema, TConfig>,
>(
  integration: TIntegration & FarmIntegrationInput<TSchema, TConfig>,
): DefinedIntegration<TIntegration, TSchema>;
export function defineIntegration<
  const TSchema extends FarmIntegrationSchema | undefined,
  const TConfig,
  TIntegration extends FarmIntegrationInput<TSchema, TConfig>,
>(
  integration: TIntegration & FarmIntegrationInput<TSchema, TConfig>,
): DefinedIntegration<TIntegration, TSchema> {
  const category = integration.category ?? integration.slot;

  if (!category) {
    throw new Error("Integration category is required.");
  }

  if (integration.category && integration.slot && integration.category !== integration.slot) {
    throw new Error("Integration category and slot must match when both are provided.");
  }

  const routeFactory = createIntegrationRoute(integration.schema);
  const routes =
    typeof integration.routes === "function"
      ? integration.routes({
          route: routeFactory,
          integrationRoute: routeFactory,
        })
      : integration.routes;
  const endpoints =
    typeof integration.endpoints === "function"
      ? integration.endpoints({
          endpoint: routeFactory,
          route: routeFactory,
          integrationRoute: routeFactory,
        })
      : integration.endpoints;
  const endpointRoutes = flattenIntegrationEndpoints(endpoints);
  const allRoutes =
    routes?.length || endpointRoutes.length
      ? ([...(routes || []), ...endpointRoutes] as readonly FarmIntegrationRoute[])
      : undefined;

  const derivedApi =
    integration.api ||
    (allRoutes?.length
      ? integrationApi.fromRoutes(
          allRoutes as unknown as ReadonlyArray<{
            path: string;
            __operation: FarmIntegrationAPIOperation<any, any, any, any, any>;
          }>,
        )
      : undefined);

  return {
    kind: "farm-integration",
    ...integration,
    endpoints,
    routes: allRoutes,
    api: derivedApi,
    category,
    slot: category,
  } as unknown as DefinedIntegration<TIntegration, TSchema>;
}

export function isFarmIntegration(value: unknown): value is FarmIntegration {
  return (
    !!value && typeof value === "object" && (value as FarmIntegration).kind === "farm-integration"
  );
}

export function resolveIntegrationPlugins(
  integrations: FarmIntegrationsUserConfig | undefined,
): FarmPlugin[] {
  if (!integrations) {
    return [];
  }

  const plugins: FarmPlugin[] = [];
  for (const [key, integration] of Object.entries(integrations)) {
    if (!integration || !isFarmIntegration(integration)) {
      continue;
    }

    plugins.push(createIntegrationPlugin(key, integration));

    if (integration.plugins?.length) {
      plugins.push(...integration.plugins);
    }
  }

  return plugins;
}

export function getIntegrationProviders(
  integrations: FarmIntegrationsUserConfig | undefined,
): Array<Pick<FarmIntegrationProvider, "name" | "type" | "props">> {
  if (!integrations) {
    return [];
  }

  const providers: Array<Pick<FarmIntegrationProvider, "name" | "type" | "props">> = [];
  for (const integration of Object.values(integrations)) {
    if (!integration || !isFarmIntegration(integration) || !integration.providers?.length) {
      continue;
    }

    for (const provider of integration.providers) {
      providers.push({
        name: provider.name,
        type: provider.type,
        props: provider.props,
      });
    }
  }

  return providers;
}

export function getIntegrationDocumentNavigationMatchers(
  integrations: FarmIntegrationsUserConfig | undefined,
): string[] {
  if (!integrations) {
    return [];
  }

  const matchers: string[] = [];
  for (const integration of Object.values(integrations)) {
    if (
      !integration ||
      !isFarmIntegration(integration) ||
      !integration.documentNavigations?.length
    ) {
      continue;
    }

    for (const navigation of integration.documentNavigations) {
      const items = Array.isArray(navigation.matcher) ? navigation.matcher : [navigation.matcher];

      for (const item of items) {
        matchers.push(item);
      }
    }
  }

  return matchers;
}

export function getIntegrationSchemas(
  integrations: FarmIntegrationsUserConfig | undefined,
): Record<string, FarmIntegrationSchema> {
  if (!integrations) {
    return {};
  }

  const schemaEntries = Object.entries(integrations)
    .map(([key, integration]) => {
      const schema = integration && isFarmIntegration(integration) ? integration.schema : undefined;
      return schema ? ([key, schema] as const) : null;
    })
    .filter((value): value is readonly [string, FarmIntegrationSchema] => value !== null);

  return Object.fromEntries(schemaEntries);
}

export function getRegisteredIntegrationRuntime(
  key: string,
): RegisteredIntegrationRuntime | undefined {
  return getIntegrationRuntimeRegistry().get(key);
}

export function getRegisteredIntegrations(): Record<string, FarmIntegration> {
  return Object.fromEntries(
    Array.from(getIntegrationRuntimeRegistry().entries()).map(([key, runtime]) => [
      key,
      runtime.integration,
    ]),
  );
}

export function getRegisteredIntegrationSchemas(): Record<string, FarmIntegrationSchema> {
  return getIntegrationSchemas(getRegisteredIntegrations());
}

export function matchIntegrationRoute(
  integrations: FarmIntegrationsUserConfig | undefined,
  input: {
    pathname: string;
    method?: string;
  },
): {
  key: string;
  integration: FarmIntegration;
  route: {
    path: string;
    methods: readonly string[];
  };
  params: FarmIntegrationRouteParams;
} | null {
  if (!integrations) {
    return null;
  }

  for (const [key, integration] of Object.entries(integrations)) {
    if (!integration || !isFarmIntegration(integration)) {
      continue;
    }

    const routes = normalizeIntegrationRoutes(integration.routes || []);

    for (const route of routes) {
      if (!matchesMethod(route.methods, input.method)) {
        continue;
      }

      const params = extractPathParams(route.path, input.pathname);
      if (!params) {
        continue;
      }

      return {
        key,
        integration,
        route: {
          path: route.path,
          methods: route.methods,
        },
        params,
      };
    }
  }

  return null;
}

export function matchRegisteredIntegrationRoute(input: { pathname: string; method?: string }): {
  key: string;
  integration: FarmIntegration;
  route: {
    path: string;
    methods: readonly string[];
  };
  params: FarmIntegrationRouteParams;
} | null {
  return matchIntegrationRoute(getRegisteredIntegrations(), input);
}

function createClientSafeIntegrationAPI(
  api: FarmIntegrationAPI | undefined,
): FarmIntegrationAPI | undefined {
  if (!api) {
    return undefined;
  }

  const entries = Object.entries(api as Record<string, unknown>).map(([key, value]) => {
    if (
      value &&
      typeof value === "object" &&
      (value as FarmIntegrationAPIOperation<any, any, any, any, any>).kind ===
        "farm-integration-api-operation"
    ) {
      const operation = value as FarmIntegrationAPIOperation<any, any, any, any, any>;
      return [
        key,
        defineIntegrationAPIOperation({
          path: operation.path,
          method: operation.method,
          bodyFormat: operation.bodyFormat,
          responseFormat: operation.responseFormat,
          credentials: operation.credentials,
          isServer: operation.isServer,
        }),
      ];
    }

    if (value && typeof value === "object") {
      return [key, createClientSafeIntegrationAPI(value as FarmIntegrationAPI)];
    }

    return [key, value];
  });

  return Object.fromEntries(entries) as FarmIntegrationAPI;
}

export function getRegisteredIntegrationAPIManifest(): Record<string, FarmIntegrationAPI> {
  const manifestEntries = Object.entries(getRegisteredIntegrations())
    .map(([key, integration]) => {
      const api = createClientSafeIntegrationAPI(integration.api);
      return api ? ([key, api] as const) : null;
    })
    .filter((value): value is readonly [string, FarmIntegrationAPI] => value !== null);

  return Object.fromEntries(manifestEntries);
}

type IntegrationLifecycleCleanup = () => MaybePromise<void>;

function getIntegrationRuntimeEnv(): Record<string, string | undefined> {
  return typeof process !== "undefined" ? process.env : {};
}

function isIntegrationConfigDefinition(
  value: unknown,
): value is FarmIntegrationConfigDefinition<unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    ("schema" in value ||
      "env" in value ||
      "defaults" in value ||
      "input" in value ||
      "resolve" in value)
  );
}

function mergeIntegrationConfigValue(current: unknown, next: unknown): unknown {
  if (next === undefined) {
    return current;
  }

  if (isPlainIntegrationConfigObject(current) && isPlainIntegrationConfigObject(next)) {
    return {
      ...current,
      ...next,
    };
  }

  return next;
}

function isPlainIntegrationConfigObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function resolveIntegrationConfigPart<TValue>(
  value: TValue | ((context: FarmIntegrationConfigContext) => MaybePromise<TValue>) | undefined,
  context: FarmIntegrationConfigContext,
): Promise<TValue | undefined> {
  if (typeof value === "function") {
    return (value as (context: FarmIntegrationConfigContext) => MaybePromise<TValue>)(context);
  }

  return value;
}

function resolveIntegrationEnvConfig(
  env: Record<string, string | readonly string[]> | undefined,
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }

  const runtimeEnv = getIntegrationRuntimeEnv();
  const config: Record<string, string> = {};

  for (const [key, names] of Object.entries(env)) {
    const envNames = Array.isArray(names) ? names : [names];
    const value = envNames.map((name) => runtimeEnv[name]).find((entry) => entry !== undefined);
    if (value !== undefined) {
      config[key] = value;
    }
  }

  return config;
}

async function parseIntegrationConfigSchema<TConfig>(
  integration: FarmIntegration<any, any>,
  schema: FarmIntegrationInputSchema<TConfig>,
  value: unknown,
): Promise<TConfig> {
  const parser = schema.safeParseAsync || schema.safeParse;
  if (parser) {
    const result = await parser.call(schema, value);
    if (result.success) {
      return result.data;
    }

    throw createIntegrationConfigValidationError(integration, result.error);
  }

  if (schema["~standard"]?.validate) {
    const result = await schema["~standard"].validate(value);
    if ("value" in result) {
      return result.value;
    }

    throw createIntegrationConfigValidationError(integration, {
      issues: result.issues,
    });
  }

  if (schema.parse) {
    try {
      return await schema.parse(value);
    } catch (error) {
      throw createIntegrationConfigValidationError(
        integration,
        normalizeIntegrationValidationError(error),
      );
    }
  }

  throw new Error(
    `Integration "${integration.type}" config schema must expose safeParse, safeParseAsync, parse, or ~standard.validate.`,
  );
}

function createIntegrationConfigValidationError(
  integration: FarmIntegration<any, any>,
  error: FarmIntegrationValidationErrorLike,
) {
  const issues =
    Array.isArray(error.issues) && error.issues.length > 0
      ? error.issues
          .map((issue) => {
            const normalizedPath = normalizeIntegrationValidationPath(issue.path);
            const path = normalizedPath.length ? `${normalizedPath.join(".")}: ` : "";
            return `${path}${issue.message || "Invalid config"}`;
          })
          .join("; ")
      : error.message || "Invalid config";

  return new Error(`Integration "${integration.type}" config validation failed: ${issues}`);
}

async function resolveIntegrationConfig<TConfig>(
  integration: FarmIntegration<any, TConfig>,
  context: FarmIntegrationConfigContext,
): Promise<TConfig> {
  const config = integration.config;
  if (!config) {
    return undefined as TConfig;
  }

  if (!isIntegrationConfigDefinition(config)) {
    return parseIntegrationConfigSchema(integration, config, {});
  }

  let value: unknown = {};
  value = mergeIntegrationConfigValue(
    value,
    await resolveIntegrationConfigPart(config.defaults, context),
  );
  value = mergeIntegrationConfigValue(value, resolveIntegrationEnvConfig(config.env));
  value = mergeIntegrationConfigValue(
    value,
    await resolveIntegrationConfigPart(config.input, context),
  );
  value = mergeIntegrationConfigValue(value, await config.resolve?.(context));

  return config.schema
    ? parseIntegrationConfigSchema(integration, config.schema, value)
    : (value as TConfig);
}

function createIntegrationLifecycleLogger(
  integration: FarmIntegration<any, any>,
  phase: FarmIntegrationLogPhase,
): FarmIntegrationLifecycleLogger {
  const write = (
    level: FarmIntegrationLifecycleLogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    if (!integration.log) {
      return;
    }

    void Promise.resolve(
      integration.log({
        category: integration.category,
        slot: integration.category,
        type: integration.type,
        phase,
        level,
        message,
        meta,
        context: new Map(),
      }),
    ).catch(() => {});
  };

  return {
    info(message, meta) {
      write("info", message, meta);
    },
    warn(message, meta) {
      write("warn", message, meta);
    },
    error(message, meta) {
      write("error", message, meta);
    },
  };
}

const INTEGRATION_DATA_HEADER = "x-farm-integration-data";
const INTEGRATION_DATA_HEADER_MAX_LENGTH = 16 * 1024;
const BLOCKED_INTEGRATION_DATA_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isFarmIntegrationData(value: unknown): value is FarmIntegrationData {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPlainIntegrationDataObject(value: unknown): value is Record<string, unknown> {
  if (!isFarmIntegrationData(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeIntegrationDataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeIntegrationDataValue(item));
  }

  if (!isPlainIntegrationDataObject(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (BLOCKED_INTEGRATION_DATA_KEYS.has(key)) {
      continue;
    }

    sanitized[key] = sanitizeIntegrationDataValue(item);
  }

  return sanitized;
}

function normalizeIntegrationData(value: FarmIntegrationData | undefined): FarmIntegrationData {
  if (!isFarmIntegrationData(value)) {
    return {};
  }

  const sanitized = sanitizeIntegrationDataValue(value);
  return isFarmIntegrationData(sanitized) ? sanitized : {};
}

function getIntegrationDataHeaderByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parseIntegrationDataHeader(request: Request): FarmIntegrationData {
  const raw = request.headers.get(INTEGRATION_DATA_HEADER);
  if (!raw) {
    return {};
  }

  if (getIntegrationDataHeaderByteLength(raw) > INTEGRATION_DATA_HEADER_MAX_LENGTH) {
    return {};
  }

  try {
    const value = JSON.parse(raw);
    return normalizeIntegrationData(value);
  } catch {
    return {};
  }
}

function resolveIntegrationData(request: Request, data?: FarmIntegrationData): FarmIntegrationData {
  return {
    ...parseIntegrationDataHeader(request),
    ...normalizeIntegrationData(data),
  };
}

function createIntegrationPlugin(integrationKey: string, integration: FarmIntegration): FarmPlugin {
  const routes = normalizeIntegrationRoutes(integration.routes || []);
  const middleware = [...(integration.middleware || [])];
  const cleanupCallbacks: IntegrationLifecycleCleanup[] = [];
  let integrationConfigPromise: Promise<unknown> | undefined;

  const runCleanup = async () => {
    const callbacks = cleanupCallbacks.splice(0).reverse();
    for (const callback of callbacks) {
      await callback();
    }
  };

  const createLifecycleContext = async (
    context: FarmPluginContext,
    phase: FarmIntegrationLogPhase,
    options: { reason?: string } = {},
  ): Promise<FarmIntegrationLifecycleContext> => {
    const args = createIntegrationRouteArgs({
      integration,
      config: context.config,
    });
    const configContext: FarmIntegrationConfigContext = {
      key: integrationKey,
      integration,
      appConfig: context.config,
      config: context.config,
      args,
      env: getIntegrationRuntimeEnv(),
      isDev: context.isDev,
      isProd: context.isProd,
    };
    integrationConfigPromise ??= resolveIntegrationConfig(integration, configContext);

    return {
      ...configContext,
      integrationConfig: await integrationConfigPromise,
      log: createIntegrationLifecycleLogger(integration, phase),
      reason: options.reason,
      async cleanup(callback) {
        if (callback) {
          cleanupCallbacks.push(callback);
          return;
        }

        await runCleanup();
      },
    };
  };

  return {
    name: `farm:integration:${integration.category}:${integration.type}`,
    enforce: "pre",

    async init(context) {
      getIntegrationRuntimeRegistry().set(integrationKey, {
        integration,
        config: context.config,
        isDev: context.isDev,
        isProd: context.isProd,
      });

      await createLifecycleContext(context, "validate");

      if (integration.validate) {
        await integration.validate(await createLifecycleContext(context, "validate"));
      }

      if (integration.setup) {
        await integration.setup(await createLifecycleContext(context, "setup"));
      }

      if (!integration.log) {
        return;
      }

      for (const route of routes) {
        await integration.log({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "registered",
          route: {
            kind: "route",
            path: route.path,
            methods: route.methods,
          },
          context: new Map(),
        });
      }

      for (const entry of middleware) {
        await integration.log({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "registered",
          route: {
            kind: "middleware",
            path: normalizeMatcher(entry.matcher),
            methods: ["ALL"],
          },
          context: new Map(),
        });
      }
    },

    async ready(context) {
      if (integration.ready) {
        await integration.ready(await createLifecycleContext(context, "ready"));
      }
    },

    async shutdown(payload, context) {
      try {
        if (integration.dispose) {
          await integration.dispose(
            await createLifecycleContext(context, "dispose", {
              reason: payload.reason,
            }),
          );
        }
      } finally {
        await runCleanup();
      }
    },

    async beforeRequest(req, res, context) {
      const fullUrl = `http://${req.headers.host || "localhost"}${req.url || "/"}`;
      const url = new URL(fullUrl);
      const pathname = url.pathname;
      const requestId = getRequestId(req);
      let bodyLoaded = false;
      let requestBody: Buffer | undefined;

      const getRequestBody = async () => {
        if (!bodyLoaded) {
          bodyLoaded = true;
          if (req.method && req.method !== "GET" && req.method !== "HEAD") {
            requestBody = await readRequestBody(req);
          }
        }

        return requestBody;
      };

      const createHandlerRequest = async () => {
        return createWebRequest(req, fullUrl, await getRequestBody());
      };

      for (const entry of middleware) {
        const params = resolveMatcherParams(entry.matcher, pathname);
        if (!params) {
          continue;
        }

        const request = await createHandlerRequest();
        const handlerContext = createIntegrationHandlerContext({
          integration,
          route: {
            kind: "middleware",
            path: normalizeMatcher(entry.matcher),
            methods: ["ALL"],
          },
          request,
          rawRequest: req,
          params,
          pathname,
          requestId,
          pluginContext: context,
        });
        const startedAt = Date.now();
        await integration.log?.({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "request:start",
          route: {
            kind: "middleware",
            path: normalizeMatcher(entry.matcher),
            methods: ["ALL"],
          },
          request,
          requestId,
          context: handlerContext.requestContext.snapshot(),
        });

        try {
          const response = await entry.handler(request, handlerContext);
          if (response) {
            await sendWebResponse(res, response);
            await integration.log?.({
              category: integration.category,
              slot: integration.category,
              type: integration.type,
              phase: "request:end",
              route: {
                kind: "middleware",
                path: normalizeMatcher(entry.matcher),
                methods: ["ALL"],
              },
              request,
              response,
              requestId,
              durationMs: Date.now() - startedAt,
              context: handlerContext.requestContext.snapshot(),
            });
            return;
          }

          await integration.log?.({
            category: integration.category,
            slot: integration.category,
            type: integration.type,
            phase: "request:end",
            route: {
              kind: "middleware",
              path: normalizeMatcher(entry.matcher),
              methods: ["ALL"],
            },
            request,
            requestId,
            durationMs: Date.now() - startedAt,
            context: handlerContext.requestContext.snapshot(),
          });
        } catch (error) {
          await integration.log?.({
            category: integration.category,
            slot: integration.category,
            type: integration.type,
            phase: "request:error",
            route: {
              kind: "middleware",
              path: normalizeMatcher(entry.matcher),
              methods: ["ALL"],
            },
            request,
            requestId,
            durationMs: Date.now() - startedAt,
            error,
            context: handlerContext.requestContext.snapshot(),
          });
          throw error;
        }
      }

      for (const route of routes) {
        const params = matchesMethod(route.methods, req.method)
          ? extractPathParams(route.path, pathname)
          : null;
        if (!params) {
          continue;
        }

        const request = await createHandlerRequest();
        const handlerContext = createIntegrationHandlerContext({
          integration,
          route: {
            kind: "route",
            path: route.path,
            methods: route.methods,
          },
          request,
          rawRequest: req,
          params,
          pathname,
          requestId,
          pluginContext: context,
        });
        const startedAt = Date.now();
        await integration.log?.({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "request:start",
          route: {
            kind: "route",
            path: route.path,
            methods: route.methods,
          },
          request,
          requestId,
          context: handlerContext.requestContext.snapshot(),
        });

        try {
          const validation = await validateIntegrationRouteInput(route, request, url);
          if (!validation.success) {
            await sendWebResponse(res, validation.response);
            await integration.log?.({
              category: integration.category,
              slot: integration.category,
              type: integration.type,
              phase: "request:end",
              route: {
                kind: "route",
                path: route.path,
                methods: route.methods,
              },
              request,
              response: validation.response,
              requestId,
              durationMs: Date.now() - startedAt,
              context: handlerContext.requestContext.snapshot(),
            });
            return;
          }
          handlerContext.input = validation.input;

          for (const middlewareEntry of route.middleware || []) {
            const middlewareResponse = await middlewareEntry.handler(request, handlerContext);
            if (middlewareResponse) {
              await sendWebResponse(res, middlewareResponse);
              await integration.log?.({
                category: integration.category,
                slot: integration.category,
                type: integration.type,
                phase: "request:end",
                route: {
                  kind: "route",
                  path: route.path,
                  methods: route.methods,
                },
                request,
                response: middlewareResponse,
                requestId,
                durationMs: Date.now() - startedAt,
                context: handlerContext.requestContext.snapshot(),
              });
              return;
            }
          }

          const beforeResponse = await runIntegrationRouteBeforeHooks(
            route,
            request,
            handlerContext,
          );
          if (beforeResponse) {
            const response = await runIntegrationRouteAfterHooks(
              route,
              request,
              handlerContext,
              beforeResponse,
            );
            await sendWebResponse(res, response);
            await integration.log?.({
              category: integration.category,
              slot: integration.category,
              type: integration.type,
              phase: "request:end",
              route: {
                kind: "route",
                path: route.path,
                methods: route.methods,
              },
              request,
              response,
              requestId,
              durationMs: Date.now() - startedAt,
              context: handlerContext.requestContext.snapshot(),
            });
            return;
          }

          const handlerResponse = await route.handler(request, handlerContext);
          const response = await runIntegrationRouteAfterHooks(
            route,
            request,
            handlerContext,
            handlerResponse,
          );
          await sendWebResponse(res, response);
          await integration.log?.({
            category: integration.category,
            slot: integration.category,
            type: integration.type,
            phase: "request:end",
            route: {
              kind: "route",
              path: route.path,
              methods: route.methods,
            },
            request,
            response,
            requestId,
            durationMs: Date.now() - startedAt,
            context: handlerContext.requestContext.snapshot(),
          });
          return;
        } catch (error) {
          await integration.log?.({
            category: integration.category,
            slot: integration.category,
            type: integration.type,
            phase: "request:error",
            route: {
              kind: "route",
              path: route.path,
              methods: route.methods,
            },
            request,
            requestId,
            durationMs: Date.now() - startedAt,
            error,
            context: handlerContext.requestContext.snapshot(),
          });
          throw error;
        }
      }
    },
  };
}

function createIntegrationHandlerContext(input: {
  integration: FarmIntegration;
  route: FarmIntegrationHandlerContext["route"];
  request: Request;
  rawRequest: FarmRequest;
  params: FarmIntegrationRouteParams;
  pathname: string;
  requestId: string;
  pluginContext: FarmPluginContext;
}): FarmIntegrationHandlerContext {
  return {
    request: input.request,
    requestId: input.requestId,
    url: new URL(input.request.url),
    pathname: input.pathname,
    method: input.request.method,
    params: input.params,
    input: {},
    args: createIntegrationRouteArgs({
      integration: input.integration,
      config: input.pluginContext.config,
    }),
    data: resolveIntegrationData(input.request),
    integration: {
      category: input.integration.category,
      slot: input.integration.category,
      type: input.integration.type,
      instance: input.integration.instance,
    },
    route: input.route,
    requestContext: createIntegrationRequestContextStore(
      input.rawRequest,
      input.request,
      input.pluginContext,
    ),
    config: input.pluginContext.config,
    isDev: input.pluginContext.isDev,
    isProd: input.pluginContext.isProd,
  };
}

type NormalizedIntegrationRoute = Omit<FarmIntegrationRoute, "method" | "methods"> & {
  methods: readonly string[];
  __operation?: FarmIntegrationAPIOperation<any, any, any, any, any>;
};

function normalizeIntegrationRoutes(
  routes: readonly FarmIntegrationRoute[],
): NormalizedIntegrationRoute[] {
  return routes.map((route) => ({
    ...route,
    methods: normalizeIntegrationRouteMethods(route),
    input: normalizeIntegrationRouteInputSchemas(route),
  }));
}

function normalizeIntegrationRouteMethods(route: Pick<FarmIntegrationRoute, "method" | "methods">) {
  const input =
    route.methods && route.methods.length > 0
      ? [...route.methods]
      : route.method
        ? [route.method]
        : ["ALL"];

  return input.map((method) => String(method).toUpperCase());
}

function normalizeIntegrationRouteInputSchemas<TBody, TQuery>(
  route: Pick<FarmIntegrationRoute<TBody, TQuery>, "body" | "query" | "input">,
): FarmIntegrationRouteInputSchemas<TBody, TQuery> | undefined {
  const input: FarmIntegrationRouteInputSchemas<TBody, TQuery> = {
    ...route.input,
  };

  if (route.body) {
    input.body = route.body;
  }

  if (route.query) {
    input.query = route.query;
  }

  return input.body || input.query ? input : undefined;
}

type IntegrationRouteInputValidationResult =
  | {
      success: true;
      input: FarmIntegrationRouteInput;
    }
  | {
      success: false;
      response: Response;
    };

async function validateIntegrationRouteInput(
  route: NormalizedIntegrationRoute,
  request: Request,
  url: URL,
): Promise<IntegrationRouteInputValidationResult> {
  const schemas = route.input;
  if (!schemas?.body && !schemas?.query) {
    return {
      success: true,
      input: {},
    };
  }

  const input: FarmIntegrationRouteInput = {};
  const issues: FarmIntegrationValidationIssue[] = [];

  if (schemas.query) {
    const queryResult = await parseIntegrationInputSchema(
      "query",
      schemas.query,
      createQueryInput(url.searchParams),
    );
    if (queryResult.success) {
      input.query = queryResult.data;
    } else {
      issues.push(...queryResult.issues);
    }
  }

  if (schemas.body) {
    const bodyInput = await readIntegrationValidationBody(
      request,
      getIntegrationRouteBodyFormat(route),
    );

    if (bodyInput.success) {
      const bodyResult = await parseIntegrationInputSchema("body", schemas.body, bodyInput.data);
      if (bodyResult.success) {
        input.body = bodyResult.data;
      } else {
        issues.push(...bodyResult.issues);
      }
    } else {
      issues.push(bodyInput.issue);
    }
  }

  if (issues.length > 0) {
    return {
      success: false,
      response: createIntegrationValidationResponse(issues),
    };
  }

  return {
    success: true,
    input,
  };
}

async function parseIntegrationInputSchema<TValue>(
  source: FarmIntegrationRouteInputSource,
  schema: FarmIntegrationInputSchema<TValue>,
  value: unknown,
): Promise<
  | {
      success: true;
      data: TValue;
    }
  | {
      success: false;
      issues: FarmIntegrationValidationIssue[];
    }
> {
  const parser = schema.safeParseAsync || schema.safeParse;
  if (parser) {
    const result = await parser.call(schema, value);
    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    }

    return {
      success: false,
      issues: normalizeIntegrationValidationIssues(source, result.error),
    };
  }

  if (schema["~standard"]?.validate) {
    const result = await schema["~standard"].validate(value);
    if ("value" in result) {
      return {
        success: true,
        data: result.value,
      };
    }

    return {
      success: false,
      issues: normalizeIntegrationValidationIssues(source, {
        issues: result.issues,
      }),
    };
  }

  if (schema.parse) {
    try {
      return {
        success: true,
        data: await schema.parse(value),
      };
    } catch (error) {
      return {
        success: false,
        issues: normalizeIntegrationValidationIssues(
          source,
          normalizeIntegrationValidationError(error),
        ),
      };
    }
  }

  return {
    success: false,
    issues: [
      {
        source,
        message:
          "Input schema must expose safeParse, safeParseAsync, parse, or ~standard.validate.",
      },
    ],
  };
}

function createIntegrationValidationResponse(issues: readonly FarmIntegrationValidationIssue[]) {
  return Response.json(
    {
      error: "Integration route input validation failed",
      issues,
    },
    {
      status: 400,
    },
  );
}

function normalizeIntegrationValidationIssues(
  source: FarmIntegrationRouteInputSource,
  error: FarmIntegrationValidationErrorLike,
): FarmIntegrationValidationIssue[] {
  if (Array.isArray(error.issues) && error.issues.length > 0) {
    return error.issues.map((issue) => ({
      source,
      path: normalizeIntegrationValidationPath(issue.path),
      code: issue.code,
      message: issue.message || "Invalid input",
    }));
  }

  return [
    {
      source,
      path: [],
      message: error.message || "Invalid input",
    },
  ];
}

function normalizeIntegrationValidationPath(
  path: readonly FarmIntegrationValidationPathSegment[] | undefined,
): (string | number)[] {
  return (path || []).map((segment) => {
    const key =
      typeof segment === "object" && segment !== null && "key" in segment ? segment.key : segment;
    return typeof key === "symbol" ? key.description || key.toString() : key;
  });
}

function normalizeIntegrationValidationError(error: unknown): FarmIntegrationValidationErrorLike {
  if (error && typeof error === "object") {
    return error as FarmIntegrationValidationErrorLike;
  }

  return {
    message: error instanceof Error ? error.message : String(error || "Invalid input"),
  };
}

async function readIntegrationValidationBody(
  request: Request,
  format: FarmIntegrationAPIBodyFormat,
): Promise<
  | {
      success: true;
      data: unknown;
    }
  | {
      success: false;
      issue: FarmIntegrationValidationIssue;
    }
> {
  if (request.method === "GET" || request.method === "HEAD" || format === "none") {
    return {
      success: true,
      data: undefined,
    };
  }

  try {
    if (format === "form") {
      return {
        success: true,
        data: createFormInput(await request.clone().formData()),
      };
    }

    const text = await request.clone().text();
    if (text.trim().length === 0) {
      return {
        success: true,
        data: undefined,
      };
    }

    return {
      success: true,
      data: JSON.parse(text),
    };
  } catch (error) {
    return {
      success: false,
      issue: {
        source: "body",
        path: [],
        message:
          format === "json"
            ? "Expected a valid JSON request body."
            : error instanceof Error && error.message
              ? error.message
              : "Could not parse request body.",
      },
    };
  }
}

function getIntegrationRouteBodyFormat(route: NormalizedIntegrationRoute) {
  return route.bodyFormat || route.__operation?.bodyFormat || "json";
}

function createIntegrationRouteArgs(input: {
  integration: FarmIntegration;
  config: FarmPluginContext["config"];
}): FarmIntegrationRouteArgs {
  let clientPromise: Promise<unknown | undefined> | undefined;
  let ormPromise: Promise<unknown> | undefined;

  const getClient = () => {
    clientPromise ??= import("./storage").then(({ resolveStorageRuntimeClient }) =>
      resolveStorageRuntimeClient(input.config.storage),
    );
    return clientPromise;
  };

  const getOrm = () => {
    if (!input.integration.schema) {
      throw new Error(
        `Integration "${input.integration.type}" does not define a schema for ctx.args.db.`,
      );
    }

    ormPromise ??= import("./integration-orm").then(({ createIntegrationOrm }) =>
      createIntegrationOrm({
        schema: input.integration.schema!,
        config: input.config,
      }),
    );
    return ormPromise;
  };

  return {
    db: createLazyIntegrationOrmClient(getOrm) as never,
    getDb: getOrm as never,
    storage: {
      getClient,
      getOrm: getOrm as never,
    },
  };
}

function createLazyIntegrationOrmClient(resolveOrm: () => Promise<unknown>) {
  const modelProxyCache = new Map<PropertyKey, unknown>();

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return undefined;
        }

        if (prop === "transaction" || prop === "batch") {
          return async (...args: unknown[]) => {
            const orm = (await resolveOrm()) as Record<PropertyKey, unknown>;
            const member = orm[prop];
            if (typeof member !== "function") {
              throw new Error(`Integration ORM does not expose "${String(prop)}".`);
            }
            return member.apply(orm, args);
          };
        }

        if (prop === "$driver") {
          return undefined;
        }

        if (!modelProxyCache.has(prop)) {
          modelProxyCache.set(prop, createLazyIntegrationOrmModel(resolveOrm, prop));
        }

        return modelProxyCache.get(prop);
      },
    },
  );
}

function createLazyIntegrationOrmModel(resolveOrm: () => Promise<unknown>, modelName: PropertyKey) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return undefined;
        }

        return async (...args: unknown[]) => {
          const orm = (await resolveOrm()) as Record<PropertyKey, Record<PropertyKey, unknown>>;
          const model = orm[modelName];
          const member = model?.[prop];
          if (typeof member !== "function") {
            throw new Error(
              `Integration ORM model "${String(modelName)}" does not expose "${String(prop)}".`,
            );
          }
          return member.apply(model, args);
        };
      },
    },
  );
}

async function runIntegrationRouteBeforeHooks(
  route: NormalizedIntegrationRoute,
  request: Request,
  context: FarmIntegrationHandlerContext,
): Promise<Response | undefined> {
  const hookContext = context as FarmIntegrationRouteHookContext;
  hookContext.response = undefined;

  for (const hook of route.before || []) {
    const response = await hook(request, hookContext);
    if (response) {
      hookContext.response = response;
      return response;
    }

    if (hookContext.response) {
      return hookContext.response;
    }
  }

  return undefined;
}

async function runIntegrationRouteAfterHooks(
  route: NormalizedIntegrationRoute,
  request: Request,
  context: FarmIntegrationHandlerContext,
  response: Response,
): Promise<Response> {
  const hookContext = context as FarmIntegrationRouteHookContext;
  let currentResponse = response;

  for (const hook of route.after || []) {
    hookContext.response = currentResponse;
    const nextResponse = await hook(request, hookContext);
    currentResponse = nextResponse || hookContext.response || currentResponse;
  }

  hookContext.response = currentResponse;
  return currentResponse;
}

function createQueryInput(searchParams: URLSearchParams): Record<string, string | string[]> {
  const input: Record<string, string | string[]> = {};
  searchParams.forEach((value, key) => {
    const existing = input[key];
    if (existing === undefined) {
      input[key] = value;
      return;
    }

    input[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  });
  return input;
}

function createFormInput(
  formData: FormData,
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const input: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  formData.forEach((value, key) => {
    const existing = input[key];
    if (existing === undefined) {
      input[key] = value;
      return;
    }

    input[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  });
  return input;
}

export async function dispatchIntegrationRequest(
  runtime: RegisteredIntegrationRuntime,
  request: Request,
  options: {
    currentRequest?: Request;
    data?: FarmIntegrationData;
    internal?: boolean;
  } = {},
): Promise<Response | null> {
  const integration = runtime.integration;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const requestId =
    request.headers.get("x-request-id") ||
    options.currentRequest?.headers.get("x-request-id") ||
    String(Date.now());
  const routes = normalizeIntegrationRoutes(integration.routes || []);
  const middleware = [...(integration.middleware || [])];

  for (const entry of middleware) {
    const params = resolveMatcherParams(entry.matcher, pathname);
    if (!params) {
      continue;
    }

    const handlerContext = createServerIntegrationHandlerContext({
      runtime,
      route: {
        kind: "middleware",
        path: normalizeMatcher(entry.matcher),
        methods: ["ALL"],
      },
      request,
      params,
      pathname,
      requestId,
      currentRequest: options.currentRequest,
      data: options.data,
      internal: options.internal === true,
    });
    const startedAt = Date.now();

    await integration.log?.({
      category: integration.category,
      slot: integration.category,
      type: integration.type,
      phase: "request:start",
      route: {
        kind: "middleware",
        path: normalizeMatcher(entry.matcher),
        methods: ["ALL"],
      },
      request,
      requestId,
      context: handlerContext.requestContext.snapshot(),
    });

    try {
      const response = await entry.handler(request, handlerContext);
      if (response) {
        await integration.log?.({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "request:end",
          route: {
            kind: "middleware",
            path: normalizeMatcher(entry.matcher),
            methods: ["ALL"],
          },
          request,
          response,
          requestId,
          durationMs: Date.now() - startedAt,
          context: handlerContext.requestContext.snapshot(),
        });
        return response;
      }

      await integration.log?.({
        category: integration.category,
        slot: integration.category,
        type: integration.type,
        phase: "request:end",
        route: {
          kind: "middleware",
          path: normalizeMatcher(entry.matcher),
          methods: ["ALL"],
        },
        request,
        requestId,
        durationMs: Date.now() - startedAt,
        context: handlerContext.requestContext.snapshot(),
      });
    } catch (error) {
      await integration.log?.({
        category: integration.category,
        slot: integration.category,
        type: integration.type,
        phase: "request:error",
        route: {
          kind: "middleware",
          path: normalizeMatcher(entry.matcher),
          methods: ["ALL"],
        },
        request,
        requestId,
        durationMs: Date.now() - startedAt,
        error,
        context: handlerContext.requestContext.snapshot(),
      });
      throw error;
    }
  }

  for (const route of routes) {
    const params = matchesMethod(route.methods, request.method)
      ? extractPathParams(route.path, pathname)
      : null;
    if (!params) {
      continue;
    }

    const handlerContext = createServerIntegrationHandlerContext({
      runtime,
      route: {
        kind: "route",
        path: route.path,
        methods: route.methods,
      },
      request,
      params,
      pathname,
      requestId,
      currentRequest: options.currentRequest,
      data: options.data,
      internal: options.internal === true,
    });
    const startedAt = Date.now();

    await integration.log?.({
      category: integration.category,
      slot: integration.category,
      type: integration.type,
      phase: "request:start",
      route: {
        kind: "route",
        path: route.path,
        methods: route.methods,
      },
      request,
      requestId,
      context: handlerContext.requestContext.snapshot(),
    });

    try {
      const validation = await validateIntegrationRouteInput(route, request, url);
      if (!validation.success) {
        await integration.log?.({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "request:end",
          route: {
            kind: "route",
            path: route.path,
            methods: route.methods,
          },
          request,
          response: validation.response,
          requestId,
          durationMs: Date.now() - startedAt,
          context: handlerContext.requestContext.snapshot(),
        });
        return validation.response;
      }
      handlerContext.input = validation.input;

      for (const middlewareEntry of route.middleware || []) {
        const middlewareResponse = await middlewareEntry.handler(request, handlerContext);
        if (middlewareResponse) {
          await integration.log?.({
            category: integration.category,
            slot: integration.category,
            type: integration.type,
            phase: "request:end",
            route: {
              kind: "route",
              path: route.path,
              methods: route.methods,
            },
            request,
            response: middlewareResponse,
            requestId,
            durationMs: Date.now() - startedAt,
            context: handlerContext.requestContext.snapshot(),
          });
          return middlewareResponse;
        }
      }

      const beforeResponse = await runIntegrationRouteBeforeHooks(route, request, handlerContext);
      if (beforeResponse) {
        const response = await runIntegrationRouteAfterHooks(
          route,
          request,
          handlerContext,
          beforeResponse,
        );
        await integration.log?.({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "request:end",
          route: {
            kind: "route",
            path: route.path,
            methods: route.methods,
          },
          request,
          response,
          requestId,
          durationMs: Date.now() - startedAt,
          context: handlerContext.requestContext.snapshot(),
        });
        return response;
      }

      const handlerResponse = await route.handler(request, handlerContext);
      const response = await runIntegrationRouteAfterHooks(
        route,
        request,
        handlerContext,
        handlerResponse,
      );
      await integration.log?.({
        category: integration.category,
        slot: integration.category,
        type: integration.type,
        phase: "request:end",
        route: {
          kind: "route",
          path: route.path,
          methods: route.methods,
        },
        request,
        response,
        requestId,
        durationMs: Date.now() - startedAt,
        context: handlerContext.requestContext.snapshot(),
      });
      return response;
    } catch (error) {
      await integration.log?.({
        category: integration.category,
        slot: integration.category,
        type: integration.type,
        phase: "request:error",
        route: {
          kind: "route",
          path: route.path,
          methods: route.methods,
        },
        request,
        requestId,
        durationMs: Date.now() - startedAt,
        error,
        context: handlerContext.requestContext.snapshot(),
      });
      throw error;
    }
  }

  return null;
}

(globalThis as GlobalWithIntegrationRuntimeRegistry)[INTEGRATION_REQUEST_DISPATCHER_KEY] =
  dispatchIntegrationRequest;

function createIntegrationRequestContextStore(
  rawRequest: FarmRequest,
  request: Request,
  pluginContext: FarmPluginContext,
): FarmIntegrationRequestContextStore {
  return {
    get(key) {
      const requestValue = pluginContext.requestContext.get(request, key);
      if (requestValue !== undefined) {
        return requestValue;
      }

      return pluginContext.requestContext.get(rawRequest, key);
    },
    set(key, value, options) {
      pluginContext.requestContext.set(rawRequest, key, value, options);
      pluginContext.requestContext.set(request, key, value, options);
    },
    has(key) {
      return (
        pluginContext.requestContext.has(request, key) ||
        pluginContext.requestContext.has(rawRequest, key)
      );
    },
    delete(key) {
      const deletedRequest = pluginContext.requestContext.delete(request, key);
      const deletedRaw = pluginContext.requestContext.delete(rawRequest, key);
      return deletedRequest || deletedRaw;
    },
    clear() {
      pluginContext.requestContext.clear(rawRequest);
      pluginContext.requestContext.clear(request);
    },
    snapshot(options) {
      const merged = pluginContext.requestContext.getAll(rawRequest, options);
      const requestSnapshot = pluginContext.requestContext.getAll(request, options);
      for (const [key, value] of requestSnapshot) {
        merged.set(key, value);
      }
      return merged;
    },
  };
}

function createServerIntegrationHandlerContext(input: {
  runtime: RegisteredIntegrationRuntime;
  route: FarmIntegrationHandlerContext["route"];
  request: Request;
  params: FarmIntegrationRouteParams;
  pathname: string;
  requestId: string;
  currentRequest?: Request;
  data?: FarmIntegrationData;
  internal?: boolean;
}): FarmIntegrationHandlerContext {
  const requestContext = createServerIntegrationRequestContextStore(
    input.request,
    input.currentRequest,
  );

  if (input.internal) {
    requestContext.set(FARM_INTEGRATION_INTERNAL_DISPATCH_CONTEXT_KEY, true);
  }

  return {
    request: input.request,
    requestId: input.requestId,
    url: new URL(input.request.url),
    pathname: input.pathname,
    method: input.request.method,
    params: input.params,
    input: {},
    args: createIntegrationRouteArgs({
      integration: input.runtime.integration,
      config: input.runtime.config,
    }),
    data: resolveIntegrationData(input.request, input.data),
    integration: {
      category: input.runtime.integration.category,
      slot: input.runtime.integration.category,
      type: input.runtime.integration.type,
      instance: input.runtime.integration.instance,
    },
    route: input.route,
    requestContext,
    config: input.runtime.config,
    isDev: input.runtime.isDev,
    isProd: input.runtime.isProd,
  };
}

function createServerIntegrationRequestContextStore(
  request: Request,
  currentRequest?: Request,
): FarmIntegrationRequestContextStore {
  return {
    get(key) {
      const requestValue = getRequestContext(request, key);
      if (requestValue !== undefined) {
        return requestValue;
      }

      if (currentRequest) {
        return getRequestContext(currentRequest, key);
      }

      return undefined;
    },
    set(key, value, options) {
      setRequestContext(request, key, value, options);
      if (currentRequest) {
        setRequestContext(currentRequest, key, value, options);
      }
    },
    has(key) {
      return (
        hasRequestContext(request, key) ||
        (!!currentRequest && hasRequestContext(currentRequest, key))
      );
    },
    delete(key) {
      const deletedRequest = deleteRequestContext(request, key);
      const deletedCurrent = currentRequest ? deleteRequestContext(currentRequest, key) : false;
      return deletedRequest || deletedCurrent;
    },
    clear() {
      clearRequestContext(request);
      if (currentRequest) {
        clearRequestContext(currentRequest);
      }
    },
    snapshot(options) {
      const merged = currentRequest
        ? getRequestContextSnapshot(currentRequest, options)
        : new Map<string, unknown>();
      const requestSnapshot = getRequestContextSnapshot(request, options);
      for (const [key, value] of requestSnapshot) {
        merged.set(key, value);
      }
      return merged;
    },
  };
}

function createWebRequest(req: FarmRequest, fullUrl: string, body?: Buffer): Request {
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
    body: body as BodyInit | undefined,
  });
}

function matchesMethod(methods: readonly string[], method: string | undefined): boolean {
  if (!method) {
    return false;
  }

  return methods.some((item) => item.toUpperCase() === method.toUpperCase());
}

function matchesMatcher(
  matcher: string | readonly string[] | undefined,
  pathname: string,
): boolean {
  return resolveMatcherParams(matcher, pathname) !== null;
}

function resolveMatcherParams(
  matcher: string | readonly string[] | undefined,
  pathname: string,
): FarmIntegrationRouteParams | null {
  if (!matcher) {
    return {};
  }

  const list = Array.isArray(matcher) ? matcher : [matcher];
  for (const item of list) {
    if (item === "/(.*)" || item === "*") {
      return {};
    }
    if (item.endsWith("(.*)")) {
      const prefix = item.slice(0, -4);
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return {};
      }
      continue;
    }
    const params = extractPathParams(item, pathname);
    if (params) {
      return params;
    }
  }

  return null;
}

function matchesPath(pattern: string, pathname: string): boolean {
  return extractPathParams(pattern, pathname) !== null;
}

function extractPathParams(pattern: string, pathname: string): FarmIntegrationRouteParams | null {
  const routeSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);
  const params: FarmIntegrationRouteParams = {};

  let routeIndex = 0;
  let pathIndex = 0;

  while (routeIndex < routeSegments.length && pathIndex < pathSegments.length) {
    const routeSegment = routeSegments[routeIndex];
    const pathSegment = pathSegments[pathIndex];

    if (isCatchAllSegment(routeSegment)) {
      params[getSegmentParamName(routeSegment)] = pathSegments
        .slice(pathIndex)
        .map((segment) => decodeURIComponent(segment));
      return params;
    }

    if (isDynamicSegment(routeSegment)) {
      params[getSegmentParamName(routeSegment)] = decodeURIComponent(pathSegment);
      routeIndex += 1;
      pathIndex += 1;
      continue;
    }

    if (routeSegment !== pathSegment) {
      return null;
    }

    routeIndex += 1;
    pathIndex += 1;
  }

  if (routeIndex === routeSegments.length && pathIndex === pathSegments.length) {
    return params;
  }

  if (routeIndex === routeSegments.length - 1 && isCatchAllSegment(routeSegments[routeIndex])) {
    params[getSegmentParamName(routeSegments[routeIndex])] = [];
    return params;
  }

  return null;
}

function splitPath(value: string): string[] {
  return value.split("/").filter(Boolean);
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

function isCatchAllSegment(segment: string): boolean {
  return segment.startsWith("[...") && segment.endsWith("]");
}

function getSegmentParamName(segment: string): string {
  if (isCatchAllSegment(segment)) {
    return segment.slice(4, -1);
  }

  return segment.slice(1, -1);
}

function getRequestId(req: FarmRequest): string {
  const headerValue = req.headers["x-request-id"];
  if (Array.isArray(headerValue)) {
    return headerValue[0] || String(Date.now());
  }
  return headerValue || String(Date.now());
}

async function readRequestBody(req: FarmRequest): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function normalizeMatcher(matcher: string | readonly string[] | undefined): string {
  if (!matcher) {
    return "/(.*)";
  }
  return typeof matcher === "string" ? matcher : matcher.join(", ");
}
