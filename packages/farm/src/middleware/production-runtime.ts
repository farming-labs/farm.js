import type {
  CookieJar,
  CookieOptions,
  FarmMiddlewareConfig,
  MiddlewareConfig,
  MiddlewareContext,
  MiddlewareFunction,
  MiddlewareMatcher,
  MiddlewareModule,
  MiddlewareResult,
} from "./types";
import { emitFarmEvent } from "../observability";
import { decodeRouteSegment } from "../utils/decode";
import { normalizeMiddlewareModule } from "./module";
import { stripFarmLocaleFromPathname } from "../i18n/routing";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import type { ResolvedFarmServerConfig } from "../server-http";
import {
  parseMiddlewareCookieHeader,
  serializeMiddlewareCookie as serializeCookie,
  serializeMiddlewareCookieDeletion,
} from "./cookie-header";

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
}

export interface ProductionMiddlewareResult {
  request: Request;
  response: Response | null;
  data: Map<string, any>;
  context: Map<string, any>;
  headers: Headers;
  handled: boolean;
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

function withNodeRequestShape(request: Request, trustProxy: boolean): Request {
  const requestWithShape = request as Request & {
    socket?: { remoteAddress?: string };
  };

  if (!requestWithShape.socket) {
    const forwardedFor = trustProxy
      ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      : undefined;
    try {
      requestWithShape.socket = {
        remoteAddress: forwardedFor || "127.0.0.1",
      };
    } catch {
      // Some Request implementations may not be extensible.
    }
  }

  return requestWithShape;
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
): WebMiddlewareContextState {
  let currentRequest = withNodeRequestShape(request, trustProxy);
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
      currentRequest = withNodeRequestShape(new Request(nextUrl, currentRequest), trustProxy);
      ctx.request = currentRequest as any;
      ctx.url = nextUrl;
      ctx.pathname = nextUrl.pathname;
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

function toMatcherList(matcher: MiddlewareConfig["matcher"]): MiddlewareMatcher[] {
  if (!matcher) return [];
  return Array.isArray(matcher) ? matcher : [matcher];
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function parseColonParam(segment: string): { name: string; modifier?: string } {
  const raw = segment.slice(1);
  const last = raw[raw.length - 1];
  const modifier = last === "*" || last === "+" || last === "?" ? last : undefined;
  return {
    name: modifier ? raw.slice(0, -1) : raw,
    modifier,
  };
}

function compilePathPattern(pattern: string): { regex: RegExp; params: string[] } {
  const params: string[] = [];
  const segments = pattern.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { regex: /^\/$/, params };
  }

  const parts = segments.map((segment) => {
    if (segment === "**") {
      return "(?:/.*)?";
    }

    if (segment === "*") {
      return "/[^/]+";
    }

    if (segment.startsWith(":")) {
      const { name, modifier } = parseColonParam(segment);
      params.push(name);

      if (modifier === "*") {
        return "(?:/(.*))?";
      }
      if (modifier === "+") {
        return "/(.+)";
      }
      return "/([^/]+)";
    }

    if (segment.startsWith("[...") && segment.endsWith("]")) {
      params.push(segment.slice(4, -1));
      return "(?:/(.*))?";
    }

    if (segment.startsWith("[") && segment.endsWith("]")) {
      params.push(segment.slice(1, -1));
      return "/([^/]+)";
    }

    return `/${escapeRegex(segment).replace(/\\\*/g, "[^/]*")}`;
  });

  return {
    regex: new RegExp(`^${parts.join("")}$`),
    params,
  };
}

function matchPattern(
  pattern: string | RegExp,
  pathname: string,
): { matched: boolean; params?: Record<string, string> } {
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    const match = pattern.exec(pathname);
    return {
      matched: !!match,
      params: match?.groups ? { ...match.groups } : undefined,
    };
  }

  if (pattern === "*" || pattern === "/(.*)") {
    return { matched: true };
  }

  if (pattern.endsWith("(.*)")) {
    // Strip a trailing slash before the wildcard so `/admin/(.*)` matches the
    // `/admin` subtree like `/admin/**` does. Without this the prefix keeps its
    // slash and the check becomes startsWith("/admin//"), which no path
    // satisfies, so the matcher silently matches nothing — an auth gate written
    // that way would never run.
    const prefix = pattern.slice(0, -4).replace(/\/$/, "");
    return { matched: pathname === prefix || pathname.startsWith(`${prefix}/`) };
  }

  const { regex, params } = compilePathPattern(pattern);
  const match = regex.exec(pathname);
  if (!match) {
    return { matched: false };
  }

  const values: Record<string, string> = {};
  params.forEach((param, index) => {
    values[param] = decodeRouteSegment(match[index + 1] || "");
  });

  return {
    matched: true,
    params: Object.keys(values).length > 0 ? values : undefined,
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
  if (config.exclude) {
    for (const pattern of config.exclude) {
      if (matchPattern(pattern, pathname).matched) {
        return { matched: false };
      }
    }
  }

  if (config.matcher) {
    for (const matcher of toMatcherList(config.matcher)) {
      if (typeof matcher === "string" || matcher instanceof RegExp) {
        const result = matchPattern(matcher, pathname);
        if (result.matched) {
          return result;
        }
      } else if (typeof matcher === "function" && matcher(ctx)) {
        return { matched: true };
      }
    }
    return { matched: false };
  }

  return { matched: true };
}

function matchRoutePath(
  pathname: string,
  middlewarePath: string,
): { matched: boolean; params?: Record<string, string> } {
  if (middlewarePath === "/") return { matched: true };

  const exactMatch = matchPattern(middlewarePath, pathname);
  if (exactMatch.matched) {
    return exactMatch;
  }

  const nestedMatch = matchPattern(`${middlewarePath}/:__farmRest*`, pathname);
  if (!nestedMatch.matched) {
    return { matched: false };
  }

  const params = { ...nestedMatch.params };
  delete params.__farmRest;
  return {
    matched: true,
    params: Object.keys(params).length > 0 ? params : undefined,
  };
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
  const { matcher, exclude, runtime } = entry;
  return { matcher, exclude, runtime };
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
  };
}

export function createProductionMiddlewareRunner(options: ProductionMiddlewareRunnerOptions = {}) {
  const configMiddleware = normalizeConfigMiddleware(options.config);
  const fileMiddleware = normalizeFileMiddleware(options.modules);
  const entries = [...configMiddleware.entries, ...fileMiddleware];
  const globalConfig = configMiddleware.globalConfig;

  return async function runProductionMiddleware(
    request: Request,
  ): Promise<ProductionMiddlewareResult> {
    if (!globalConfig && entries.length === 0) {
      return emptyResult(request);
    }

    let contextState = createWebMiddlewareContext(
      request,
      undefined,
      options.server?.trustProxy === true,
    );
    let ctx = contextState.ctx;
    let currentRequest = contextState.getRequest();
    const initialPathname = options.i18n?.enabled
      ? stripFarmLocaleFromPathname(ctx.pathname, options.i18n)
      : ctx.pathname;
    let parentData: MiddlewareContext["parent"] | undefined;

    if (globalConfig) {
      const globalMatch = matchesMiddlewareConfig(initialPathname, globalConfig, ctx);
      if (!globalMatch.matched) {
        return emptyResult(request);
      }
      if (globalMatch.params) {
        ctx.params = { ...ctx.params, ...globalMatch.params };
      }
    }

    const applicable = entries
      .map((entry) => ({
        entry,
        routeMatch:
          entry.source === "config"
            ? { matched: true }
            : matchRoutePath(initialPathname, entry.path),
      }))
      .filter((candidate) => candidate.routeMatch.matched);

    if (applicable.length === 0) {
      return {
        request: currentRequest,
        response: null,
        data: new Map(ctx.data),
        context: new Map(ctx.locals),
        headers: mapToHeaders(contextState.headers),
        handled: false,
      };
    }

    for (const candidate of applicable) {
      const { entry, routeMatch } = candidate;
      const configMatch = entry.config
        ? matchesMiddlewareConfig(initialPathname, entry.config, ctx)
        : { matched: true };
      if (!configMatch.matched) {
        continue;
      }

      if (parentData) {
        contextState = createWebMiddlewareContext(
          currentRequest,
          parentData,
          options.server?.trustProxy === true,
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
        pathname: initialPathname,
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
          };
        }

        emitFarmEvent({
          type: "middleware.complete",
          ...middlewareEvent,
          durationMs: Date.now() - middlewareStartTime,
        });
      } catch (error) {
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

  const headers = new Headers(response.headers);
  const getSetCookie = (middlewareHeaders as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  const setCookies = getSetCookie
    ? getSetCookie.call(middlewareHeaders)
    : middlewareHeaders.get("set-cookie")
      ? [middlewareHeaders.get("set-cookie")!]
      : [];
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

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
