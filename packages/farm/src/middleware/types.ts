/**
 * Farm.js Middleware System
 * 
 * Type definitions for the middleware system
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { ViteDevServer } from 'vite';
import type { FarmConfig } from '../types';

/**
 * Middleware function signature
 */
export type MiddlewareFunction = (
  ctx: MiddlewareContext,
  next: () => Promise<void>
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
  sameSite?: 'strict' | 'lax' | 'none';
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

/**
 * Storage interface for rate limiter
 * Allows custom storage implementations (Redis, Upstash, KV, etc.)
 */
export interface RateLimitStorage {
  /**
   * Get a value by key
   * @returns The stored value or null/undefined if not found
   */
  get(key: string): Promise<any> | any;
  
  /**
   * Set a value with optional TTL (in seconds)
   */
  set(key: string, value: any, ttl?: number): Promise<void> | void;
  
  /**
   * Delete a value by key
   */
  delete(key: string): Promise<void> | void;
  
  /**
   * Get the remaining TTL for a key (in seconds)
   * @returns The TTL in seconds, or null if key doesn't exist or has no expiration
   */
  ttl?(key: string): Promise<number | null> | number | null;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  requests: number;
  window: string; // e.g., '1m', '1h', '1d'
  keyGenerator?: (ctx: MiddlewareContext) => string;
  onLimit?: (ctx: MiddlewareContext) => void | Response | Promise<void | Response>;
  storage?: RateLimitStorage; // Custom storage implementation
}

/**
 * Middleware configuration
 */
export interface MiddlewareConfig {
  matcher?: (string | RegExp | ((ctx: MiddlewareContext) => boolean))[];
  exclude?: (string | RegExp)[];
  runtime?: 'nodejs' | 'edge';
}

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
  when(
    condition: string | boolean | ((ctx: MiddlewareContext) => boolean),
    fn: MiddlewareFunction | ((chain: MiddlewareChain) => void)
  ): MiddlewareChain;
  rateLimit(config: RateLimitConfig): MiddlewareChain;
  redirect(source: string, destination: string, permanent?: boolean): MiddlewareChain;
  rewrite(source: string, destination: string): MiddlewareChain;
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

