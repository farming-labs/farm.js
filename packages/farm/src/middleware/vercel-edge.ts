/**
 * Runs `runtime: "edge"` middleware files as Vercel routing middleware, in front of the static
 * files `farm build` prerendered for the paths they guard. It reuses the production middleware
 * runner, so a guard decides here exactly as it does in the server, and answers in Vercel's
 * middleware protocol: `x-middleware-next` lets Vercel serve the static page, `x-middleware-rewrite`
 * routes a `ctx.rewrite()`, and a response the middleware returned is sent as it is.
 */
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import type { ResolvedFarmServerConfig } from "../server-http";
import {
  createProductionMiddlewareRunner,
  type ProductionMiddlewareModuleEntry,
} from "./production-runtime";

export interface FarmVercelEdgeMiddlewareOptions {
  /** The `runtime: "edge"` middleware files, root first, as the server registers them. */
  modules: ProductionMiddlewareModuleEntry[];
  i18n?: ResolvedFarmI18nConfig;
  server?: Pick<ResolvedFarmServerConfig, "trustProxy">;
  apiBasePath?: string;
  /**
   * A path no route answers, under the app's basePath. A middleware that calls `notFound()` is
   * answered from the server by rewriting here, so the app's own not-found page renders with a
   * 404, as it does when the server runs the middleware.
   */
  notFoundPath: string;
  /**
   * The URL of each page these middleware files guard, as the edge route lists them. Vercel serves
   * a page's static file at `/index.html` and `.html` beside the page URL, so a request for one of
   * those is decided as a request for the page: a matcher written for `/dashboard` must not miss
   * `/dashboard/index.html`.
   */
  pages?: readonly string[];
}

const NEXT_HEADER = "x-middleware-next";
const REWRITE_HEADER = "x-middleware-rewrite";

const trimTrailingSlashes = (pathname: string) => pathname.replace(/\/+$/, "") || "/";

/** The guarded page a request URL serves the static file of, if it names one by file. */
function toGuardedPagePathname(pathname: string, pages: ReadonlySet<string>): string | undefined {
  let page: string | undefined;
  if (pathname.endsWith("/index.html")) page = pathname.slice(0, -"/index.html".length);
  else if (pathname.endsWith(".html")) page = pathname.slice(0, -".html".length);
  if (page === undefined) return undefined;
  page = trimTrailingSlashes(page);
  return pages.has(page) ? page : undefined;
}

/** The same request, for the page URL instead of its static file name. */
function requestForPage(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: request.redirect,
    signal: request.signal,
    // Required by the Request constructor whenever the body is a stream.
    ...(request.body ? { duplex: "half" } : {}),
  } as RequestInit);
}

/** @internal */
export function createFarmVercelEdgeMiddleware(
  options: FarmVercelEdgeMiddlewareOptions,
): (request: Request) => Promise<Response> {
  const runMiddleware = createProductionMiddlewareRunner({
    modules: options.modules,
    i18n: options.i18n,
    server: options.server,
    apiBasePath: options.apiBasePath,
  });

  const pages = new Set((options.pages ?? []).map(trimTrailingSlashes));

  return async function farmVercelEdgeMiddleware(request: Request): Promise<Response> {
    const page = toGuardedPagePathname(new URL(request.url).pathname, pages);
    const guardedRequest = page ? requestForPage(request, page) : request;
    let result: Awaited<ReturnType<typeof runMiddleware>>;
    try {
      // Vercel sets x-real-ip to the address that opened the connection, which the server
      // adapter reports as the client address; a trusted proxy's x-forwarded-for still wins.
      result = await runMiddleware(guardedRequest, {
        clientAddress: request.headers.get("x-real-ip") ?? undefined,
      });
    } catch (error) {
      // The static page must not be served when its guard could not decide.
      console.error("Middleware error:", error);
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain" },
      });
    }

    if (result.response) return result.response;

    const headers = new Headers(result.headers);
    // A middleware cannot drive Vercel's routing by setting these as response headers. The names
    // are copied first because deleting while iterating Headers skips entries.
    for (const name of Array.from(headers.keys())) {
      if (name.toLowerCase().startsWith("x-middleware-")) headers.delete(name);
    }
    if (result.notFound) {
      headers.set(REWRITE_HEADER, new URL(options.notFoundPath, request.url).href);
    } else if (result.request.url !== guardedRequest.url) {
      headers.set(REWRITE_HEADER, result.request.url);
    } else {
      headers.set(NEXT_HEADER, "1");
    }
    return new Response(null, { headers });
  };
}
