import type { APIRouteParams } from "./route-pattern";
import { API_ROUTE_METHODS } from "./runtime";

type MaybePromise<T> = T | Promise<T>;

/** A Web `fetch` handler: a function, or an app such as Hono or Elysia that exposes `fetch`. */
export type MountableFetchHandler =
  | ((request: Request) => MaybePromise<Response>)
  | { fetch(request: Request): MaybePromise<Response> };

export interface MountFetchHandlerOptions {
  /**
   * Give the mounted app the path below the route's catch-all segment instead of the full request
   * path, so its routes do not repeat where Farm serves them. `/api/hono/[...path]` hands
   * `/api/hono/users/1` to the app as `/users/1`. Paths the app builds itself, such as redirect
   * locations, are then relative to the mount rather than to the site.
   *
   * @default false
   */
  stripMountPath?: boolean;
}

/** A plain route export, called with the Web `Request` and the route's params. */
export type MountedFetchRouteHandler = (
  request: Request,
  context?: { params?: MaybePromise<APIRouteParams> },
) => Promise<Response>;

export type MountedFetchRouteHandlers = Record<
  (typeof API_ROUTE_METHODS)[number],
  MountedFetchRouteHandler
>;

/**
 * Mount a Web `fetch` handler, such as a Hono or Elysia app, on an API route. Export the methods
 * the app handles from the returned handlers:
 *
 * ```ts
 * export const { GET, POST, PUT, PATCH, DELETE } = mountFetchHandler(app);
 * ```
 *
 * A method left out still answers `405` before the app sees it, and leaving out `HEAD` keeps
 * Farm answering it from `GET`.
 */
export function mountFetchHandler(
  app: MountableFetchHandler,
  options: MountFetchHandlerOptions = {},
): MountedFetchRouteHandlers {
  const fetchHandler = typeof app === "function" ? app : (request: Request) => app.fetch(request);
  const handle: MountedFetchRouteHandler = async (request, context) =>
    fetchHandler(
      options.stripMountPath ? await stripMountPath(request, await context?.params) : request,
    );

  return Object.fromEntries(
    API_ROUTE_METHODS.map((method) => [method, handle]),
  ) as MountedFetchRouteHandlers;
}

/**
 * Keep only the request path segments the route's catch-all matched. The raw segments are kept as
 * the client sent them, so the app decodes them exactly as it would unmounted.
 */
async function stripMountPath(
  request: Request,
  params: APIRouteParams | undefined,
): Promise<Request> {
  const rest = params ? Object.values(params).find((value) => Array.isArray(value)) : undefined;
  const url = new URL(request.url);
  const trailingSlash = url.pathname.length > 1 && url.pathname.endsWith("/");
  const segments = url.pathname.split("/").slice(1);
  if (trailingSlash) segments.pop();
  const kept = rest?.length ? segments.slice(-rest.length) : [];
  url.pathname = `/${kept.join("/")}${trailingSlash && kept.length > 0 ? "/" : ""}`;
  return new Request(url, request);
}
