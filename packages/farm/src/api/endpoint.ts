import { createEndpoint as betterCallEndpoint } from "better-call";

// Generic schema type that works with both Zod v3 and v4
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = { _output?: any; _input?: any; parse?: (data: unknown) => any } | any;

// Infer output type from schema (works with Zod v3 and v4)
type InferOutput<T> = T extends { _output: infer O }
  ? O
  : T extends { parse: (data: unknown) => infer R }
    ? R
    : unknown;

export type EndpointOptions<
  TBody extends AnySchema = any,
  TQuery extends AnySchema = any,
  THeaders extends AnySchema = any,
> = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";
  body?: TBody;
  query?: TQuery;
  headers?: THeaders;
  use?: any[];
};

export type EndpointHandler<
  TBody extends AnySchema = any,
  TQuery extends AnySchema = any,
  THeaders extends AnySchema = any,
  TResponse = any,
> = (ctx: {
  body: InferOutput<TBody>;
  query: InferOutput<TQuery>;
  headers: THeaders extends AnySchema ? InferOutput<THeaders> : Record<string, string>;
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
  __path?: string;
  __method?: string;
} & ((options?: { body?: TBody; query?: TQuery }) => Promise<TResponse>);

/**
 * Create a Farm.js API endpoint
 *
 * Supports two patterns:
 * 1. File-based routing (path auto-inferred from file location):
 *    `createEndpoint({ method: 'GET', query: z.object({...}) }, handler)`
 *
 * 2. Explicit path (for routes.ts at project root):
 *    `createEndpoint('/api/hello', { method: 'GET', query: z.object({...}) }, handler)`
 */
export function createEndpoint<
  TBody extends AnySchema = any,
  TQuery extends AnySchema = any,
  THeaders extends AnySchema = any,
  TResponse = any,
>(
  pathOrOptions: string | EndpointOptions<TBody, TQuery, THeaders>,
  optionsOrHandler:
    | EndpointOptions<TBody, TQuery, THeaders>
    | EndpointHandler<TBody, TQuery, THeaders, TResponse>,
  maybeHandler?: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): TypedEndpoint<InferOutput<TBody>, InferOutput<TQuery>, TResponse> {
  // Determine if first arg is path or options
  let path: string;
  let options: EndpointOptions<TBody, TQuery, THeaders>;
  let handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>;

  if (typeof pathOrOptions === "string") {
    // createEndpoint('/path', options, handler)
    path = pathOrOptions;
    options = optionsOrHandler as EndpointOptions<TBody, TQuery, THeaders>;
    handler = maybeHandler as EndpointHandler<TBody, TQuery, THeaders, TResponse>;
  } else {
    // createEndpoint(options, handler) - path will be set by API plugin from file location
    path = "";
    options = pathOrOptions;
    handler = optionsOrHandler as EndpointHandler<TBody, TQuery, THeaders, TResponse>;
  }

  // Create the endpoint - path will be set later by API plugin if not provided
  // We use a temporary path that will be replaced when the router is created
  const endpoint = betterCallEndpoint(
    path || "/__farm_auto_path__",
    options as any,
    handler as any,
  ) as any;

  // Store the path and type information on the endpoint for later access
  // Empty/undefined path means it will be inferred from file location by the API plugin
  endpoint.__path = path || undefined;
  endpoint.__method = options.method || "GET";
  endpoint.__autoPath = !path; // Flag to indicate path should be auto-inferred
  endpoint.__handler = handler; // Store original handler for direct invocation

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
  TQuery extends AnySchema = any,
  THeaders extends AnySchema = any,
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
  TBody extends AnySchema = any,
  TQuery extends AnySchema = any,
  THeaders extends AnySchema = any,
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
  TBody extends AnySchema = any,
  TQuery extends AnySchema = any,
  THeaders extends AnySchema = any,
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
  TBody extends AnySchema = any,
  TQuery extends AnySchema = any,
  THeaders extends AnySchema = any,
  TResponse = any,
>(
  options: Omit<EndpointOptions<TBody, TQuery, THeaders>, "method">,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
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
  TBody extends AnySchema = any,
  TQuery extends AnySchema = any,
  THeaders extends AnySchema = any,
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
