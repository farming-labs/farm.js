declare module "@farmjs/core" {
  export type FarmIntegrationSlot =
    | "auth"
    | "payment"
    | "monitoring"
    | "logging"
    | (string & {});

  export interface FarmIntegrationRoute {
    path: string;
    methods: readonly string[];
    rawBody?: boolean;
    handler(request: Request): Promise<Response> | Response;
  }

  export interface FarmIntegrationMiddleware {
    matcher?: string | string[];
    handler(request: Request): Promise<Response | void> | Response | void;
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
  > {
    readonly kind: "farm-integration-api-operation";
    path: string;
    method: FarmIntegrationAPIMethod;
    bodyFormat?: FarmIntegrationAPIBodyFormat;
    responseFormat?: FarmIntegrationAPIResponseFormat;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
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
  >(
    operation: Omit<FarmIntegrationAPIOperation<TBody, TQuery, TResponse>, "kind" | "__types">,
  ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse>;

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
    slot: FarmIntegrationSlot;
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
    slot: FarmIntegrationSlot;
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

  export function defineIntegration(
    integration: Omit<FarmIntegration, "kind">,
  ): FarmIntegration;

  export function getIntegrationProviders(
    integrations: Record<string, FarmIntegration | undefined> | undefined,
  ): Array<Pick<FarmIntegrationProvider, "name" | "type" | "props">>;

  export function getIntegrationDocumentNavigationMatchers(
    integrations: Record<string, FarmIntegration | undefined> | undefined,
  ): string[];
}
