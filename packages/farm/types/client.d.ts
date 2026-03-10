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
  }

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

  type EndpointMethod<T = any> = (options?: InferEndpointInput<T>) => Promise<InferEndpointOutput<T>>;

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
