/**
 * Type declarations for @farm.js/core/api
 *
 * These provide stable type definitions that don't depend on build hashes.
 */

declare module "@farm.js/core/api" {
  import type { z } from "zod";

  /**
   * HTTP methods supported by API routes
   */
  export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

  export type MultipartField = string | number | boolean | bigint | Blob | Date | null | undefined;

  export type MultipartValues = Record<string, MultipartField | readonly MultipartField[]>;

  export type TypedFormData<TValues> = FormData & {
    readonly __farmMultipartInput: TValues;
  };

  export type MultipartSchema<TSchema> = TSchema & {
    readonly __farmMultipartSchema: true;
  };

  export type FarmStreamResponse<TItem> = Response & {
    readonly __farmStreamItem: TItem;
  };

  export interface FarmAPIStream<TItem> extends AsyncIterable<TItem> {
    readonly response: Response;
    cancel(reason?: unknown): Promise<void>;
  }

  export function multipart<TSchema extends { parse(data: unknown): unknown }>(
    schema: TSchema,
  ): MultipartSchema<TSchema>;

  export function isMultipartSchema(
    value: unknown,
  ): value is MultipartSchema<{ parse(data: unknown): unknown }>;

  export function toFormData<TValues extends MultipartValues>(
    values: TValues,
  ): TypedFormData<TValues>;

  export function jsonStream<TItem>(
    source: AsyncIterable<TItem> | Iterable<TItem>,
    init?: ResponseInit,
  ): FarmStreamResponse<TItem>;

  export function isJSONStreamResponse(response: {
    headers?: Pick<Headers, "get"> | null;
  }): boolean;
  export function readJSONStream<TItem>(response: Response): FarmAPIStream<TItem>;
  export function isFarmAPIStream(value: unknown): value is FarmAPIStream<unknown>;

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
