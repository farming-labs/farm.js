/**
 * Type declarations for @farmjs/core/client
 *
 * Provides stable exports for Link, useRouter, and API client so TypeScript
 * and IDEs resolve them even when the build output omits them. The generated
 * farm-routes.d.ts in your app augments LinkDefaultRoute for typed href.
 */

import type { AnchorHTMLAttributes, ForwardRefExoticComponent, RefAttributes } from "react";

declare module "@farmjs/core/client" {
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

  export interface LinkProps<TRoute extends string = DefaultRoutePath> extends Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "href"
  > {
    /** Internal route path (typed when route types are generated) or external URL (never raises route-type errors). */
    href: TRoute | ExternalHref;
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

  export type OptimisticOptions<
    TUpdates extends readonly unknown[] = readonly OptimisticUpdate[],
  > = {
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
    onResponse?: (data: TData | undefined, error: TError | null, event: ResponseEvent<TData, TError>) => void;
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

  export type { APIClientOptions };
}
