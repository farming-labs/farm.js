/**
 * Type declarations for @farmjs/core modules
 */

declare module '@farmjs/core/middleware' {
  export interface CookieOptions {
    maxAge?: number;
    expires?: Date;
    path?: string;
    domain?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
  }

  export interface CookieJar {
    get(name: string): string | undefined;
    set(name: string, value: string, options?: CookieOptions): void;
    delete(name: string): void;
    has(name: string): boolean;
    getAll(): Record<string, string>;
  }

  export interface MiddlewareContext {
    request: Request;
    url: URL;
    pathname: string;
    method: string;
    headers: Headers;
    cookies: CookieJar;
    params: Record<string, string>;
    searchParams: URLSearchParams;
    data: Map<string, unknown>;
    set<T>(key: string, value: T): void;
    get<T>(key: string): T | undefined;
    redirect(url: string, status?: number): Response;
    json<T>(data: T, status?: number): Response;
    text(data: string, status?: number): Response;
    html(data: string, status?: number): Response;
  }

  export type NextFunction = () => Promise<void>;

  export type MiddlewareFunction = (
    ctx: MiddlewareContext,
    next: NextFunction
  ) => Promise<void | Response> | void | Response;

  export interface MiddlewareChain {
    use(handler: MiddlewareFunction): MiddlewareChain;
    when(
      condition: (ctx: MiddlewareContext) => boolean,
      handler: MiddlewareFunction
    ): MiddlewareChain;
    rateLimit(config: RateLimitConfig): MiddlewareChain;
  }

  export interface RateLimitConfig {
    windowMs?: number;
    max?: number;
    message?: string;
    statusCode?: number;
    keyGenerator?: (ctx: MiddlewareContext) => string;
    skip?: (ctx: MiddlewareContext) => boolean;
    storage?: RateLimitStorage;
  }

  export interface RateLimitStorage {
    get(key: string): Promise<number | null>;
    set(key: string, value: number, ttlMs: number): Promise<void>;
    increment(key: string): Promise<number>;
  }

  export interface RateLimitStatus {
    limit: number;
    remaining: number;
    resetTime: number;
  }

  export function middleware(): MiddlewareChain;
  export function getRateLimitStatus(ctx: MiddlewareContext): RateLimitStatus | null;
  export function getMiddlewareData(): Map<string, unknown>;
  export function getMiddlewareValue<T>(key: string): T | undefined;
}
