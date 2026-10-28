import { _withFarmResponseHeaders } from "../owned-response";
import type {
  CookieJar,
  CookieOptions,
  FarmMiddlewareConfig,
  MiddlewareConfig,
  MiddlewareContext,
  MiddlewareFunction,
  MiddlewareModule,
  MiddlewareResult,
} from "./types";
import { emitFarmEvent } from "../observability";
import {
  getFarmRedirectError,
  isFarmNotFoundError,
  isFarmRedirectError,
} from "../navigation-errors";
import { normalizeMiddlewareModule } from "./module";
import { stripFarmLocaleFromPathname } from "../i18n/routing";
import { stripFarmBasePath } from "../base-path";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import { withFarmRequestClientAddress, type ResolvedFarmServerConfig } from "../server-http";
import {
  parseMiddlewareCookieHeader,
  serializeMiddlewareCookie as serializeCookie,
  serializeMiddlewareCookieDeletion,
} from "./cookie-header";
import {
  compileMiddlewareConfig,
  compileMiddlewareRoute,
  matchesMiddlewareConfig as matchesPreparedMiddlewareConfig,
  matchesMiddlewareConfigAt,
  matchesMiddlewareRouteAt,
  toMiddlewareRoutePathname,
} from "./matcher";
import { createFarmAPIMiddlewarePathnames } from "../api/server-path";

export interface ProductionMiddlewareModuleEntry {
  path: string;
  filePath?: string;
  module: MiddlewareModule | Record<string, any>;
}

export interface ProductionMiddlewareRunnerOptions {
  config?: FarmMiddlewareConfig | null;
  modules?: ProductionMiddlewareModuleEntry[];
  i18n?: ResolvedFarmI18nConfig;
  server?: Pick<ResolvedFarmServerConfig, "trustProxy">;
  /** The app's public API path (`api.basePath`); `/api` middleware guards it too. */
  apiBasePath?: string;
  /**
   * @internal The app matches pages against the request path as received, without stripping
   * basePath or locale (the RSC entry), so middleware matches that path too.
   */
  rawPathRouting?: boolean;
}

export interface ProductionMiddlewareRequestOptions {
  /**
   * The address of the peer that opened the connection, as the server adapter
   * reports it. A web Request carries no socket, so this is the only way a
   * built app's middleware learns the client address it already has in
   * development. A trusted proxy's `x-forwarded-for` still takes precedence.
   */
  clientAddress?: string;
}

export interface ProductionMiddlewareResult {
  request: Request;
  response: Response | null;
  data: Map<string, any>;
  context: Map<string, any>;
  headers: Headers;
  handled: boolean;
  /**
   * Middleware without `cache: "public"` ran and let the request through. It may have been a
   * guard (an IP allowlist, an API key header), so the response must not reach a shared cache.
   */
  guarded: boolean;
  /** Middleware called notFound(): answer with the app's not-found page. */
  notFound?: true;
}

interface ProductionMiddlewareEntry {
  path: string;
  filePath: string;
  handlers: MiddlewareFunction[];
  config?: MiddlewareConfig;
  source: "config" | "file";
}

interface WebMiddlewareContextState {
  ctx: MiddlewareContext;
  headers: WebResponseHeaderMap;
  getRequest(): Request;
  getResponse(): Response | null;
}

interface WebResponseShimState {
  response: Record<string, any>;
  getResponse(method: string): Response | null;
}

const FARM_SET_COOKIE_HEADERS = Symbol("farm.setCookieHeaders");

type InternalMiddlewareParent = MiddlewareContext["parent"] & {
  [FARM_SET_COOKIE_HEADERS]?: string[];
};

class WebResponseHeaderMap extends Map<string, string> {
  private setCookies: string[] = [];

  override set(key: string, value: string): this {
    if (key.toLowerCase() === "set-cookie") {
      this.setCookies = [value];
      super.set("Set-Cookie", value);
      return this;
    }
    return super.set(key, value);
  }

  override delete(key: string): boolean {
    if (key.toLowerCase() === "set-cookie") {
      this.setCookies = [];
      return super.delete("Set-Cookie") || super.delete("set-cookie");
    }
    return super.delete(key);
  }

  override clear(): void {
    this.setCookies = [];
    super.clear();
  }

  appendSetCookie(value: string): void {
    this.setCookies.push(value);
    super.set("Set-Cookie", value);
  }

  replaceSetCookies(values: readonly string[]): void {
    this.setCookies = [...values];
    super.delete("Set-Cookie");
    super.delete("set-cookie");
    if (this.setCookies.length > 0) {
      super.set("Set-Cookie", this.setCookies[this.setCookies.length - 1]);
    }
  }

  getSetCookies(): readonly string[] {
    return this.setCookies;
  }
}

class WebCookieJar implements CookieJar {
  private cookies: Record<string, string>;

  constructor(
    request: Request,
    private headers: WebResponseHeaderMap,
  ) {
    this.cookies = parseMiddlewareCookieHeader(request.headers.get("cookie"));
  }

  get(name: string): string | undefined {
    return this.cookies[name];
  }

  set(name: string, value: string, options: CookieOptions = {}): void {
    this.cookies[name] = value;
    const cookieString = serializeCookie(name, value, options);
    this.headers.appendSetCookie(cookieString);
  }

  delete(name: string, options: CookieOptions = {}): void {
    delete this.cookies[name];
    // Path and Domain must match the cookie that was set, or the tombstone
    // addresses a different cookie and the original survives.
    this.headers.appendSetCookie(serializeMiddlewareCookieDeletion(name, options));
  }

  getAll(): Record<string, string> {
    return { ...this.cookies };
  }
}

function mapToHeaders(map: WebResponseHeaderMap): Headers {
  const headers = new Headers();
  for (const [key, value] of map) {
    if (key.toLowerCase() === "set-cookie") continue;
    headers.set(key, value);
  }
  for (const cookie of map.getSetCookies()) {
    headers.append("Set-Cookie", cookie);
  }
  return headers;
}

function headersToRecord(headers: Map<string, string>): Record<string, string> {
  return Object.fromEntries(headers);
}

function isMiddlewareResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function findHeaderName(headers: WebResponseHeaderMap, name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  return [...headers.keys()].find((key) => key.toLowerCase() === normalizedName);
}

function createResponseShim(headers: WebResponseHeaderMap): WebResponseShimState {
  const bodyChunks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  const response = {
    headersSent: false,
    writableEnded: false,
    statusCode: 200,
    statusMessage: "",
    setHeader(name: string, value: string | number | readonly string[]) {
      const existingName = findHeaderName(headers, name);
      if (existingName) headers.delete(existingName);
      if (name.toLowerCase() === "set-cookie") {
        headers.replaceSetCookies(Array.isArray(value) ? value.map(String) : [String(value)]);
      } else {
        headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
      }
      return this;
    },
    getHeader(name: string) {
      if (name.toLowerCase() === "set-cookie") {
        const cookies = headers.getSetCookies();
        return cookies.length > 0 ? [...cookies] : undefined;
      }
      const existingName = findHeaderName(headers, name);
      return existingName ? headers.get(existingName) : undefined;
    },
    hasHeader(name: string) {
      return name.toLowerCase() === "set-cookie"
        ? headers.getSetCookies().length > 0
        : findHeaderName(headers, name) !== undefined;
    },
    getHeaderNames() {
      return [...headers.keys()].map((name) => name.toLowerCase());
    },
    getHeaders() {
      return Object.fromEntries(
        [...headers.keys()].map((name) => [name.toLowerCase(), this.getHeader(name)]),
      );
    },
    removeHeader(name: string) {
      const existingName = findHeaderName(headers, name);
      if (existingName) headers.delete(existingName);
    },
    appendHeader(name: string, value: string | readonly string[]) {
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      if (name.toLowerCase() === "set-cookie") {
        for (const item of values) headers.appendSetCookie(item);
        return this;
      }
      const existing = this.getHeader(name);
      return this.setHeader(name, existing ? `${String(existing)}, ${values.join(", ")}` : values);
    },
    writeHead(
      status: number,
      statusMessageOrHeaders?: string | Record<string, string | number | readonly string[]>,
      responseHeaders?: Record<string, string | number | readonly string[]>,
    ) {
      this.statusCode = status;
      const nextHeaders =
        typeof statusMessageOrHeaders === "string" ? responseHeaders : statusMessageOrHeaders;
      if (typeof statusMessageOrHeaders === "string") {
        this.statusMessage = statusMessageOrHeaders;
      }
      if (nextHeaders) {
        for (const [key, value] of Object.entries(nextHeaders)) {
          this.setHeader(key, value);
        }
      }
      this.headersSent = true;
      return this;
    },
    flushHeaders() {
      this.headersSent = true;
    },
    write(
      chunk: string | Uint8Array,
      encodingOrCallback?: string | (() => void),
      callback?: () => void,
    ) {
      bodyChunks.push(typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk));
      this.headersSent = true;
      const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
      done?.();
      return true;
    },
    end(
      chunk?: string | Uint8Array | (() => void),
      encodingOrCallback?: string | (() => void),
      callback?: () => void,
    ) {
      if (typeof chunk === "string" || chunk instanceof Uint8Array) {
        bodyChunks.push(typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk));
      }
      this.headersSent = true;
      this.writableEnded = true;
      const done =
        typeof chunk === "function"
          ? chunk
          : typeof encodingOrCallback === "function"
            ? encodingOrCallback
            : callback;
      done?.();
      return this;
    },
  };

  return {
    response,
    getResponse(method: string) {
      if (!response.headersSent && !response.writableEnded) return null;

      const bodyLength = bodyChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const body = new Uint8Array(bodyLength);
      let offset = 0;
      for (const chunk of bodyChunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }

      const bodyAllowed =
        method.toUpperCase() !== "HEAD" &&
        response.statusCode !== 204 &&
        response.statusCode !== 205 &&
        response.statusCode !== 304;
      return new Response(bodyAllowed && bodyLength > 0 ? body : null, {
        status: response.statusCode,
        statusText: response.statusMessage || undefined,
        headers: mapToHeaders(headers),
      });
    },
  };
}

function createHandledResponse(
  body: BodyInit | null,
  init: ResponseInit,
  headers: WebResponseHeaderMap,
): Response {
  const responseHeaders = new Headers();
  for (const [key, value] of headers) {
    if (key.toLowerCase() === "set-cookie") continue;
    responseHeaders.set(key, value);
  }
  for (const [key, value] of new Headers(init.headers)) {
    responseHeaders.set(key, value);
  }
  for (const cookie of headers.getSetCookies()) {
    responseHeaders.append("Set-Cookie", cookie);
  }
  return new Response(body, { ...init, headers: responseHeaders });
}

function createWebMiddlewareContext(
  request: Request,
  parent?: MiddlewareContext["parent"],
  trustProxy = false,
  clientAddress?: string,
  toRoutePathname?: (pathname: string) => string,
): WebMiddlewareContextState {
  let currentRequest = withFarmRequestClientAddress(request, trustProxy, clientAddress);
  let handledResponse: Response | null = null;
  const url = new URL(currentRequest.url);
  const data = parent?.data ? new Map(parent.data) : new Map<string, any>();
  const locals = parent?.locals ? new Map(parent.locals) : new Map<string, any>();
  const headers = new WebResponseHeaderMap();

  if (parent?.headers) {
    for (const [key, value] of Object.entries(parent.headers)) {
      if (key.toLowerCase() === "set-cookie") continue;
      headers.set(key, value);
    }
  }
  const parentCookies = (parent as InternalMiddlewareParent | undefined)?.[FARM_SET_COOKIE_HEADERS];
  if (parentCookies) headers.replaceSetCookies(parentCookies);
  const responseShim = createResponseShim(headers);

  const ctx = {
    request: currentRequest as any,
    response: responseShim.response as any,
    url,
    pathname: url.pathname,
    routePathname: toMiddlewareRoutePathname(url.pathname, toRoutePathname),
    searchParams: url.searchParams,
    method: currentRequest.method || "GET",
    params: {},
    route: url.pathname,
    parent,
    vite: {
      isDev: false,
      hmr: false,
    },
    data,
    locals,
    headers,
    cookies: new WebCookieJar(currentRequest, headers),
    _handled: false as boolean,
    _redirectUrl: undefined as string | undefined,
    _rewriteUrl: undefined as string | undefined,

    redirect(redirectUrl: string, status = 307): void {
      ctx._redirectUrl = redirectUrl;
      ctx._handled = true;
      handledResponse = createHandledResponse(
        `Redirecting to ${redirectUrl}`,
        {
          status,
          headers: {
            Location: redirectUrl,
            "Content-Type": "text/plain",
          },
        },
        headers,
      );
    },

    rewrite(rewriteUrl: string): void {
      ctx._rewriteUrl = rewriteUrl;
      const nextUrl = new URL(rewriteUrl, currentRequest.url);
      currentRequest = withFarmRequestClientAddress(
        new Request(nextUrl, currentRequest),
        trustProxy,
        clientAddress,
      );
      ctx.request = currentRequest as any;
      ctx.url = nextUrl;
      ctx.pathname = nextUrl.pathname;
      ctx.routePathname = toMiddlewareRoutePathname(nextUrl.pathname, toRoutePathname);
      ctx.searchParams = nextUrl.searchParams;
      ctx.route = nextUrl.pathname;
    },

    json(jsonData: any, status = 200): void {
      ctx._handled = true;
      handledResponse = createHandledResponse(
        JSON.stringify(jsonData),
        {
          status,
          headers: {
            "Content-Type": "application/json",
          },
        },
        headers,
      );
    },

    text(content: string, status = 200): void {
      ctx._handled = true;
      handledResponse = createHandledResponse(
        content,
        {
          status,
          headers: {
            "Content-Type": "text/plain",
          },
        },
        headers,
      );
    },

    html(content: string, status = 200): void {
      ctx._handled = true;
      handledResponse = createHandledResponse(
        content,
        {
          status,
          headers: {
            "Content-Type": "text/html",
          },
        },
        headers,
      );
    },
  } satisfies MiddlewareContext;

  return {
    ctx,
    headers,
    getRequest: () => currentRequest,
    getResponse: () => handledResponse || responseShim.getResponse(currentRequest.method),
  };
}

/**
 * Decide whether a middleware entry's `export const config` applies to a path.
 *
 * Exported so the standalone dev plugin matches exactly what the production
 * runner does instead of maintaining a parallel implementation.
 */
export function matchesMiddlewareConfig(
  pathname: string,
  config: MiddlewareConfig,
  ctx: MiddlewareContext,
): { matched: boolean; params?: Record<string, string> } {
  return matchesPreparedMiddlewareConfig(pathname, config, ctx);
}

function getConfigHandlers(
  entry: MiddlewareConfig & {
    handler?: MiddlewareFunction;
    handlers?: MiddlewareFunction[];
  },
): MiddlewareFunction[] {
  const handlers: MiddlewareFunction[] = [];
  if ("handler" in entry && typeof entry.handler === "function") {
    handlers.push(entry.handler);
  }
  if ("handlers" in entry && Array.isArray(entry.handlers)) {
    handlers.push(...entry.handlers.filter((handler) => typeof handler === "function"));
  }
  return handlers;
}

function toMiddlewareConfig(
  entry: MiddlewareConfig & {
    handler?: MiddlewareFunction;
    handlers?: MiddlewareFunction[];
  },
): MiddlewareConfig {
  const { matcher, exclude, runtime, cache } = entry;
  return { matcher, exclude, runtime, cache };
}

function normalizeConfigMiddleware(config?: FarmMiddlewareConfig | null): {
  entries: ProductionMiddlewareEntry[];
  globalConfig?: MiddlewareConfig;
} {
  const entries: ProductionMiddlewareEntry[] = [];
  let globalConfig: MiddlewareConfig | undefined;

  if (!config) {
    return { entries, globalConfig };
  }

  const configEntries = Array.isArray(config) ? config : [config];
  for (const [index, entry] of configEntries.entries()) {
    const handlers = getConfigHandlers(entry);
    const middlewareConfig = toMiddlewareConfig(entry);

    if (handlers.length === 0) {
      globalConfig = middlewareConfig;
      continue;
    }

    compileMiddlewareConfig(middlewareConfig);
    entries.push({
      path: "/",
      filePath: `farm.config.ts#middleware-${index}`,
      handlers,
      config: middlewareConfig,
      source: "config",
    });
  }

  return { entries, globalConfig };
}

function normalizeFileMiddleware(
  modules: ProductionMiddlewareModuleEntry[] = [],
): ProductionMiddlewareEntry[] {
  const entries: ProductionMiddlewareEntry[] = [];

  for (const moduleEntry of modules) {
    const normalized = normalizeMiddlewareModule(moduleEntry.module, moduleEntry.path);
    if (!normalized) {
      continue;
    }

    if (normalized.config) compileMiddlewareConfig(normalized.config);
    entries.push({
      path: moduleEntry.path,
      filePath: moduleEntry.filePath || moduleEntry.path,
      handlers: normalized.handlers,
      config: normalized.config,
      source: "file",
    });
  }

  return entries;
}

async function executeHandlers(
  handlers: MiddlewareFunction[],
  ctx: MiddlewareContext,
): Promise<Response | undefined> {
  let handlerIndex = 0;
  let returnedResponse: Response | undefined;
  const executeNext = async (): Promise<MiddlewareResult> => {
    if (handlerIndex < handlers.length) {
      const handler = handlers[handlerIndex++];
      const result = await handler(ctx, executeNext);
      if (isMiddlewareResponse(result)) {
        returnedResponse = result;
        return result;
      }
    }
    return returnedResponse;
  };

  const result = await executeNext();
  return isMiddlewareResponse(result) ? result : returnedResponse;
}

function emptyResult(request: Request): ProductionMiddlewareResult {
  return {
    request,
    response: null,
    data: new Map(),
    context: new Map(),
    headers: new Headers(),
    handled: false,
    guarded: false,
  };
}

export function createProductionMiddlewareRunner(options: ProductionMiddlewareRunnerOptions = {}) {
  const configMiddleware = normalizeConfigMiddleware(options.config);
  const fileMiddleware = normalizeFileMiddleware(options.modules);
  for (const entry of fileMiddleware) compileMiddlewareRoute(entry);
  const entries = [...configMiddleware.entries, ...fileMiddleware];
  const globalConfig = configMiddleware.globalConfig;
  if (globalConfig) compileMiddlewareConfig(globalConfig);
  const toMiddlewarePathnames = createFarmAPIMiddlewarePathnames(options.apiBasePath);

  return async function runProductionMiddleware(
    request: Request,
    requestOptions: ProductionMiddlewareRequestOptions = {},
  ): Promise<ProductionMiddlewareResult> {
    if (!globalConfig && entries.length === 0) {
      return emptyResult(request);
    }

    // Match the app path page routing sees: without basePath (the locale step
    // strips it too), so file and config middleware run beneath a basePath.
    const toRoutePathname = (pathname: string) =>
      options.i18n?.enabled
        ? stripFarmLocaleFromPathname(pathname, options.i18n)
        : stripFarmBasePath(pathname, options.i18n?.basePath ?? "/");
    let contextState = createWebMiddlewareContext(
      request,
      undefined,
      options.server?.trustProxy === true,
      requestOptions.clientAddress,
      toRoutePathname,
    );
    let ctx = contextState.ctx;
    let currentRequest = contextState.getRequest();
    const initialRequestPathname = ctx.pathname;
    const initialPathname = toRoutePathname(initialRequestPathname);
    // Middleware guards every path a page can match: with raw-path routing that includes the
    // request path itself, so a guard under app/<basePath>/ or app/[lang]/ runs for its page.
    const matchPathnames = (pathname: string, requestPathname: string) =>
      options.rawPathRouting && requestPathname !== pathname
        ? [
            ...new Set([
              ...toMiddlewarePathnames(pathname),
              ...toMiddlewarePathnames(requestPathname),
            ]),
          ]
        : toMiddlewarePathnames(pathname);
    let parentData: MiddlewareContext["parent"] | undefined;

    if (globalConfig) {
      const globalMatch = matchesMiddlewareConfigAt(
        matchPathnames(initialPathname, initialRequestPathname),
        globalConfig,
        ctx,
      );
      if (!globalMatch.matched) {
        return emptyResult(request);
      }
      if (globalMatch.params) {
        ctx.params = { ...ctx.params, ...globalMatch.params };
      }
    }

    // A ctx.rewrite() target is guarded as a direct request for it is: once a
    // pass over the entries ends on a rewritten path, the entries matching that
    // path which have not run yet get a pass of their own. Each entry runs at
    // most once, so repeated rewrites end after at most one pass per entry.
    const ran = new Set<ProductionMiddlewareEntry>();
    let guarded = false;
    function* applicableMiddleware() {
      for (
        let pathname = initialPathname, requestPathname = initialRequestPathname, pass = 0;
        ;
        pass++
      ) {
        const pathnames = matchPathnames(pathname, requestPathname);
        if (pass > 0 && globalConfig) {
          if (!matchesMiddlewareConfigAt(pathnames, globalConfig, ctx).matched) return;
        }
        for (const entry of entries) {
          if (ran.has(entry)) continue;
          const routeMatch =
            entry.source === "config"
              ? { matched: true }
              : matchesMiddlewareRouteAt(pathnames, entry);
          if (routeMatch.matched) yield { entry, routeMatch, pathname, pathnames };
        }
        const rewrittenRequestPathname = new URL(currentRequest.url).pathname;
        const rewrittenPathname = toRoutePathname(rewrittenRequestPathname);
        if (rewrittenPathname === pathname && rewrittenRequestPathname === requestPathname) return;
        pathname = rewrittenPathname;
        requestPathname = rewrittenRequestPathname;
      }
    }

    for (const { entry, routeMatch, pathname, pathnames } of applicableMiddleware()) {
      const configMatch = entry.config
        ? matchesMiddlewareConfigAt(pathnames, entry.config, ctx)
        : { matched: true };
      if (!configMatch.matched) {
        continue;
      }
      ran.add(entry);
      if (entry.config?.cache !== "public") guarded = true;

      if (parentData) {
        contextState = createWebMiddlewareContext(
          currentRequest,
          parentData,
          options.server?.trustProxy === true,
          requestOptions.clientAddress,
          toRoutePathname,
        );
        ctx = contextState.ctx;
      }

      if (routeMatch.params) {
        ctx.params = { ...ctx.params, ...routeMatch.params };
      }
      if (configMatch.params) {
        ctx.params = { ...ctx.params, ...configMatch.params };
      }

      const middlewareStartTime = Date.now();
      const middlewareEvent = {
        route: entry.path,
        pathname,
        name: entry.filePath,
      };
      emitFarmEvent({ type: "middleware.start", ...middlewareEvent });

      try {
        const returnedResponse = await executeHandlers(entry.handlers, ctx);
        currentRequest = contextState.getRequest();

        if (returnedResponse) {
          const response = applyProductionMiddlewareHeaders(
            returnedResponse,
            mapToHeaders(contextState.headers),
          );
          emitFarmEvent({
            type: "middleware.shortCircuit",
            ...middlewareEvent,
            status: response.status,
          });
          return {
            request: currentRequest,
            response,
            data: new Map(ctx.data),
            context: new Map(ctx.locals),
            headers: mapToHeaders(contextState.headers),
            handled: true,
            guarded,
          };
        }

        if (ctx._handled || ctx.response.headersSent || ctx.response.writableEnded) {
          const response = contextState.getResponse() || new Response(null);
          emitFarmEvent({
            type: "middleware.shortCircuit",
            ...middlewareEvent,
            status: response.status,
          });
          return {
            request: currentRequest,
            response,
            data: new Map(ctx.data),
            context: new Map(ctx.locals),
            headers: mapToHeaders(contextState.headers),
            handled: true,
            guarded,
          };
        }

        emitFarmEvent({
          type: "middleware.complete",
          ...middlewareEvent,
          durationMs: Date.now() - middlewareStartTime,
        });
      } catch (error) {
        // redirect() and notFound() are control flow, as they are in pages.
        // A rewrite earlier in this middleware still decides the request.
        currentRequest = contextState.getRequest();
        if (isFarmRedirectError(error)) {
          const redirect = getFarmRedirectError(error)!;
          const response = applyProductionMiddlewareHeaders(
            new Response(null, { status: redirect.status, headers: { Location: redirect.url } }),
            mapToHeaders(contextState.headers),
          );
          emitFarmEvent({
            type: "middleware.shortCircuit",
            ...middlewareEvent,
            status: response.status,
          });
          return {
            request: currentRequest,
            response,
            data: new Map(ctx.data),
            context: new Map(ctx.locals),
            headers: mapToHeaders(contextState.headers),
            handled: true,
            guarded,
          };
        }
        if (isFarmNotFoundError(error)) {
          emitFarmEvent({ type: "middleware.shortCircuit", ...middlewareEvent, status: 404 });
          return {
            request: currentRequest,
            response: null,
            data: new Map(ctx.data),
            context: new Map(ctx.locals),
            headers: mapToHeaders(contextState.headers),
            handled: true,
            guarded,
            notFound: true,
          };
        }
        emitFarmEvent({
          type: "middleware.error",
          ...middlewareEvent,
          error,
        });
        throw error;
      }

      parentData = {
        data: new Map(ctx.data),
        locals: new Map(ctx.locals),
        headers: headersToRecord(contextState.headers),
        [FARM_SET_COOKIE_HEADERS]: [...contextState.headers.getSetCookies()],
      } as InternalMiddlewareParent;
    }

    return {
      request: currentRequest,
      response: null,
      data: new Map(ctx.data),
      context: new Map(ctx.locals),
      headers: mapToHeaders(contextState.headers),
      handled: false,
      guarded,
    };
  };
}

export function applyProductionMiddlewareHeaders(
  response: Response,
  middlewareHeaders?: Headers | null,
): Response {
  if (!middlewareHeaders || Array.from(middlewareHeaders.keys()).length === 0) {
    return response;
  }

  const getSetCookie = (middlewareHeaders as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  const setCookies = getSetCookie
    ? getSetCookie.call(middlewareHeaders)
    : middlewareHeaders.get("set-cookie")
      ? [middlewareHeaders.get("set-cookie")!]
      : [];
  return _withFarmResponseHeaders(response, (headers) => {
    for (const [key, value] of middlewareHeaders) {
      if (key.toLowerCase() === "set-cookie") continue;
      // A returned Response's headers are authoritative and preserved (matching
      // the dev runtime, where the Response is applied after ctx.headers). ctx
      // headers only add keys the Response did not already set.
      if (headers.has(key)) continue;
      headers.set(key, value);
    }
    for (const cookie of setCookies) {
      headers.append("Set-Cookie", cookie);
    }
  });
}

const PRIVATE_CACHE_DIRECTIVE = /(?:^|,)\s*(?:private|no-store)\s*(?:[,=]|$)/i;
// Directives a CDN reads in place of Cache-Control (RFC 9213 and the platform names).
const CDN_CACHE_CONTROL_HEADERS = [
  "cdn-cache-control",
  "vercel-cdn-cache-control",
  "netlify-cdn-cache-control",
  "cloudflare-cdn-cache-control",
];

/**
 * Keep a response that middleware let through out of shared caches. A CDN keys its copy by URL
 * and serves it without running the guard again, so a page an IP allowlist or API key header
 * let one visitor read would reach everyone. A Cache-Control that a shared cache may store
 * becomes `private, no-store`; a private one is left as it is.
 *
 * @internal
 */
export function _withFarmGuardedResponseCache(response: Response): Response {
  const shareable = !PRIVATE_CACHE_DIRECTIVE.test(response.headers.get("cache-control") ?? "");
  if (!shareable && !CDN_CACHE_CONTROL_HEADERS.some((name) => response.headers.has(name))) {
    return response;
  }
  return _withFarmResponseHeaders(response, (headers) => {
    if (shareable) headers.set("Cache-Control", "private, no-store");
    for (const name of CDN_CACHE_CONTROL_HEADERS) headers.delete(name);
  });
}
