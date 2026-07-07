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
export type NextFunction = () => Promise<void>;

/**
 * Middleware function signature
 */
export type MiddlewareFunction = (
  ctx: MiddlewareContext,
  next: NextFunction,
) => void | Promise<void>;

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

export interface RateLimitStorage {
  get(key: string): Promise<any> | any;
  set(key: string, value: any, ttl?: number): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  ttl?(key: string): Promise<number | null> | number | null;
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
  default: MiddlewareChain | MiddlewareFunction;
  config?: MiddlewareConfig;
}
