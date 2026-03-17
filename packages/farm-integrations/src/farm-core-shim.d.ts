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

  export interface FarmIntegrationRequestContextStore {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown, options?: { exposeToPage?: boolean }): void;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    snapshot(options?: { exposedOnly?: boolean }): Map<string, unknown>;
  }

  export interface FarmIntegrationHandlerContext {
    request: Request;
    requestId: string;
    url: URL;
    pathname: string;
    method: string;
    params: FarmIntegrationRouteParams;
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

  export interface FarmIntegrationRoute {
    path: string;
    methods: readonly string[];
    rawBody?: boolean;
    handler(request: Request, context: FarmIntegrationHandlerContext): Promise<Response> | Response;
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

  export type FarmIntegrationLogger = (
    event: FarmIntegrationLogEvent,
  ) => void | Promise<void>;

  export interface FarmIntegration {
    readonly kind: "farm-integration";
    category: FarmIntegrationCategory;
    /** @deprecated Use category instead. */
    slot?: FarmIntegrationCategory;
    type: string;
    instance: unknown;
    api?: FarmIntegrationAPI;
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

  export function defineIntegration(
    integration: FarmIntegrationInput,
  ): FarmIntegration;

  export function getIntegrationProviders(
    integrations: Record<string, FarmIntegration | undefined> | undefined,
  ): Array<Pick<FarmIntegrationProvider, "name" | "type" | "props">>;

  export function getIntegrationDocumentNavigationMatchers(
    integrations: Record<string, FarmIntegration | undefined> | undefined,
  ): string[];
}
