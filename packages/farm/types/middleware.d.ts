/**
 * Type declarations for @farm.js/core/middleware
 *
 * These provide stable type definitions that don't depend on build hashes.
 */

declare module "@farm.js/core/middleware" {
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

  type MiddlewareStoreKey<TValues extends Record<string, any>> = Extract<keyof TValues, string>;

  export interface ReadonlyMiddlewareStore<
    TValues extends Record<string, any> = Record<string, any>,
  > {
    readonly size: number;
    get<TKey extends MiddlewareStoreKey<TValues>>(key: TKey): TValues[TKey] | undefined;
    has<TKey extends MiddlewareStoreKey<TValues>>(key: TKey): boolean;
    entries(): IterableIterator<
      [MiddlewareStoreKey<TValues>, TValues[MiddlewareStoreKey<TValues>]]
    >;
    keys(): IterableIterator<MiddlewareStoreKey<TValues>>;
    values(): IterableIterator<TValues[MiddlewareStoreKey<TValues>]>;
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
    /** Server-only request context shared with Server Components */
    locals: Map<string, unknown>;
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
    json(data: unknown, status?: number): void;
    text(content: string, status?: number): void;
    html(content: string, status?: number): void;
  }

  export type RequestMiddleware<
    TLocals extends Record<string, any> = Record<string, any>,
    TData extends Record<string, any> = Record<string, any>,
  > = (
    request: Request,
    context: RequestMiddlewareContext<TLocals, TData>,
  ) => void | Response | Promise<void | Response>;

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
  export function getMiddlewareData<T extends Record<string, any> = Record<string, any>>(): Map<
    keyof T,
    T[keyof T]
  >;

  /** Get server-only middleware context for the current request. */
  export function getMiddlewareContext<
    T extends Record<string, any> = Record<string, any>,
  >(): ReadonlyMiddlewareStore<T>;

  /**
   * Get middleware value (alias for getMiddlewareData)
   */
  export function getMiddlewareValue<T = unknown>(key: string): T | undefined;

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
