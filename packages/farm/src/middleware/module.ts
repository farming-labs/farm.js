import { createWebRequestFromFarmRequest } from "../server/request";
import type {
  MiddlewareConfig,
  MiddlewareContext,
  MiddlewareFunction,
  MiddlewareModule,
  MiddlewareStore,
  RequestMiddlewareContext,
} from "./types";

export interface NormalizedMiddlewareModule {
  handlers: MiddlewareFunction[];
  config?: MiddlewareConfig;
}

function isWebRequest(request: unknown): request is Request {
  return typeof Request !== "undefined" && request instanceof Request;
}

function toWebRequest(ctx: MiddlewareContext): Request {
  if (isWebRequest(ctx.request)) {
    return ctx.request;
  }
  return createWebRequestFromFarmRequest(ctx.request);
}

function createRequestMiddlewareContext(
  ctx: MiddlewareContext,
): RequestMiddlewareContext<Record<string, any>, Record<string, any>> {
  const context = {
    get url() {
      return ctx.url;
    },
    get pathname() {
      return ctx.pathname;
    },
    get searchParams() {
      return ctx.searchParams;
    },
    get method() {
      return ctx.method;
    },
    get params() {
      return ctx.params;
    },
    get route() {
      return ctx.route;
    },
    get locals() {
      return ctx.locals as MiddlewareStore<Record<string, any>>;
    },
    get data() {
      return ctx.data as MiddlewareStore<Record<string, any>>;
    },
    get headers() {
      return ctx.headers;
    },
    get cookies() {
      return ctx.cookies;
    },
    get(key: string) {
      return ctx.locals.get(key);
    },
    has(key: string) {
      return ctx.locals.has(key);
    },
    set(key: string, value: any) {
      ctx.locals.set(key, value);
    },
    delete(key: string) {
      return ctx.locals.delete(key);
    },
    redirect(url: string, status?: number) {
      ctx.redirect(url, status);
    },
    rewrite(url: string) {
      ctx.rewrite(url);
    },
    json(data: any, status?: number) {
      ctx.json(data, status);
    },
    text(content: string, status?: number) {
      ctx.text(content, status);
    },
    html(content: string, status?: number) {
      ctx.html(content, status);
    },
  } satisfies RequestMiddlewareContext;

  return context;
}

/**
 * Normalize the two supported middleware file styles to Farm's internal chain.
 */
export function normalizeMiddlewareModule(
  middlewareModule: MiddlewareModule | Record<string, any>,
  routePath: string,
): NormalizedMiddlewareModule | null {
  const module = middlewareModule as MiddlewareModule;
  const defaultExport = module.default;
  const namedExport = module.middleware;
  const hasNamedExport = typeof namedExport === "function";

  if (namedExport !== undefined && !hasNamedExport) {
    throw new TypeError("The named middleware export must be a function");
  }

  if (defaultExport && hasNamedExport) {
    throw new Error(
      "A middleware file cannot export both a default handler and a named middleware handler",
    );
  }

  if (hasNamedExport) {
    return {
      handlers: [
        async (ctx) => {
          return namedExport(toWebRequest(ctx), createRequestMiddlewareContext(ctx));
        },
      ],
      config: module.config,
    };
  }

  if (defaultExport && typeof defaultExport === "object" && "build" in defaultExport) {
    if (typeof (defaultExport as any).setBasePath === "function") {
      (defaultExport as any).setBasePath(routePath);
    }
    const built = (defaultExport as any).build();
    const handlers = Array.isArray(built?.handlers)
      ? built.handlers.filter((handler: unknown) => typeof handler === "function")
      : [];
    return handlers.length > 0
      ? {
          handlers,
          config: module.config || built?.config,
        }
      : null;
  }

  if (typeof defaultExport === "function") {
    return {
      handlers: [defaultExport as MiddlewareFunction],
      config: module.config,
    };
  }

  return null;
}
