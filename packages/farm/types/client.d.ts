/**
 * Type declarations for @farm.js/core/client
 *
 * Provides stable exports for Link, useRouter, and API client so TypeScript
 * and IDEs resolve them even when the build output omits them. The generated
 * farm.d.ts in your app augments LinkDefaultRoute for typed href.
 */

import type {
  AnchorHTMLAttributes,
  ComponentType,
  FormEvent,
  FormHTMLAttributes,
  ReactElement,
  ReactNode,
  RefObject,
  RefAttributes,
} from "react";
import type { DefinedCacheKey, InferCacheKeyData, RouteDataCacheKey } from "@farm.js/core/cache";
import type { ServerFn } from "@farm.js/core/server-fn";

declare global {
  namespace FarmJS {
    /** @internal Application route patterns registered by generated types. */
    interface RouteRegistry {}
  }
}

declare module "@farm.js/core/client" {
  export interface MiddlewareProps {
    data: Map<string, any>;
  }

  export interface PluginContextProps {
    data: Map<string, any>;
  }

  export type AppRoutePattern = FarmJS.RouteRegistry extends {
    pattern: infer TPattern extends string;
  }
    ? TPattern
    : string;

  type FarmRoutePropsDefault = never;

  type FarmRoutePropsTarget = AppRoutePattern;

  type StripPageRouteSuffix<TRoute extends string> = TRoute extends `${infer TPath}?${string}`
    ? StripPageRouteSuffix<TPath>
    : TRoute extends `${infer TPath}#${string}`
      ? StripPageRouteSuffix<TPath>
      : TRoute;

  type SimplifyPageRouteParams<TValue> = { [TKey in keyof TValue]: TValue[TKey] } & {};

  type PageRouteSegmentParams<TSegment extends string> = TSegment extends `[[...${infer TParam}]]`
    ? { [TKey in TParam]?: string }
    : TSegment extends `[...${infer TParam}]`
      ? { [TKey in TParam]: string }
      : TSegment extends `[${infer TParam}]`
        ? { [TKey in TParam]: string }
        : {};

  type ExtractPageRouteParams<TRoute extends string> =
    TRoute extends `${infer TSegment}/${infer TRest}`
      ? PageRouteSegmentParams<TSegment> & ExtractPageRouteParams<TRest>
      : PageRouteSegmentParams<TRoute>;

  export type PageRouteParams<TRoute extends string> = string extends TRoute
    ? Record<string, string>
    : TRoute extends string
      ? SimplifyPageRouteParams<ExtractPageRouteParams<StripPageRouteSuffix<TRoute>>>
      : never;

  type ResolvePageRouteParams<TRoute extends FarmRoutePropsTarget> = [TRoute] extends [never]
    ? Record<string, string>
    : TRoute extends string
      ? PageRouteParams<TRoute>
      : Record<string, string>;

  export interface PageProps<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> {
    params: ResolvePageRouteParams<TRoute>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
    path: string;
    middleware?: MiddlewareProps;
    context?: PluginContextProps;
  }

  export interface LoadingProps<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> {
    params: ResolvePageRouteParams<TRoute>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
    search?: Record<string, string | string[] | undefined>;
    path: string;
    middleware?: MiddlewareProps;
    context?: PluginContextProps;
  }

  export interface ErrorProps<
    TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault,
  > extends LoadingProps<TRoute> {
    error: unknown;
    reset: () => void;
  }

  export interface LayoutProps<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> {
    children: ReactNode;
    params: ResolvePageRouteParams<TRoute>;
  }

  export type MetadataProps<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> =
    PageProps<TRoute>;

  export interface LayoutMetadataProps<
    TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault,
  > {
    params: ResolvePageRouteParams<TRoute>;
  }

  export type StaticPathPrimitive = string | number | boolean;
  export type StaticPathParams = Record<
    string,
    StaticPathPrimitive | readonly StaticPathPrimitive[]
  >;

  type StaticRouteSegmentParams<TSegment extends string> = TSegment extends `[[...${infer TParam}]]`
    ? { [TKey in TParam]?: readonly StaticPathPrimitive[] }
    : TSegment extends `[...${infer TParam}]`
      ? { [TKey in TParam]: readonly StaticPathPrimitive[] }
      : TSegment extends `[${infer TParam}]`
        ? { [TKey in TParam]: StaticPathPrimitive }
        : {};

  type ExtractStaticRouteParams<TRoute extends string> =
    TRoute extends `${infer TSegment}/${infer TRest}`
      ? StaticRouteSegmentParams<TSegment> & ExtractStaticRouteParams<TRest>
      : StaticRouteSegmentParams<TRoute>;

  export type StaticRouteParams<TRoute extends string> = string extends TRoute
    ? StaticPathParams
    : TRoute extends string
      ? SimplifyPageRouteParams<ExtractStaticRouteParams<StripPageRouteSuffix<TRoute>>>
      : never;

  type ResolveStaticRouteParams<TRoute extends FarmRoutePropsTarget> = [TRoute] extends [never]
    ? StaticPathParams
    : TRoute extends string
      ? StaticRouteParams<TRoute>
      : StaticPathParams;

  export type GenerateStaticParams<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> =
    () =>
      | Array<ResolveStaticRouteParams<TRoute>>
      | Promise<Array<ResolveStaticRouteParams<TRoute>>>;

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

  /** URI schemes recognized as typed external Link targets. Apps may augment this interface. */
  export interface LinkExternalUriSchemes {
    about: true;
    blob: true;
    data: true;
    file: true;
    ftp: true;
    ftps: true;
    geo: true;
    git: true;
    http: true;
    https: true;
    im: true;
    intent: true;
    irc: true;
    ircs: true;
    magnet: true;
    mailto: true;
    market: true;
    sms: true;
    ssh: true;
    tel: true;
    urn: true;
    vscode: true;
    webcal: true;
    ws: true;
    wss: true;
  }

  type ExternalUriScheme = Extract<keyof LinkExternalUriSchemes, string>;

  type UriSchemeLetter =
    | "a"
    | "b"
    | "c"
    | "d"
    | "e"
    | "f"
    | "g"
    | "h"
    | "i"
    | "j"
    | "k"
    | "l"
    | "m"
    | "n"
    | "o"
    | "p"
    | "q"
    | "r"
    | "s"
    | "t"
    | "u"
    | "v"
    | "w"
    | "x"
    | "y"
    | "z";
  type UriSchemeStart = UriSchemeLetter | Uppercase<UriSchemeLetter>;
  type UriSchemeCharacter =
    | UriSchemeStart
    | "0"
    | "1"
    | "2"
    | "3"
    | "4"
    | "5"
    | "6"
    | "7"
    | "8"
    | "9"
    | "+"
    | "-"
    | ".";
  type IsUriSchemeTail<TValue extends string> = TValue extends ""
    ? true
    : TValue extends `${infer First}${infer Rest}`
      ? First extends UriSchemeCharacter
        ? IsUriSchemeTail<Rest>
        : false
      : false;
  type IsUriScheme<TValue extends string> = TValue extends `${infer First}${infer Rest}`
    ? First extends UriSchemeStart
      ? IsUriSchemeTail<Rest>
      : false
    : false;

  type KnownExternalHref = `//${string}` | `${ExternalUriScheme}:${string}`;

  /** External URLs are never type-checked as routes; use for http/https/mailto etc. */
  export type ExternalHref<THref extends string = string> = string extends THref
    ? KnownExternalHref
    : THref extends `//${string}`
      ? THref
      : THref extends `${infer Scheme}:${string}`
        ? IsUriScheme<Scheme> extends true
          ? THref
          : never
        : never;

  export interface LinkDefaultRoute {}

  export type DefaultRoutePath = LinkDefaultRoute extends { _: infer TRoute extends string }
    ? TRoute
    : string;

  export type DefaultRoutePattern = LinkDefaultRoute extends {
    pattern: infer TRoute extends string;
  }
    ? TRoute
    : DefaultRoutePath;

  export type DefaultRouteHref = DefaultRoutePath | DefaultRoutePattern;

  export type RouteHref<TRoute extends string> =
    | TRoute
    | `${TRoute}?${string}`
    | `${TRoute}#${string}`
    | `${TRoute}?${string}#${string}`;

  /** A generated route with params already filled into its pathname. */
  export type ResolvedRouteHref = RouteHref<DefaultRoutePath>;

  export type RouteParamPrimitive = string | number | boolean;
  export type RouteParamValue = RouteParamPrimitive | readonly RouteParamPrimitive[];
  export type RouteOptionalParamValue = RouteParamValue | null | undefined;
  export type RouteQueryValue =
    | RouteParamPrimitive
    | readonly RouteParamPrimitive[]
    | null
    | undefined;

  export type RouteParams<TRoute extends string> = string extends TRoute
    ? Record<string, RouteOptionalParamValue>
    : ExtractRouteParams<StripRouteSuffix<TRoute>>;

  export type StripRouteSuffix<TRoute extends string> = TRoute extends `${infer Path}?${string}`
    ? StripRouteSuffix<Path>
    : TRoute extends `${infer Path}#${string}`
      ? StripRouteSuffix<Path>
      : TRoute;

  export type ExtractRouteParams<TRoute extends string> = Simplify<
    ExtractOptionalCatchAllParams<TRoute> &
      ExtractCatchAllParams<TRoute> &
      ExtractDynamicParams<TRoute>
  >;

  export type ExtractOptionalCatchAllParams<TRoute extends string> =
    TRoute extends `${string}[[...${infer Param}]]${infer Rest}`
      ? { [Key in Param]?: RouteOptionalParamValue } & ExtractOptionalCatchAllParams<Rest>
      : {};

  export type ExtractCatchAllParams<TRoute extends string> =
    TRoute extends `${string}[...${infer Param}]${infer Rest}`
      ? Param extends `[...${string}`
        ? ExtractCatchAllParams<Rest>
        : { [Key in Param]: RouteParamValue } & ExtractCatchAllParams<Rest>
      : {};

  export type ExtractDynamicParams<TRoute extends string> =
    TRoute extends `${string}[${infer Param}]${infer Rest}`
      ? Param extends `...${string}` | `[...${string}`
        ? ExtractDynamicParams<Rest>
        : { [Key in Param]: RouteParamValue } & ExtractDynamicParams<Rest>
      : {};

  export type Simplify<T> = { [Key in keyof T]: T[Key] } & {};

  export type LinkRouteParamsProps<TRoute extends string> = string extends TRoute
    ? { params?: Record<string, RouteOptionalParamValue> }
    : keyof RouteParams<TRoute> extends never
      ? { params?: Record<string, RouteOptionalParamValue> }
      : { params: RouteParams<TRoute> };

  export type RoutesWithRequiredParams<TRoute extends string> = TRoute extends string
    ? keyof RouteParams<TRoute> extends never
      ? never
      : TRoute
    : never;

  export type LinkRouteTargetProps<TRoute extends string> = [
    RoutesWithRequiredParams<TRoute>,
  ] extends [never]
    ? {
        href: RouteHref<TRoute>;
        params?: Record<string, RouteOptionalParamValue>;
      }
    : TRoute extends string
      ? {
          href: RouteHref<TRoute>;
        } & LinkRouteParamsProps<TRoute>
      : never;

  export type LinkExternalTargetProps<THref extends string = string> = {
    href: ExternalHref<THref>;
    params?: never;
  };

  export type LinkProps<
    TRoute extends string = DefaultRouteHref,
    THref extends string = string,
  > = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
    (LinkExternalTargetProps<THref> | LinkRouteTargetProps<TRoute>) & {
      /** Internal route path (typed when route types are generated) or external URL (never raises route-type errors). */
      prefetch?: PrefetchBehavior | boolean | "hover" | "viewport" | "none";
      query?: URLSearchParams | Record<string, RouteQueryValue>;
      hash?: string;
      trailingSlash?: boolean;
      prefetchDelay?: number;
      replace?: boolean;
      scroll?: boolean;
      viewTransition?: FarmViewTransitionMode;
    };

  export type LinkComponent = <
    TRoute extends string = DefaultRouteHref,
    THref extends string = string,
  >(
    props: LinkProps<TRoute, THref> & RefAttributes<HTMLAnchorElement>,
  ) => ReactElement;

  export const Link: LinkComponent;

  export interface FarmNavigationBlockerContext {
    from: string;
    to: string;
    action: "push" | "replace" | "pop";
  }

  export type FarmNavigationBlocker = (
    context: FarmNavigationBlockerContext,
  ) => boolean | void | Promise<boolean | void>;

  export type FarmViewTransitionMode = boolean | "auto";

  export interface FarmNavigateOptions {
    replace?: boolean;
    scroll?: boolean;
    state?: unknown;
    viewTransition?: FarmViewTransitionMode;
  }

  export interface FarmNavigationLocation {
    href: string;
    pathname: string;
    search: string;
    hash: string;
  }

  export interface FarmNavigationState {
    state: "idle" | "loading";
    pending: boolean;
    from: string | null;
    to: FarmNavigationLocation | null;
    action: FarmNavigationBlockerContext["action"] | null;
    startedAt: number | null;
  }

  export type FarmNavigationListener = (state: FarmNavigationState) => void;

  export interface RouterOptions {
    prefetchTimeout?: number;
    cacheMaxAge?: number;
    scrollRestoration?: boolean;
    shouldUseDocumentNavigation?: (pathname: string) => boolean;
    deploymentId?: string;
  }

  export class SPARouter {
    constructor(options?: RouterOptions);
    setNavigationHandler(handler: (data: Record<string, any>) => Promise<void>): void;
    navigate(href: string, options?: FarmNavigateOptions): Promise<void>;
    prefetch(href: string): Promise<void>;
    observeForPrefetch(element: HTMLAnchorElement): void;
    unobserveForPrefetch(element: HTMLAnchorElement): void;
    addBlocker(blocker: FarmNavigationBlocker): () => void;
    getNavigationState(): FarmNavigationState;
    subscribeNavigation(listener: FarmNavigationListener): () => void;
    registerScrollElement(key: string, element: HTMLElement): () => void;
    pushState(state: unknown, href?: string): void;
    replaceState(state: unknown, href?: string): void;
    clearCache(): void;
  }

  export function getRouter(): SPARouter;

  export interface FarmChunkRecoveryOptions {
    maxAgeMs?: number;
    storageKey?: string;
    onRecover?: (error: unknown) => void;
    reload?: () => void;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    location?: Pick<Location, "pathname" | "search" | "reload">;
    now?: () => number;
  }

  export interface UseRouterOptions {
    basePath?: string;
    routes?: Array<string | { path: string; name?: string; meta?: unknown }>;
  }

  export interface UseBlockerOptions {
    when: boolean | ((context: FarmNavigationBlockerContext) => boolean);
    message?: string;
    shouldBlock?: (context: FarmNavigationBlockerContext) => boolean | Promise<boolean>;
  }

  export interface UseBlockerReturn {
    active: boolean;
  }

  export function useRouter(options?: UseRouterOptions): {
    pathname: string;
    searchParams: URLSearchParams;
    params: Record<string, string>;
    pageState: unknown;
    push: (path: string) => void;
    replace: (path: string) => void;
    pushState: <TState>(state: TState, href?: string) => void;
    replaceState: <TState>(state: TState, href?: string) => void;
    back: () => void;
    forward: () => void;
  };

  export function usePageState<TState = unknown>(): TState | null;
  export function useNavigation(): FarmNavigationState;
  export function useBlocker(options: UseBlockerOptions): UseBlockerReturn;
  export function useScrollRestoration<TElement extends HTMLElement = HTMLElement>(
    key: string,
  ): RefObject<TElement>;
  export function navigateTo(href: string, options?: FarmNavigateOptions): Promise<void>;
  export function prefetch(href: string): Promise<void>;
  export function pushState<TState>(state: TState, href?: string): void;
  export function replaceState<TState>(state: TState, href?: string): void;
  export function readPageState<TState = unknown>(): TState | null;
  export function isChunkLoadError(errorLike: unknown): boolean;
  export function installChunkErrorRecovery(options?: FarmChunkRecoveryOptions): () => void;

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
    method: "GET" | "HEAD" | "QUERY" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
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

  export interface FarmAPIStream<TItem> extends AsyncIterable<TItem> {
    readonly response: Response;
    cancel(reason?: unknown): Promise<void>;
  }

  export class APIClientError<
    TCode extends string = string,
    TData = unknown,
    TStatus extends number = number,
  > extends Error {
    readonly code: TCode;
    readonly data: TData;
    readonly status: TStatus;
    readonly response?: Response;

    constructor(
      code: TCode,
      data: TData,
      options: {
        status: TStatus;
        message: string;
        response?: Response;
      },
    );
  }

  export type APIClientSystemError =
    | APIClientError<"http_error", unknown, number>
    | APIClientError<"network_error", unknown, 0>;

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
    key?: RouteDataCacheKey;
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
    | RouteDataCacheKey
    | {
        key: RouteDataCacheKey;
      }
    | {
        path: string;
        method?: "GET" | "HEAD" | "QUERY" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
        input?: unknown;
      }
    | [CallableRouteRef, unknown?];

  export type InvalidateOptions =
    | InvalidateTarget[]
    | {
        targets: InvalidateTarget[];
        refetch?: boolean;
      };

  export type OptimisticUpdate =
    | [CallableRouteRef<any>, unknown, (prev: any) => any]
    | [CacheKey<any> | DefinedCacheKey<any> | string, (prev: any) => any];

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
    key?: CacheKey<TData> | RouteDataCacheKey;
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

  type AnyRouteRef = (...args: any[]) => any;
  type RouteRef<TData = any, TInput = any> = {
    readonly __farmRouteInput: TInput;
    readonly __farmRouteData: TData;
  };
  type CallableRouteRef<TData = any, TInput = any> = AnyRouteRef & RouteRef<TData, TInput>;

  type InferRouteInput<TRoute> = TRoute extends { readonly __farmRouteInput: infer TInput }
    ? TInput
    : never;
  type InferRouteData<TRoute> = TRoute extends { readonly __farmRouteData: infer TData }
    ? TData
    : never;

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
      ? TKey extends DefinedCacheKey<any, RouteDataCacheKey>
        ? [TKey, (prev: InferCacheKeyData<TKey> | undefined) => InferCacheKeyData<TKey>]
        : TKey extends CacheKey<infer TData>
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
      inputBody?: any;
      query: any;
      response: any;
      errors?: any;
    };
  };

  type SimplifyEndpointInput<T> = {
    [K in keyof T]: T[K];
  } & {};

  type IsNever<T> = [T] extends [never] ? true : false;
  type IsAny<T> = 0 extends 1 & T ? true : false;
  type RequiredKeys<T> = T extends object
    ? {
        [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
      }[keyof T]
    : never;

  type BodyInputProp<TValue> =
    IsNever<TValue> extends true
      ? {}
      : IsAny<TValue> extends true
        ? { body?: TValue }
        : undefined extends TValue
          ? { body?: TValue }
          : { body: TValue };

  type QueryInputProp<TValue> =
    IsNever<TValue> extends true
      ? {}
      : IsAny<TValue> extends true
        ? { query?: TValue }
        : undefined extends TValue
          ? { query?: TValue }
          : RequiredKeys<TValue> extends never
            ? { query?: TValue }
            : { query: TValue };

  type HasRequiredKeys<T> = RequiredKeys<T> extends never ? false : true;

  // Type utilities to extract endpoint input/output types
  type InferEndpointBody<T> = T extends {
    __types: {
      inputBody: infer TInputBody;
    };
  }
    ? TInputBody
    : T extends {
          __types: {
            body: infer TBody;
          };
        }
      ? TBody
      : never;

  type InferEndpointInput<T> = T extends {
    __types: {
      query: infer TQuery;
    };
  }
    ? SimplifyEndpointInput<BodyInputProp<InferEndpointBody<T>> & QueryInputProp<TQuery>>
    : {};

  type InferEndpointOutput<T> = T extends {
    __types: {
      response: infer R;
    };
  }
    ? R extends { readonly __farmStreamItem: infer TItem }
      ? FarmAPIStream<TItem>
      : R
    : any;

  type InferEndpointError<T> = T extends {
    __types: {
      errors: infer TErrors;
    };
  }
    ? keyof TErrors extends never
      ? Error
      :
          | {
              [TCode in keyof TErrors]: TErrors[TCode] extends {
                data: infer TData;
                status: infer TStatus extends number;
              }
                ? APIClientError<TCode & string, TData, TStatus>
                : never;
            }[keyof TErrors]
          | APIClientSystemError
    : Error;

  type EndpointMethod<T = any> = (<
    TUpdates extends readonly unknown[] = readonly OptimisticUpdate[],
  >(
    ...args: HasRequiredKeys<InferEndpointInput<T>> extends true
      ? [
          options: InferEndpointInput<T>,
          clientOptions?: ClientOptions<InferEndpointOutput<T>, InferEndpointError<T>, TUpdates>,
        ]
      : [
          options?: InferEndpointInput<T>,
          clientOptions?: ClientOptions<InferEndpointOutput<T>, InferEndpointError<T>, TUpdates>,
        ]
  ) => Promise<APIResult<InferEndpointOutput<T>, InferEndpointError<T>>>) &
    RouteRef<InferEndpointOutput<T>, InferEndpointInput<T>>;

  export type MutationStatus = "idle" | "pending" | "success" | "error";

  export type ServerFnActionStatus = "idle" | "pending" | "success" | "error";

  export type ServerFnSubmit<TInput, TResult> = [unknown] extends [TInput]
    ? (input?: TInput | FormData) => Promise<TResult>
    : (input: TInput | FormData) => Promise<TResult>;

  export type ServerFnOptimisticContext<TInput, TResult> = {
    input: TInput | FormData | undefined;
    formData?: FormData;
    current: TResult | null;
  };

  export type UseServerFnOptions<TResult, TError extends Error = Error, TInput = unknown> = {
    initialResult?: TResult | null;
    resetOnSubmit?: boolean;
    throwOnFormError?: boolean;
    optimistic?: (
      context: ServerFnOptimisticContext<TInput, TResult>,
    ) => TResult | null | undefined;
    rollbackOnError?: boolean;
    onSuccess?: (result: TResult) => void;
    onError?: (error: TError) => void;
    onSettled?: (result: TResult | null, error: TError | null) => void;
  };

  export type UseActionFormProps = Omit<FormHTMLAttributes<HTMLFormElement>, "action">;

  export type RouteActionTarget<TServerFn extends ServerFn<any, any, any>> = {
    readonly action: TServerFn;
  };

  export type UseActionReturn<TInput, TResult, TError extends Error = Error> = ServerFnSubmit<
    TInput,
    TResult
  > & {
    pending: boolean;
    status: ServerFnActionStatus;
    data: TResult | null;
    result: TResult | null;
    error: TError | null;
    formAction: (formData: FormData) => Promise<void>;
    Form: ComponentType<UseActionFormProps>;
    reset: () => void;
  };

  export function useAction<TInput, TResult, TError extends Error = Error>(
    route: RouteActionTarget<ServerFn<TInput, TResult, TError>>,
    options?: UseServerFnOptions<TResult, TError, TInput>,
  ): UseActionReturn<TInput, TResult, TError>;

  export function useAction<TInput, TResult, TError extends Error = Error>(
    serverFn: ServerFn<TInput, TResult, TError>,
    options?: UseServerFnOptions<TResult, TError, TInput>,
  ): UseActionReturn<TInput, TResult, TError>;

  export type AnyMutationTarget = (...args: any[]) => Promise<any>;

  export type InferMutationVariables<TTarget extends AnyMutationTarget> =
    Parameters<TTarget> extends [] ? undefined : Parameters<TTarget>[0];

  export type InferMutationData<TTarget extends AnyMutationTarget> = TTarget extends {
    readonly __farmRouteData: infer TData;
  }
    ? TData
    : Awaited<ReturnType<TTarget>>;

  export type InferMutationError<TTarget extends AnyMutationTarget> = TTarget extends (
    ...args: any[]
  ) => Promise<APIResult<any, infer TError>>
    ? TError
    : Error;

  export type MutationOptimisticContext<TVariables, TData> = {
    variables: TVariables | undefined;
    current: TData | null;
  };

  export type UseMutationOptions<TVariables, TData, TError = Error> = {
    initialData?: TData | null;
    resetOnMutate?: boolean;
    optimistic?: (
      context: MutationOptimisticContext<TVariables, TData>,
    ) => TData | null | undefined;
    rollbackOnError?: boolean;
    request?: ClientOptions<TData, TError>;
    onSuccess?: (data: TData, variables: TVariables | undefined) => void;
    onError?: (error: TError, variables: TVariables | undefined) => void;
    onSettled?: (
      data: TData | null,
      error: TError | null,
      variables: TVariables | undefined,
    ) => void;
  };

  export type MutationAsync<TTarget extends AnyMutationTarget, TData = InferMutationData<TTarget>> =
    [] extends Parameters<TTarget>
      ? (variables?: InferMutationVariables<TTarget>) => Promise<TData>
      : (variables: InferMutationVariables<TTarget>) => Promise<TData>;

  export type MutationTrigger<TTarget extends AnyMutationTarget> =
    [] extends Parameters<TTarget>
      ? (variables?: InferMutationVariables<TTarget>) => void
      : (variables: InferMutationVariables<TTarget>) => void;

  export type UseMutationReturn<
    TTarget extends AnyMutationTarget,
    TData = InferMutationData<TTarget>,
    TError = InferMutationError<TTarget>,
  > = {
    pending: boolean;
    status: MutationStatus;
    data: TData | null;
    error: TError | null;
    variables: InferMutationVariables<TTarget> | undefined;
    mutate: MutationTrigger<TTarget>;
    mutateAsync: MutationAsync<TTarget, TData>;
    reset: () => void;
  };

  export function useMutation<TTarget extends AnyMutationTarget>(
    target: TTarget,
    options?: UseMutationOptions<
      InferMutationVariables<TTarget>,
      InferMutationData<TTarget>,
      InferMutationError<TTarget>
    >,
  ): UseMutationReturn<TTarget>;

  export type FetcherState = "idle" | "submitting";

  export type FetcherFormDataContext = {
    form: HTMLFormElement | null;
    submitter: HTMLElement | null;
  };

  export type UseFetcherOptions<TTarget extends AnyMutationTarget> = UseMutationOptions<
    InferMutationVariables<TTarget>,
    InferMutationData<TTarget>,
    InferMutationError<TTarget>
  > & {
    mapFormData?: (
      formData: FormData,
      context: FetcherFormDataContext,
    ) => InferMutationVariables<TTarget>;
  };

  export type FetcherFormProps = Omit<
    FormHTMLAttributes<HTMLFormElement>,
    "action" | "onSubmit"
  > & {
    action?: string | ((formData: FormData) => void | Promise<void>);
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  };

  type FetcherInput<TTarget extends AnyMutationTarget> = InferMutationVariables<TTarget> | FormData;

  export type FetcherSubmitAsync<TTarget extends AnyMutationTarget> =
    [] extends Parameters<TTarget>
      ? (input?: FetcherInput<TTarget>) => Promise<InferMutationData<TTarget>>
      : (input: FetcherInput<TTarget>) => Promise<InferMutationData<TTarget>>;

  export type FetcherSubmit<TTarget extends AnyMutationTarget> =
    [] extends Parameters<TTarget>
      ? (input?: FetcherInput<TTarget>) => void
      : (input: FetcherInput<TTarget>) => void;

  export type UseFetcherReturn<TTarget extends AnyMutationTarget> = {
    state: FetcherState;
    status: MutationStatus;
    pending: boolean;
    data: InferMutationData<TTarget> | null;
    error: InferMutationError<TTarget> | null;
    variables: InferMutationVariables<TTarget> | undefined;
    formData: FormData | null;
    submit: FetcherSubmit<TTarget>;
    submitAsync: FetcherSubmitAsync<TTarget>;
    Form: ComponentType<FetcherFormProps>;
    reset: () => void;
  };

  export function useFetcher<TTarget extends AnyMutationTarget>(
    target: TTarget,
    options?: UseFetcherOptions<TTarget>,
  ): UseFetcherReturn<TTarget>;

  type RouterToClient<T> = {
    [K in keyof T]: T[K] extends TypedEndpointLike
      ? EndpointMethod<T[K]>
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
    | "QUERY"
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
  ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, TMethod>;

  export function defineIntegrationAPI<TAPI extends FarmIntegrationAPI>(api: TAPI): TAPI;

  type IntegrationAPIBuilderOptions<TServer extends boolean = false> = Omit<
    FarmIntegrationAPIOperation<any, any, any, TServer>,
    "kind" | "method" | "path" | "__pathless" | "__types"
  >;

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

  export const api: {
    get<TResponse = unknown, TServer extends boolean = false>(
      path: string,
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<never, never, TResponse, TServer, "GET">;
    get<TQuery = never, TResponse = unknown, TServer extends boolean = false>(
      path: string,
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer, "GET">;
    get<TResponse = unknown, TServer extends boolean = false>(
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<never, never, TResponse, TServer, "GET">;
    get<TQuery = never, TResponse = unknown, TServer extends boolean = false>(
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer, "GET">;
    route<TAPI extends FarmIntegrationAPI>(path: string, definition: TAPI): TAPI;
    route<TOperations extends readonly FarmIntegrationAPIOperation<any, any, any, any, any>[]>(
      path: string,
      ...operations: TOperations
    ): RouteOperationsToAPI<TOperations>;
    fromRoutes<TRoutes extends readonly FarmIntegrationRouteOperationCarrier<string, any>[]>(
      routes: TRoutes,
    ): RoutesToAPI<TRoutes>;
    query<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "QUERY">;
    query<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "QUERY">;
    post<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "POST">;
    post<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "POST">;
    put<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PUT">;
    put<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PUT">;
    patch<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PATCH">;
    patch<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PATCH">;
    delete<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "DELETE">;
    delete<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "DELETE">;
    options<TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer, "OPTIONS">;
    options<TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer, "OPTIONS">;
    head<TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      path: string,
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer, "HEAD">;
    head<TResponse = unknown, TQuery = never, TServer extends boolean = false>(
      options?: IntegrationAPIBuilderOptions<TServer>,
    ): FarmIntegrationAPIOperation<never, TQuery, TResponse, TServer, "HEAD">;
    form: {
      query<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        path: string,
        options?: IntegrationAPIBuilderOptions<TServer>,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "QUERY">;
      query<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        options?: IntegrationAPIBuilderOptions<TServer>,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "QUERY">;
      post<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        path: string,
        options?: IntegrationAPIBuilderOptions<TServer>,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "POST">;
      post<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        options?: IntegrationAPIBuilderOptions<TServer>,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "POST">;
      put<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        path: string,
        options?: IntegrationAPIBuilderOptions<TServer>,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PUT">;
      put<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        options?: IntegrationAPIBuilderOptions<TServer>,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PUT">;
      patch<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        path: string,
        options?: IntegrationAPIBuilderOptions<TServer>,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PATCH">;
      patch<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        options?: IntegrationAPIBuilderOptions<TServer>,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "PATCH">;
      delete<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        path: string,
        options?: IntegrationAPIBuilderOptions<TServer>,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "DELETE">;
      delete<TBody = never, TResponse = unknown, TQuery = never, TServer extends boolean = false>(
        options?: IntegrationAPIBuilderOptions<TServer>,
      ): FarmIntegrationAPIOperation<TBody, TQuery, TResponse, TServer, "DELETE">;
    };
  };

  export const endpoint: typeof api;

  /**
   * Small per-call integration metadata. When sent from a browser, values are
   * client-controlled and should be validated before authorization decisions.
   */
  export type IntegrationClientData = Record<string, unknown>;

  export interface IntegrationClientOptions {
    baseURL?: string;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
    data?: IntegrationClientData;
    isServer?: false | undefined;
  }

  interface IntegrationRequestOptionsBase {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    credentials?: RequestCredentials;
    data?: IntegrationClientData;
  }

  export interface IntegrationClientRequestOptions extends IntegrationRequestOptionsBase {}

  export type IntegrationServerRequestLike =
    | Request
    | {
        url?: string;
        headers?: HeadersInit;
      };

  export interface IntegrationServerClientOptions extends Omit<
    IntegrationClientOptions,
    "isServer"
  > {
    isServer: true;
    request?: IntegrationServerRequestLike;
    forwardHeaders?: boolean | readonly string[];
  }

  export interface IntegrationServerClientRequestOptions extends IntegrationRequestOptionsBase {
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

  export type InferIntegrationOperationBody<T> = ExtractIntegrationOperationBody<T>;
  export type InferIntegrationOperationQuery<T> = ExtractIntegrationOperationQuery<T>;
  export type InferIntegrationOperationResponse<T> = ExtractIntegrationOperationResponse<T>;

  type IsIntegrationNever<T> = [T] extends [never] ? true : false;

  type IntegrationOperationInput<T> =
    IsIntegrationNever<ExtractIntegrationOperationBody<T>> extends true
      ? IsIntegrationNever<ExtractIntegrationOperationQuery<T>> extends true
        ? {}
        : { query?: ExtractIntegrationOperationQuery<T> }
      : IsIntegrationNever<ExtractIntegrationOperationQuery<T>> extends true
        ? { body: ExtractIntegrationOperationBody<T> }
        : {
            body: ExtractIntegrationOperationBody<T>;
            query?: ExtractIntegrationOperationQuery<T>;
          };

  type IntegrationOperationMethod<T> = (
    options?: IntegrationOperationInput<T>,
    requestOptions?: IntegrationClientRequestOptions,
  ) => Promise<IntegrationOperationResult<ExtractIntegrationOperationResponse<T>>>;

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
      ? IntegrationOperationMethod<TAPI[K]>
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
      ? IntegrationOperationMethod<TAPI>
      : TAPI extends Record<string, any>
        ? [SingleClientOperationKey<TAPI>] extends [never]
          ? ClientNamespaceShape<TAPI>
          : SingleClientOperationKey<TAPI> extends keyof TAPI
            ? IntegrationOperationMethod<TAPI[SingleClientOperationKey<TAPI>]> &
                ClientNamespaceShape<TAPI>
            : ClientNamespaceShape<TAPI>
        : never;

  export type IntegrationClient<TSources extends Record<string, any>> = {
    [K in SourceKeysWithAPI<TSources>]: IntegrationAPIToClient<ExtractAPIFromSource<TSources[K]>>;
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

  type ServerOperationKeys<TAPI> = {
    [K in keyof TAPI]: TAPI[K] extends FarmIntegrationAPIOperation<any, any, any, any> ? K : never;
  }[keyof TAPI];

  type ServerNamespaceShape<TAPI> = {
    [K in keyof TAPI]: TAPI[K] extends FarmIntegrationAPIOperation<any, any, any, any>
      ? IntegrationServerOperationMethod<TAPI[K]>
      : TAPI[K] extends Record<string, any>
        ? IntegrationAPIToServerClient<TAPI[K]>
        : never;
  };

  type SingleServerOperationKey<TAPI> =
    Exclude<keyof TAPI, ServerOperationKeys<TAPI>> extends never
      ? SingleKey<ServerOperationKeys<TAPI>>
      : never;

  type IntegrationAPIToServerClient<TAPI> =
    TAPI extends FarmIntegrationAPIOperation<any, any, any, any>
      ? IntegrationServerOperationMethod<TAPI>
      : TAPI extends Record<string, any>
        ? [SingleServerOperationKey<TAPI>] extends [never]
          ? ServerNamespaceShape<TAPI>
          : SingleServerOperationKey<TAPI> extends keyof TAPI
            ? IntegrationServerOperationMethod<TAPI[SingleServerOperationKey<TAPI>]> &
                ServerNamespaceShape<TAPI>
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

  export function integrationsClient<
    TSources extends Record<string, any>,
  >(): IntegrationClientAliases<TSources>;

  export function integrationsClient<TSources extends Record<string, any>>(
    options: IntegrationClientOptions,
  ): IntegrationClientAliases<TSources>;

  export function integrationsServer<
    TSources extends Record<string, any>,
  >(): IntegrationServerClientAliases<TSources>;

  export function integrationsServer<TSources extends Record<string, any>>(
    options: Omit<IntegrationServerClientOptions, "isServer">,
  ): IntegrationServerClientAliases<TSources>;

  export function createIntegrationApi<TSources extends Record<string, any>>(
    sources: { integrations: TSources },
    options?: IntegrationClientOptions,
  ): IntegrationAPI<TSources>;

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

  export function getIntegrationAPIManifest(): Record<string, FarmIntegrationAPI>;
}
