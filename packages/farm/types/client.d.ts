/**
 * Type declarations for @farmjs/core/client
 *
 * Provides stable exports for Link, useRouter, and API client so TypeScript
 * and IDEs resolve them even when the build output omits them. The generated
 * farm-routes.d.ts in your app augments LinkDefaultRoute for typed href.
 */

import type {
  AnchorHTMLAttributes,
  ForwardRefExoticComponent,
  ReactNode,
  RefAttributes,
} from "react";

declare module "@farmjs/core/client" {
  export interface MiddlewareProps {
    data: Map<string, any>;
  }

  export interface PluginContextProps {
    data: Map<string, any>;
  }

  export interface PageProps {
    params: Record<string, string>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
    path: string;
    middleware?: MiddlewareProps;
    context?: PluginContextProps;
  }

  export interface LayoutProps {
    children: ReactNode;
    params: Record<string, string>;
  }

  export interface Metadata {
    title?: string | { default?: string; template?: string };
    description?: string;
    keywords?: string | string[];
    authors?: Array<{ name: string; url?: string }>;
    creator?: string;
    publisher?: string;
    robots?: string | { index?: boolean; follow?: boolean };
    openGraph?: Record<string, any>;
    twitter?: Record<string, any>;
    alternates?: Record<string, any>;
    icons?: Record<string, any>;
    manifest?: string;
  }

  export type StoreState = Record<string, any>;
  export type StoreValueUpdater<T> = T | ((previous: T) => T);
  export type StorePatch<T extends StoreState> = Partial<T> | ((state: T) => Partial<T>);
  export type StoreListener<T extends StoreState> = (state: T, previousState: T) => void;
  export type StoreKeyListener<T extends StoreState, K extends keyof T> = (
    value: T[K],
    previousValue: T[K],
  ) => void;
  export type StoreKeysListener<T extends StoreState, K extends keyof T> = (
    value: Pick<T, K>,
    previousValue: Pick<T, K>,
  ) => void;

  export type StoreFields<T extends StoreState> = {
    [K in keyof T]: {
      (): T[K];
      get(): T[K];
      set(value: StoreValueUpdater<T[K]>): T[K];
      subscribe(listener: StoreKeyListener<T, K>): () => void;
    };
  };

  export interface StoreApi<T extends StoreState> {
    use(): T;
    use<K extends keyof T>(key: K): T[K];
    use<K extends keyof T>(keys: readonly K[]): Pick<T, K>;
    get(): T;
    get<K extends keyof T>(key: K): T[K];
    set<K extends keyof T>(key: K, value: StoreValueUpdater<T[K]>): T[K];
    set(patch: StorePatch<T>): T;
    replace(nextState: T | ((state: T) => T)): T;
    reset(): T;
    subscribe(listener: StoreListener<T>): () => void;
    subscribe<K extends keyof T>(key: K, listener: StoreKeyListener<T, K>): () => void;
    subscribe<K extends keyof T>(keys: readonly K[], listener: StoreKeysListener<T, K>): () => void;
  }

  export type Store<T extends StoreState, TMethods extends Record<string, any> = {}> = StoreApi<T> &
    StoreFields<T> &
    TMethods;

  export function createStore<T extends StoreState, TMethods extends Record<string, any> = {}>(
    initialState: T,
    extend?: (store: Store<T>) => TMethods,
  ): Store<T, TMethods>;

  export type PrefetchBehavior = false | "intent" | "viewport" | "render" | "none";

  /** External URLs are never type-checked as routes; use for http/https/mailto etc. */
  export type ExternalHref =
    | `http://${string}`
    | `https://${string}`
    | `//${string}`
    | `mailto:${string}`;

  export interface LinkDefaultRoute {}

  export type DefaultRoutePath = LinkDefaultRoute extends { _: infer TRoute extends string }
    ? TRoute
    : string;

  export type RouteHref<TRoute extends string> =
    | TRoute
    | `${TRoute}?${string}`
    | `${TRoute}#${string}`
    | `${TRoute}?${string}#${string}`;

  export interface LinkProps<TRoute extends string = DefaultRoutePath> extends Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "href"
  > {
    /** Internal route path (typed when route types are generated) or external URL (never raises route-type errors). */
    href: RouteHref<TRoute> | ExternalHref;
    prefetch?: PrefetchBehavior | boolean | "hover" | "viewport" | "none";
    prefetchDelay?: number;
    replace?: boolean;
    scroll?: boolean;
  }

  export const Link: ForwardRefExoticComponent<LinkProps & RefAttributes<HTMLAnchorElement>>;

  export function useRouter(): {
    pathname: string;
    searchParams: URLSearchParams;
    params: Record<string, string>;
    push: (path: string, opts?: { replace?: boolean; scroll?: boolean }) => void;
    replace: (path: string) => void;
  };

  export interface APIClientOptions {
    baseURL?: string;
    headers?: Record<string, string>;
    cacheDefaults?: CacheOptions;
  }

  export type StatusPhase =
    | "idle"
    | "pending"
    | "success"
    | "error"
    | "revalidating"
    | "invalidated";

  export type StatusEvent<TData = unknown, TError = unknown> = {
    phase: StatusPhase;
    requestId: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
    key: string;
    input?: unknown;
    data?: TData;
    error?: TError;
    isBackground?: boolean;
    timestamp: number;
  };

  export type CacheKey<TData = unknown> = string & {
    readonly __farmCacheData?: TData;
  };

  export type APIResult<TData = unknown, TError = Error> = {
    data: TData | undefined;
    error: TError | null;
    key: CacheKey<TData>;
  };

  export type RequestEvent = {
    requestId: string;
    method: StatusEvent["method"];
    key: string;
    path: string;
    input?: unknown;
    attempt: number;
    timestamp: number;
  };

  export type ResponseEvent<TData = unknown, TError = Error> = {
    requestId: string;
    method: StatusEvent["method"];
    key: string;
    path: string;
    input?: unknown;
    attempt: number;
    timestamp: number;
    response?: Response;
    data?: TData;
    error?: TError;
    ok?: boolean;
    status?: number;
  };

  export type CachePolicy = "cache-first" | "network-only" | "stale-while-revalidate";

  export type CacheOptions = {
    key?: string;
    policy?: CachePolicy;
    staleTime?: number;
    gcTime?: number;
    dedupeMs?: number;
  };

  export type RetryOptions = {
    count?: number;
    delay?: number | ((attempt: number) => number);
  };

  export type InvalidateTarget =
    | string
    | {
        key: string;
      }
    | {
        path: string;
        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
        input?: unknown;
      }
    | [RouteRef, unknown?];

  export type InvalidateOptions =
    | InvalidateTarget[]
    | {
        targets: InvalidateTarget[];
        refetch?: boolean;
      };

  export type OptimisticUpdate =
    | [RouteRef<any, any>, unknown, (prev: any) => any]
    | [CacheKey<any> | string, (prev: any) => any];

  export type OptimisticOptions<TUpdates extends readonly unknown[] = readonly OptimisticUpdate[]> =
    {
      update: TUpdates & NormalizeOptimisticUpdates<TUpdates>;
      rollbackOnError?: boolean;
    };

  export type ClientOptions<
    TData = unknown,
    TError = unknown,
    TUpdates extends readonly unknown[] = readonly OptimisticUpdate[],
  > = {
    key?: CacheKey<TData> | string;
    cache?: CacheOptions;
    retry?: RetryOptions;
    invalidate?: InvalidateOptions;
    optimistic?: OptimisticOptions<TUpdates>;
    onRequest?: (event: RequestEvent) => void;
    onResponse?: (
      data: TData | undefined,
      error: TError | null,
      event: ResponseEvent<TData, TError>,
    ) => void;
    onSuccess?: (data: TData) => void;
    onError?: (err: TError) => void;
    onSettled?: (data?: TData, err?: TError | null) => void;
    onStatus?: (event: StatusEvent<TData, TError>) => void;
  };

  type RouteRef<TInput = any, TData = any> = (
    options?: TInput,
    clientOptions?: ClientOptions<any, any>,
  ) => Promise<APIResult<TData, any>>;

  type InferRouteInput<TRoute> = TRoute extends RouteRef<infer TInput, any> ? TInput : never;
  type InferRouteData<TRoute> = TRoute extends RouteRef<any, infer TData> ? TData : never;

  type NormalizeOptimisticUpdate<TUpdate> = TUpdate extends readonly [
    infer TRoute,
    unknown,
    (prev: any) => any,
  ]
    ? TRoute extends RouteRef<any, any>
      ? [
          TRoute,
          InferRouteInput<TRoute> | undefined,
          (prev: InferRouteData<TRoute> | undefined) => InferRouteData<TRoute>,
        ]
      : never
    : TUpdate extends readonly [infer TKey, (prev: any) => any]
      ? TKey extends CacheKey<infer TData>
        ? [TKey, (prev: TData | undefined) => TData]
        : TKey extends string
          ? [TKey, (prev: unknown) => unknown]
          : never
      : never;

  type NormalizeOptimisticUpdates<TUpdates extends readonly unknown[]> = {
    [K in keyof TUpdates]: NormalizeOptimisticUpdate<TUpdates[K]>;
  };

  /**
   * Minimal structural type for Farm.js endpoints used for client inference.
   * This avoids depending on build-hash-based type files.
   */
  type TypedEndpointLike = {
    __types: {
      body: any;
      query: any;
      response: any;
    };
  };

  // Type utilities to extract endpoint input/output types
  type InferEndpointInput<T> = T extends {
    __types: {
      body: infer TBody;
      query: infer TQuery;
    };
  }
    ? TBody extends never
      ? TQuery extends never
        ? {}
        : { query?: TQuery }
      : TQuery extends never
        ? { body?: TBody }
        : { body?: TBody; query?: TQuery }
    : {};

  type InferEndpointOutput<T> = T extends {
    __types: {
      response: infer R;
    };
  }
    ? R
    : any;

  type EndpointMethod<T = any> = <
    TUpdates extends readonly unknown[] = readonly OptimisticUpdate[],
  >(
    options?: InferEndpointInput<T>,
    clientOptions?: ClientOptions<InferEndpointOutput<T>, Error, TUpdates>,
  ) => Promise<APIResult<InferEndpointOutput<T>, Error>>;

  type RouterToClient<T> = {
    [K in keyof T]: T[K] extends Record<string, TypedEndpointLike>
      ? {
          [M in keyof T[K]]: M extends "get" | "post" | "put" | "delete" | "patch"
            ? EndpointMethod<T[K][M]>
            : never;
        }
      : T[K] extends Record<string, unknown>
        ? RouterToClient<T[K]>
        : EndpointMethod<T[K]>;
  };

  export function createAPIClient<TRouter extends Record<string, any>>(
    options?: APIClientOptions,
  ): RouterToClient<TRouter>;

  export function createServerAPIClient<TEndpoints extends Record<string, unknown>>(
    endpoints: TEndpoints,
  ): TEndpoints;

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

  export const api: {
    get<TResponse = unknown, TServer extends boolean = false>(
      path: string,
      options?: Omit<
        FarmIntegrationAPIOperation<any, any, any, TServer>,
        "kind" | "method" | "path" | "__types"
      >,
    ): FarmIntegrationAPIOperation<never, never, TResponse, TServer>;
    get<TQuery = never, TResponse = unknown, TServer extends boolean = false>(
      path: string,
      options?: Omit<
        FarmIntegrationAPIOperation<any, any, any, TServer>,
        "kind" | "method" | "path" | "__types"
      >,
    ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer>;
    post<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: Omit<
        FarmIntegrationAPIOperation<any, any, any, TServer>,
        "kind" | "method" | "path" | "__types"
      >,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;
    put<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: Omit<
        FarmIntegrationAPIOperation<any, any, any, TServer>,
        "kind" | "method" | "path" | "__types"
      >,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;
    patch<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: Omit<
        FarmIntegrationAPIOperation<any, any, any, TServer>,
        "kind" | "method" | "path" | "__types"
      >,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;
    delete<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: Omit<
        FarmIntegrationAPIOperation<any, any, any, TServer>,
        "kind" | "method" | "path" | "__types"
      >,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;
    options<TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: Omit<
        FarmIntegrationAPIOperation<any, any, any, TServer>,
        "kind" | "method" | "path" | "__types"
      >,
    ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer>;
    head<TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: Omit<
        FarmIntegrationAPIOperation<any, any, any, TServer>,
        "kind" | "method" | "path" | "__types"
      >,
    ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer>;
    form: {
      post<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        path: string,
        options?: Omit<
          FarmIntegrationAPIOperation<any, any, any, TServer>,
          "kind" | "method" | "path" | "__types"
        >,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;
      put<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        path: string,
        options?: Omit<
          FarmIntegrationAPIOperation<any, any, any, TServer>,
          "kind" | "method" | "path" | "__types"
        >,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;
      patch<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        path: string,
        options?: Omit<
          FarmIntegrationAPIOperation<any, any, any, TServer>,
          "kind" | "method" | "path" | "__types"
        >,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;
      delete<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        path: string,
        options?: Omit<
          FarmIntegrationAPIOperation<any, any, any, TServer>,
          "kind" | "method" | "path" | "__types"
        >,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer>;
    };
  };

  export const endpoint: typeof api;

  export interface IntegrationClientOptions {
    baseURL?: string;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
    isServer?: false | undefined;
  }

  interface IntegrationRequestOptionsBase {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    credentials?: RequestCredentials;
  }

  export interface IntegrationClientRequestOptions extends IntegrationRequestOptionsBase {}

  export type IntegrationServerRequestLike =
    | Request
    | {
        url?: string;
        headers?: HeadersInit;
      };

  export interface IntegrationServerClientOptions
    extends Omit<IntegrationClientOptions, "isServer"> {
    isServer: true;
    request: IntegrationServerRequestLike;
    forwardHeaders?: boolean | readonly string[];
  }

  export interface IntegrationServerClientRequestOptions
    extends IntegrationRequestOptionsBase {
    baseURL?: string;
    request?: IntegrationServerRequestLike;
    forwardHeaders?: boolean | readonly string[];
  }

  export class IntegrationClientError<TData = unknown> extends Error {
    readonly status: number;
    readonly response: Response;
    readonly data: TData | undefined;
  }

  export type IntegrationOperationResult<
    TData = unknown,
    TError = IntegrationClientError<unknown> | Error,
  > = {
    data: TData | null;
    error: TError | null;
  };

  type ExtractIntegrationOperationBody<T> = T extends {
    __types?: { body: infer TBody };
  }
    ? TBody
    : never;

  type ExtractIntegrationOperationQuery<T> = T extends {
    __types?: { query: infer TQuery };
  }
    ? TQuery
    : never;

  type ExtractIntegrationOperationResponse<T> = T extends {
    __types?: { response: infer TResponse };
  }
    ? TResponse
    : unknown;

  type IsNever<T> = [T] extends [never] ? true : false;

  type IntegrationOperationInput<T> = IsNever<ExtractIntegrationOperationBody<T>> extends true
    ? IsNever<ExtractIntegrationOperationQuery<T>> extends true
      ? {}
      : { query?: ExtractIntegrationOperationQuery<T> }
    : IsNever<ExtractIntegrationOperationQuery<T>> extends true
      ? { body: ExtractIntegrationOperationBody<T> }
      : {
          body: ExtractIntegrationOperationBody<T>;
          query?: ExtractIntegrationOperationQuery<T>;
        };

  type IntegrationOperationMethod<T> = (
    options?: IntegrationOperationInput<T>,
    requestOptions?: IntegrationClientRequestOptions,
  ) => Promise<IntegrationOperationResult<ExtractIntegrationOperationResponse<T>>>;

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
      ? IntegrationOperationMethod<TAPI[K]>
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

  export type IntegrationClientAliases<TSources extends Record<string, any>> =
    IntegrationClient<TSources> & {
      integrations: IntegrationClient<TSources>;
    };

  type IntegrationServerOperationMethod<T> = (
    options?: IntegrationOperationInput<T>,
    requestOptions?: IntegrationServerClientRequestOptions,
  ) => Promise<IntegrationOperationResult<ExtractIntegrationOperationResponse<T>>>;

  type IntegrationAPIToServerClient<TAPI> = {
    [K in keyof TAPI]: TAPI[K] extends FarmIntegrationAPIOperation<any, any, any, any>
      ? IntegrationServerOperationMethod<TAPI[K]>
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

  export function createIntegrationServerClient<TSources extends Record<string, any>>(
    sources: { integrations: TSources },
    options: Omit<IntegrationServerClientOptions, "isServer">,
  ): IntegrationServerClientAliases<TSources>;

  export function createIntegrationServerClient<TSources extends Record<string, any>>(
    sources: TSources,
    options: Omit<IntegrationServerClientOptions, "isServer">,
  ): IntegrationServerClient<TSources>;

  export function createIntegrationApi<TSources extends Record<string, any>>(
    sources: { integrations: TSources },
    options?: IntegrationClientOptions,
  ): IntegrationAPI<TSources>;

  export type { APIClientOptions };
}
