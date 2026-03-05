/**
 * Type declarations for @farmjs/core/middleware
 *
 * These provide stable type definitions that don't depend on build hashes.
 */

declare module "@farmjs/core/middleware" {
  /**
   * Next function to call the next middleware in the chain
   */
  export type NextFunction = () => Promise<void>;

  /**
   * Cookie options for setting cookies
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
   * Cookie jar for reading and writing cookies
   */
  export interface CookieJar {
    get(name: string): string | undefined;
    set(name: string, value: string, options?: CookieOptions): void;
    delete(name: string): void;
    has(name: string): boolean;
    getAll(): Record<string, string>;
  }

  /**
   * Middleware context passed to each middleware function
   */
  export interface MiddlewareContext {
    /** Request pathname */
    pathname: string;
    /** Request URL */
    url: string;
    /** HTTP method (GET, POST, etc.) */
    method: string;
    /** Request headers */
    headers: Headers;
    /** Cookie jar for reading/writing cookies */
    cookies: CookieJar;
    /** Key-value data store for passing data between middleware */
    data: Map<string, unknown>;
    /** Set a response to short-circuit the middleware chain */
    _response?: Response;
    /** Send a response and stop middleware chain */
    respond(response: Response): void;
    /** Redirect to a URL */
    redirect(url: string, status?: number): void;
    /** Send JSON response */
    json(data: unknown, status?: number): void;
    /** Send text response */
    text(content: string, status?: number): void;
  }

  /**
   * Middleware function signature
   */
  export type MiddlewareFunction = (
    ctx: MiddlewareContext,
    next: NextFunction,
  ) => void | Promise<void>;

  /**
   * Rate limit configuration
   */
  export interface RateLimitConfig {
    /** Maximum number of requests */
    max: number;
    /** Time window in milliseconds */
    windowMs: number;
    /** Optional custom key generator */
    keyGenerator?: (ctx: MiddlewareContext) => string;
    /** Optional custom storage */
    storage?: RateLimitStorage;
  }

  /**
   * Rate limit storage interface
   */
  export interface RateLimitStorage {
    get(key: string): Promise<number | undefined>;
    set(key: string, value: number, ttlMs: number): Promise<void>;
    increment(key: string): Promise<number>;
  }

  /**
   * Rate limit status
   */
  export interface RateLimitStatus {
    remaining: number;
    reset: number;
    total: number;
  }

  /**
   * Middleware chain configuration
   */
  export interface MiddlewareConfig {
    basePath?: string;
  }

  /**
   * Middleware chain for composing middleware
   */
  export interface MiddlewareChain {
    /**
     * Add a middleware function to the chain
     */
    use(handler: MiddlewareFunction): MiddlewareChain;

    /**
     * Conditionally run middleware when the predicate returns true
     */
    when(
      predicate: (ctx: MiddlewareContext) => boolean,
      handler: MiddlewareFunction,
    ): MiddlewareChain;

    /**
     * Add rate limiting middleware
     */
    rateLimit(config: RateLimitConfig): MiddlewareChain;

    /**
     * Set the base path for this middleware chain
     */
    setBasePath(path: string): void;

    /**
     * Build the middleware chain into executable form
     */
    build(): { handlers: MiddlewareFunction[] };
  }

  /**
   * Create a new middleware chain
   */
  export function middleware(config?: MiddlewareConfig): MiddlewareChain;

  /**
   * Get rate limit status for current request
   */
  export function getRateLimitStatus(ctx: MiddlewareContext): RateLimitStatus | undefined;

  /**
   * Create a middleware context from request/response
   */
  export function createContext(req: unknown, res: unknown, server?: unknown): MiddlewareContext;

  /**
   * Get middleware data from context
   */
  export function getMiddlewareData<T = unknown>(
    ctx: MiddlewareContext,
    key: string,
  ): T | undefined;

  /**
   * Get middleware value (alias for getMiddlewareData)
   */
  export function getMiddlewareValue<T = unknown>(
    ctx: MiddlewareContext,
    key: string,
  ): T | undefined;

  /**
   * Get data from middleware context
   */
  export function getFromMiddleware<T = unknown>(
    ctx: MiddlewareContext,
    key: string,
  ): T | undefined;

  /**
   * Check if middleware has data for a key
   */
  export function hasMiddlewareData(ctx: MiddlewareContext, key: string): boolean;

  /**
   * Unwrap middleware chain to get handlers
   */
  export function unwrapMiddleware(chain: MiddlewareChain): MiddlewareFunction[];

  /**
   * Middleware manager for plugin
   */
  export class MiddlewareManager {
    constructor(options?: { srcDir?: string; debug?: boolean });
    discover(root: string): Promise<void>;
    getMiddleware(path: string): MiddlewareChain | undefined;
    execute(ctx: MiddlewareContext): Promise<boolean>;
  }
}
