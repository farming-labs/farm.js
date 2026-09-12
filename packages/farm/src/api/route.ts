import {
  createEndpoint,
  type TypedEndpoint,
  type AnyEndpointMiddleware,
  type EndpointMiddlewareResult,
  type InferEndpointMiddlewareContext,
} from "./endpoint";
import {
  assertBrowserStableRoutePath,
  assertUniqueRouteParameters,
  getRoutePatternShape,
} from "../routing/specificity";
import type { RouteSchema, RouteSchemaInput, RouteSchemaOutput } from "./route-schema";

export type RouteMethod =
  | "GET"
  | "HEAD"
  | "QUERY"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";
export type RoutePathParams<Path extends string> = Path extends `${infer Head}/${infer Tail}`
  ? RoutePathParams<Head> & RoutePathParams<Tail>
  : Path extends `[[...${infer Name}]]`
    ? { [K in Name]?: string[] }
    : Path extends `[...${infer Name}]`
      ? { [K in Name]: string[] }
      : Path extends `[${infer Name}]`
        ? { [K in Name]: string }
        : {};

export interface RouteInputSchemas {
  body?: RouteSchema;
  query?: RouteSchema;
  params?: RouteSchema;
  headers?: RouteSchema;
}
type Input<I, K extends PropertyKey> = K extends keyof I ? RouteSchemaInput<I[K]> : never;
type Output<I, K extends PropertyKey, Fallback = unknown> = K extends keyof I
  ? RouteSchemaOutput<I[K]>
  : Fallback;
/** JSON responses have wire types, not server-side instances such as Date. */
export type RouteJSON<T> = T extends Response
  ? unknown
  : T extends { toJSON(): infer J }
    ? RouteJSON<J>
    : T extends bigint | symbol | ((...args: any[]) => any)
      ? never
      : T extends readonly (infer V)[]
        ? RouteJSON<V>[]
        : T extends object
          ? { [K in keyof T]: RouteJSON<T[K]> }
          : T;

export type RouteDefinition<
  P extends string = string,
  M extends RouteMethod = RouteMethod,
  E = any,
> = {
  readonly path: P;
  readonly method: M;
  readonly endpoint: E;
};

type RouteEndpoint<P extends string, I extends RouteInputSchemas, R> = TypedEndpoint<
  Output<I, "body">,
  Input<I, "query">,
  RouteJSON<R>,
  Input<I, "headers">,
  never,
  Input<I, "body">
> & {
  __types: { params: RoutePathParams<P>; inputHeaders: Input<I, "headers"> };
};

type TrimStart<P extends string> = P extends `/${infer Rest}` ? TrimStart<Rest> : P;
type Join<P extends string, C extends string> = C extends "" ? P : `${P}/${TrimStart<C>}`;
type ParamsCheck<P extends string, I extends RouteInputSchemas> = I extends { params: infer S }
  ? Exclude<keyof RoutePathParams<P>, keyof RouteSchemaOutput<S>> extends never
    ? Exclude<keyof RouteSchemaOutput<S>, keyof RoutePathParams<P>> extends never
      ? unknown
      : { __error_unknown_route_params: never }
    : { __error_missing_route_params: never }
  : unknown;

type RouteMiddlewareResults = readonly (
  | EndpointMiddlewareResult
  | Promise<EndpointMiddlewareResult>
)[];
// Infer callback results directly so inline middleware is contextually typed before
// its returned context is exposed to the route handler.
type RouteMiddlewares<Results extends readonly unknown[]> = {
  readonly [K in keyof Results]: (context: Parameters<AnyEndpointMiddleware>[0]) => Results[K];
};

export type RouteOptions<
  P extends string,
  I extends RouteInputSchemas,
  O extends RouteSchema | undefined,
  R,
  MiddlewareResults extends RouteMiddlewareResults = RouteMiddlewareResults,
> = {
  input?: I & ParamsCheck<P, I>;
  /** Validate plain JSON handler results. Raw Response/stream results are never buffered. */
  output?: O;
  middleware?: RouteMiddlewares<MiddlewareResults>;
  handler(
    request: Request,
    context: {
      input: {
        body: Output<I, "body">;
        query: Output<I, "query", Record<string, string | string[]>>;
        headers: Output<I, "headers", Record<string, string>>;
        params: Output<I, "params", RoutePathParams<P>>;
      };
      params: Output<I, "params", RoutePathParams<P>>;
      context: Readonly<InferEndpointMiddlewareContext<RouteMiddlewares<MiddlewareResults>>>;
    },
  ): R | Promise<R>;
};

type RouteBuilder<P extends string, M extends RouteMethod> = <
  const C extends string,
  const MiddlewareResults extends RouteMiddlewareResults,
  const I extends RouteInputSchemas = {},
  O extends RouteSchema | undefined = undefined,
  R = unknown,
>(
  path: C,
  options: RouteOptions<Join<P, C>, I, O, R, MiddlewareResults>,
) => RouteDefinition<
  Join<P, C>,
  M,
  RouteEndpoint<
    Join<P, C>,
    I,
    Extract<Awaited<R>, Response> extends never
      ? O extends RouteSchema
        ? RouteSchemaOutput<O>
        : Awaited<R>
      : unknown
  >
>;

export type RouteFactory<P extends string = ""> = {
  [M in Lowercase<RouteMethod>]: RouteBuilder<P, Uppercase<M> & RouteMethod>;
} & {
  /** Return a new builder; never mutate the parent scope. */
  scope<const C extends string>(path: C): RouteFactory<Join<P, C>>;
};

export type PluginRoutes = readonly RouteDefinition[];
export type PluginRoutesFactory<R extends PluginRoutes = PluginRoutes> = (context: {
  route: RouteFactory;
}) => R;

export function createRouteFactory(): RouteFactory {
  return createRouteFactoryAt("");
}

function createRouteFactoryAt(prefix: string): RouteFactory {
  const factory: Record<string, unknown> = {
    scope(child: string) {
      return createRouteFactoryAt(joinRoutePath(prefix, child));
    },
  };
  for (const method of [
    "GET",
    "HEAD",
    "QUERY",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ] as const) {
    factory[method.toLowerCase()] = (
      child: string,
      options: RouteOptions<string, any, any, any>,
    ) => {
      const path = joinRoutePath(prefix, child);
      const input = options.input ?? {};
      const endpoint = createEndpoint(
        path,
        {
          method,
          body: input.body,
          query: input.query,
          headers: input.headers,
          middleware: options.middleware,
        },
        (ctx) =>
          options.handler(ctx.request, {
            input: { body: ctx.body, query: ctx.query, headers: ctx.headers, params: ctx.params },
            params: ctx.params,
            context: ctx.context,
          }),
      ) as any;
      endpoint.__types.params = input.params;
      endpoint.__output = options.output;
      return Object.freeze({ path, method, endpoint });
    };
  }
  return Object.freeze(factory) as RouteFactory;
}

function joinRoutePath(prefix: string, child: string): string {
  if (typeof child !== "string") throw new TypeError("Route paths must be strings.");
  const path = child === "" ? prefix : `${prefix}/${child.replace(/^\//, "")}`;
  if (!(path === "/api" || path.startsWith("/api/")) || /[?#]|\/\/|\/$/.test(path)) {
    throw new TypeError(
      `Plugin route "${path}" must be a canonical /api path without a query, hash, or empty segment.`,
    );
  }
  assertBrowserStableRoutePath(path);
  assertUniqueRouteParameters(path, "api");
  getRoutePatternShape(path, "api");
  for (const segment of path.split("/")) {
    if (["__proto__", "constructor", "prototype", "$params"].includes(segment)) {
      throw new TypeError(`Route segment "${segment}" is reserved.`);
    }
  }
  return path;
}

type UnionToIntersection<U> = (U extends unknown ? (v: U) => void : never) extends (
  v: infer I,
) => void
  ? I
  : never;
type RouteTree<P extends string, M extends string, E> = P extends `${infer Head}/${infer Tail}`
  ? { [K in Head]: RouteTree<Tail, M, E> }
  : P extends ""
    ? { [K in Lowercase<M>]: E }
    : { [K in P]: { [Method in Lowercase<M>]: E } };
type HasMethodSegment<P extends string> = P extends `${infer H}/${infer T}`
  ? H extends Lowercase<RouteMethod>
    ? true
    : HasMethodSegment<T>
  : P extends Lowercase<RouteMethod>
    ? true
    : false;
type DefinitionTree<D> =
  D extends RouteDefinition<infer P, infer M, infer E>
    ? string extends P
      ? {}
      : (P extends `/api/integrations${string}` ? true : HasMethodSegment<P>) extends true
        ? { [K in P extends `/api/${infer C}` ? `/${C}` : "/"]: { [Method in Lowercase<M>]: E } }
        : RouteTree<P extends `/api/${infer C}` ? C : "", M, E>
    : {};
export type PluginAPIRouter<C> = C extends { plugins: readonly (infer P)[] }
  ? UnionToIntersection<
      P extends { routes?: PluginRoutesFactory<infer R> } ? DefinitionTree<R[number]> : {}
    >
  : {};

export function resolvePluginRoutes(
  plugins: readonly { name: string; routes?: PluginRoutesFactory }[] = [],
): PluginRoutes {
  return plugins.flatMap((plugin) => {
    if (!plugin.routes) return [];
    const routes = plugin.routes({ route: createRouteFactory() });
    if (!Array.isArray(routes))
      throw new TypeError(`Plugin "${plugin.name}" routes must return an array synchronously.`);
    for (const route of routes) {
      if (
        !route ||
        joinRoutePath("", route.path) !== route.path ||
        typeof route.endpoint !== "function" ||
        !["GET", "HEAD", "QUERY", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
          route.method,
        )
      ) {
        throw new TypeError(`Plugin "${plugin.name}" returned an invalid API route.`);
      }
    }
    return routes;
  });
}
