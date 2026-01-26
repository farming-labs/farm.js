import { createEndpoint as betterCallEndpoint } from "better-call";
import type { z } from "zod";

export type EndpointOptions<
  TBody extends z.ZodType = any,
  TQuery extends z.ZodType = any,
  THeaders extends z.ZodType = any,
> = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";
  body?: TBody;
  query?: TQuery;
  headers?: THeaders;
  use?: any[];
};

export type EndpointHandler<
  TBody extends z.ZodType = any,
  TQuery extends z.ZodType = any,
  THeaders extends z.ZodType = any,
  TResponse = any,
> = (ctx: {
  body: TBody extends z.ZodType ? z.infer<TBody> : never;
  query: TQuery extends z.ZodType ? z.infer<TQuery> : never;
  headers: THeaders extends z.ZodType ? z.infer<THeaders> : Record<string, string>;
  request: Request;
  context: any;
  params: Record<string, string>;
}) => Promise<TResponse> | TResponse;

// Type to represent an endpoint with its input/output types
export type TypedEndpoint<TBody = never, TQuery = never, TResponse = any> = {
  __types: {
    body: TBody;
    query: TQuery;
    response: TResponse;
  };
} & ((options?: { body?: TBody; query?: TQuery }) => Promise<TResponse>);

/**
 * Create a Farm.js API endpoint
 * This wraps better-call's createEndpoint with Farm.js conventions
 */
export function createEndpoint<
  TBody extends z.ZodType = any,
  TQuery extends z.ZodType = any,
  THeaders extends z.ZodType = any,
  TResponse = any,
>(
  path: string,
  options: EndpointOptions<TBody, TQuery, THeaders>,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): TypedEndpoint<
  TBody extends z.ZodType ? z.infer<TBody> : never,
  TQuery extends z.ZodType ? z.infer<TQuery> : never,
  TResponse
> {
  // Create the endpoint with the path
  const endpoint = betterCallEndpoint(path, options as any, handler as any) as any;

  // Store the path and type information on the endpoint for later access
  endpoint.__path = path;
  endpoint.__method = options.method || "GET";

  // Store type information for inference
  endpoint.__types = {
    body: options.body,
    query: options.query,
    response: null as any,
  };

  return endpoint as any;
}

/**
 * Convenience method for GET requests
 */
export function GET<T = any>(
  handler: EndpointHandler<any, any, any, T>,
): ReturnType<typeof createEndpoint>;
export function GET<
  TQuery extends z.ZodType = any,
  THeaders extends z.ZodType = any,
  TResponse = any,
>(
  options: Omit<EndpointOptions<any, TQuery, THeaders>, "method">,
  handler: EndpointHandler<any, TQuery, THeaders, TResponse>,
): ReturnType<typeof createEndpoint>;
export function GET(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "GET" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "GET" }, args[1]);
}

/**
 * Convenience method for POST requests
 */
export function POST<T = any>(
  handler: EndpointHandler<any, any, any, T>,
): ReturnType<typeof createEndpoint>;
export function POST<
  TBody extends z.ZodType = any,
  TQuery extends z.ZodType = any,
  THeaders extends z.ZodType = any,
  TResponse = any,
>(
  options: Omit<EndpointOptions<TBody, TQuery, THeaders>, "method">,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): ReturnType<typeof createEndpoint>;
export function POST(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "POST" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "POST" }, args[1]);
}

/**
 * Convenience method for PUT requests
 */
export function PUT<T = any>(
  handler: EndpointHandler<any, any, any, T>,
): ReturnType<typeof createEndpoint>;
export function PUT<
  TBody extends z.ZodType = any,
  TQuery extends z.ZodType = any,
  THeaders extends z.ZodType = any,
  TResponse = any,
>(
  options: Omit<EndpointOptions<TBody, TQuery, THeaders>, "method">,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): ReturnType<typeof createEndpoint>;
export function PUT(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "PUT" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "PUT" }, args[1]);
}

/**
 * Convenience method for DELETE requests
 */
export function DELETE<T = any>(
  handler: EndpointHandler<any, any, any, T>,
): ReturnType<typeof createEndpoint>;
export function DELETE<
  TQuery extends z.ZodType = any,
  THeaders extends z.ZodType = any,
  TResponse = any,
>(
  options: Omit<EndpointOptions<any, TQuery, THeaders>, "method">,
  handler: EndpointHandler<any, TQuery, THeaders, TResponse>,
): ReturnType<typeof createEndpoint>;
export function DELETE(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "DELETE" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "DELETE" }, args[1]);
}

/**
 * Convenience method for PATCH requests
 */
export function PATCH<T = any>(
  handler: EndpointHandler<any, any, any, T>,
): ReturnType<typeof createEndpoint>;
export function PATCH<
  TBody extends z.ZodType = any,
  TQuery extends z.ZodType = any,
  THeaders extends z.ZodType = any,
  TResponse = any,
>(
  options: Omit<EndpointOptions<TBody, TQuery, THeaders>, "method">,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): ReturnType<typeof createEndpoint>;
export function PATCH(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "PATCH" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "PATCH" }, args[1]);
}
