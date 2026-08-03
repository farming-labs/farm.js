/**
 * Farm.js Middleware System
 *
 * Type definitions for the middleware system
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { ViteDevServer } from "vite";

/**
 * Next function type for middleware chain
 */
export type MiddlewareResult = void | Response;
export type NextFunction = () => Promise<MiddlewareResult>;

type MiddlewareStoreKey<TValues extends Record<string, any>> = Extract<keyof TValues, string>;

/**
 * A typed view over the request-scoped maps used by middleware.
 */
export interface ReadonlyMiddlewareStore<
  TValues extends Record<string, any> = Record<string, any>,
> {
  readonly size: number;
  get<TKey extends MiddlewareStoreKey<TValues>>(key: TKey): TValues[TKey] | undefined;
  has<TKey extends MiddlewareStoreKey<TValues>>(key: TKey): boolean;
  entries(): IterableIterator<[MiddlewareStoreKey<TValues>, TValues[MiddlewareStoreKey<TValues>]]>;
  keys(): IterableIterator<MiddlewareStoreKey<TValues>>;
  values(): IterableIterator<TValues[MiddlewareStoreKey<TValues>]>;
  forEach(
    callback: (
      value: TValues[MiddlewareStoreKey<TValues>],
      key: MiddlewareStoreKey<TValues>,
      store: ReadonlyMiddlewareStore<TValues>,
    ) => void,
    thisArg?: any,
  ): void;
  [Symbol.iterator](): IterableIterator<
    [MiddlewareStoreKey<TValues>, TValues[MiddlewareStoreKey<TValues>]]
  >;
}

export interface MiddlewareStore<
  TValues extends Record<string, any> = Record<string, any>,
> extends ReadonlyMiddlewareStore<TValues> {
  clear(): void;
  delete<TKey extends MiddlewareStoreKey<TValues>>(key: TKey): boolean;
  set<TKey extends MiddlewareStoreKey<TValues>>(key: TKey, value: TValues[TKey]): this;
}

/**
 * Middleware function signature
 */
export type MiddlewareFunction = (
  ctx: MiddlewareContext,
  next: NextFunction,
) => MiddlewareResult | Promise<MiddlewareResult>;

/**
 * Context passed to a named, request-first middleware export.
 * `locals` and the get/set helpers stay on the server. `data` can be exposed
 * through page props and should contain only serializable, client-safe values.
 */
export interface RequestMiddlewareContext<
  TLocals extends Record<string, any> = Record<string, any>,
  TData extends Record<string, any> = Record<string, any>,
> {
  readonly url: URL;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly method: string;
  readonly params: Record<string, string>;
  readonly route: string;
  readonly locals: MiddlewareStore<TLocals>;
  readonly data: MiddlewareStore<TData>;
  readonly headers: Map<string, string>;
  readonly cookies: CookieJar;
  get<TKey extends MiddlewareStoreKey<TLocals>>(key: TKey): TLocals[TKey] | undefined;
  has<TKey extends MiddlewareStoreKey<TLocals>>(key: TKey): boolean;
  set<TKey extends MiddlewareStoreKey<TLocals>>(key: TKey, value: TLocals[TKey]): void;
  delete<TKey extends MiddlewareStoreKey<TLocals>>(key: TKey): boolean;
  redirect(url: string, status?: number): void;
  rewrite(url: string): void;
  json(data: any, status?: number): void;
  text(content: string, status?: number): void;
  html(content: string, status?: number): void;
}

export type RequestMiddleware<
  TLocals extends Record<string, any> = Record<string, any>,
  TData extends Record<string, any> = Record<string, any>,
> = (
  request: Request,
  context: RequestMiddlewareContext<TLocals, TData>,
) => MiddlewareResult | Promise<MiddlewareResult>;

/**
 * Cookie options
 */
export interface CookieOptions {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "strict" | "lax" | "none";
}

/**
 * Cookie management interface
 */
export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, options?: CookieOptions): void;
  delete(name: string): void;
  getAll(): Record<string, string>;
}

export interface RateLimitIncrementResult {
  count: number;
  /** Unix epoch timestamp in milliseconds when the fixed window resets. */
  resetAt: number;
}

export interface RateLimitStorage {
  /** Atomically increment a key and create or retain its fixed expiry window. */
  increment(
    key: string,
    windowMs: number,
  ): Promise<RateLimitIncrementResult> | RateLimitIncrementResult;
  /** Optional inspection support used by getRateLimitStatus(). */
  get?(key: string): Promise<RateLimitIncrementResult | null> | RateLimitIncrementResult | null;
}

export interface MemoryRateLimitStorageOptions {
  /** Maximum number of active keys retained by this process. */
  maxEntries?: number;
}

export interface RateLimitConfig {
  requests: number;
  window: string;
  keyGenerator?: (ctx: MiddlewareContext) => string;
  onLimit?: (ctx: MiddlewareContext) => void | Response | Promise<void | Response>;
  storage?: RateLimitStorage;
}

export interface RateLimitStatus {
  requests: number;
  limit: number;
  remaining: number;
  resetIn: number | null;
  resetAt: Date | null;
  isLimited: boolean;
}

/**
 * Middleware configuration
 */
export type MiddlewareMatcher = string | RegExp | ((ctx: MiddlewareContext) => boolean);

export interface MiddlewareConfig {
  matcher?: MiddlewareMatcher | MiddlewareMatcher[];
  exclude?: (string | RegExp)[];
  runtime?: "nodejs" | "edge";
}

export interface MiddlewareConfigEntry extends MiddlewareConfig {
  handler?: MiddlewareFunction;
  handlers?: MiddlewareFunction[];
}

export type FarmMiddlewareConfig =
  | MiddlewareConfig
  | MiddlewareConfigEntry
  | MiddlewareConfigEntry[];

/**
 * Middleware context - the main object passed to middleware functions
 */
export interface MiddlewareContext {
  // Core request/response
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  pathname: string;
  searchParams: URLSearchParams;
  method: string;

  // Route information
  params: Record<string, string>;
  route: string;

  // Parent middleware data (for cascading)
  parent?: {
    data: Map<string, any>;
    locals?: Map<string, any>;
    headers: Record<string, string>;
  };

  // Vite integration
  vite: {
    isDev: boolean;
    hmr: boolean;
    server?: ViteDevServer;
  };

  // Data storage between middleware and pages
  data: Map<string, any>;

  // Server-only request context shared with nested middleware and components
  locals: Map<string, any>;

  // Helpers
  headers: Map<string, string>;
  cookies: CookieJar;

  // Response state
  _handled: boolean;
  _redirectUrl?: string;
  _rewriteUrl?: string;

  // Actions
  redirect(url: string, status?: number): void;
  rewrite(url: string): void;
  json(data: any, status?: number): void;
  text(content: string, status?: number): void;
  html(content: string, status?: number): void;
}

/**
 * Middleware chain interface
 */
export interface MiddlewareChain {
  use(fn: MiddlewareFunction): MiddlewareChain;
  /**
   * Conditionally run middleware based on a condition.
   * Supports boolean values or functions that evaluate to boolean.
   *
   * @example
   * .when(true, (ctx, next) => { ... })  // Always run
   * .when((ctx) => ctx.data.get('flag'), (ctx, next) => { ... })  // Conditional
   */
  when(
    condition: boolean | ((ctx: MiddlewareContext) => boolean),
    fn: MiddlewareFunction | ((chain: MiddlewareChain) => void),
  ): MiddlewareChain;
  rateLimit(config: RateLimitConfig): MiddlewareChain;
  redirect(source: string, destination: string, permanent?: boolean): MiddlewareChain;
  /**
   * Rewrite the current route to a new destination.
   * In route-specific middleware, this rewrites the middleware's route.
   *
   * @param destination - The destination path to rewrite to
   * @param condition - Optional boolean or function that evaluates to boolean. If false, rewrite is skipped.
   *
   * @example
   * // In /contact/middleware.ts
   * .rewrite('/about')  // Always rewrites /contact to /about
   * .rewrite('/about', true)  // Always rewrites
   * .rewrite('/about', false)  // Never rewrites
   * .rewrite('/about', (ctx) => ctx.data.get('shouldRewrite'))  // Conditional rewrite
   */
  rewrite(
    destination: string,
    condition?: boolean | ((ctx: MiddlewareContext) => boolean),
  ): MiddlewareChain;
  build(): {
    handlers: MiddlewareFunction[];
    config?: MiddlewareConfig;
  };
}

/**
 * Middleware module export
 */
export interface MiddlewareModule {
  default?: MiddlewareChain | MiddlewareFunction;
  middleware?: RequestMiddleware;
  config?: MiddlewareConfig;
}
