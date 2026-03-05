/**
 * Type declarations for @farmjs/core/api
 *
 * These provide stable type definitions that don't depend on build hashes.
 */

declare module "@farmjs/core/api" {
  import type { z } from "zod";

  /**
   * HTTP methods supported by API routes
   */
  export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

  /**
   * API endpoint context
   */
  export interface EndpointContext<TBody = unknown, TQuery = unknown, TParams = unknown> {
    /** Request body (parsed) */
    body: TBody;
    /** Query parameters */
    query: TQuery;
    /** URL path parameters */
    params: TParams;
    /** Request headers */
    headers: Headers;
    /** Raw request object */
    request: Request;
  }

  /**
   * API endpoint handler
   */
  export type EndpointHandler<
    TContext extends EndpointContext = EndpointContext,
    TResponse = unknown,
  > = (ctx: TContext) => TResponse | Promise<TResponse>;

  /**
   * API endpoint configuration
   */
  export interface EndpointConfig<
    TBody = unknown,
    TQuery = unknown,
    TParams = unknown,
    TResponse = unknown,
  > {
    /** HTTP method */
    method?: HttpMethod;
    /** Request body schema (Zod) */
    body?: z.ZodType<TBody>;
    /** Query parameters schema (Zod) */
    query?: z.ZodType<TQuery>;
    /** URL parameters schema (Zod) */
    params?: z.ZodType<TParams>;
    /** Response schema (Zod) */
    response?: z.ZodType<TResponse>;
    /** Endpoint handler */
    handler: EndpointHandler<EndpointContext<TBody, TQuery, TParams>, TResponse>;
  }

  /**
   * Create an API endpoint
   */
  export function endpoint<
    TBody = unknown,
    TQuery = unknown,
    TParams = unknown,
    TResponse = unknown,
  >(
    config: EndpointConfig<TBody, TQuery, TParams, TResponse>,
  ): EndpointConfig<TBody, TQuery, TParams, TResponse>;

  /**
   * API route manager
   */
  export class APIRouteManager {
    constructor(options?: { srcDir?: string; debug?: boolean });
    discover(root: string): Promise<void>;
    getRoutes(): Map<string, unknown>;
    handle(request: Request): Promise<Response | null>;
  }

  /**
   * Farm API plugin for Vite
   */
  export function farmApiPlugin(options?: { srcDir?: string; debug?: boolean }): unknown;
}
