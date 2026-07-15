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
import { normalizeMiddlewareModule } from "./module";

export interface ProductionMiddlewareModuleEntry {
  path: string;
  filePath?: string;
  module: MiddlewareModule | Record<string, any>;
}

export interface ProductionMiddlewareRunnerOptions {
  config?: FarmMiddlewareConfig | null;
  modules?: ProductionMiddlewareModuleEntry[];
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
  getRequest(): Request;
  getResponse(): Response | null;
}

function parseCookies(cookieHeader?: string | null): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce(
    (cookies, cookie) => {
      const [name, ...rest] = cookie.split("=");
      const value = rest.join("=").trim();
      if (name && value) {
        cookies[name.trim()] = decodeURIComponent(value);
      }
      return cookies;
    },
    {} as Record<string, string>,
  );
}

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
  if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
  cookie += `; Path=${options.path || "/"}`;
  if (options.domain) cookie += `; Domain=${options.domain}`;
  if (options.secure) cookie += "; Secure";
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.sameSite) {
    cookie += `; SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`;
  }

  return cookie;
}

class WebCookieJar implements CookieJar {
  private cookies: Record<string, string>;
  private setCookies: string[] = [];

  constructor(
    request: Request,
    private headers: Map<string, string>,
  ) {
    this.cookies = parseCookies(request.headers.get("cookie"));
  }

  get(name: string): string | undefined {
    return this.cookies[name];
  }

  set(name: string, value: string, options: CookieOptions = {}): void {
    this.cookies[name] = value;
    const cookieString = serializeCookie(name, value, options);
    this.setCookies.push(cookieString);
    this.headers.set("Set-Cookie", this.setCookies.join(", "));
  }

  delete(name: string): void {
    delete this.cookies[name];
    const cookieString = serializeCookie(name, "", {
      maxAge: 0,
      expires: new Date(0),
    });
    this.setCookies.push(cookieString);
    this.headers.set("Set-Cookie", this.setCookies.join(", "));
  }

  getAll(): Record<string, string> {
    return { ...this.cookies };
  }
}

function mapToHeaders(map: Map<string, string>): Headers {
  const headers = new Headers();
  for (const [key, value] of map) {
    if (key.toLowerCase() === "set-cookie") {
      headers.append(key, value);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function headersToRecord(headers: Map<string, string>): Record<string, string> {
  return Object.fromEntries(headers);
}

function isMiddlewareResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function createResponseShim(headers: Map<string, string>): Record<string, any> {
  return {
    headersSent: false,
    writableEnded: false,
    setHeader(name: string, value: string | string[]) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
    },
    getHeader(name: string) {
      return headers.get(name);
    },
    writeHead(status: number, responseHeaders?: Record<string, string>) {
      this.statusCode = status;
      if (responseHeaders) {
        for (const [key, value] of Object.entries(responseHeaders)) {
          headers.set(key, value);
        }
      }
      this.headersSent = true;
    },
    end() {
      this.writableEnded = true;
    },
  };
}

function withNodeRequestShape(request: Request): Request {
  const requestWithShape = request as Request & {
    socket?: { remoteAddress?: string };
  };

  if (!requestWithShape.socket) {
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
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
  headers: Map<string, string>,
): Response {
  const responseHeaders = new Headers(init.headers);
  for (const [key, value] of headers) {
    if (key.toLowerCase() === "set-cookie") {
      responseHeaders.append(key, value);
    } else {
      responseHeaders.set(key, value);
    }
  }
  return new Response(body, { ...init, headers: responseHeaders });
}

function createWebMiddlewareContext(
  request: Request,
  parent?: MiddlewareContext["parent"],
): WebMiddlewareContextState {
  let currentRequest = withNodeRequestShape(request);
  let handledResponse: Response | null = null;
  const url = new URL(currentRequest.url);
  const data = parent?.data ? new Map(parent.data) : new Map<string, any>();
  const locals = parent?.locals ? new Map(parent.locals) : new Map<string, any>();
  const headers = new Map<string, string>();

  if (parent?.headers) {
    for (const [key, value] of Object.entries(parent.headers)) {
      headers.set(key, value);
    }
  }

  const ctx = {
    request: currentRequest as any,
    response: createResponseShim(headers) as any,
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
      currentRequest = withNodeRequestShape(new Request(nextUrl, currentRequest));
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
    getRequest: () => currentRequest,
    getResponse: () => handledResponse,
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
    const prefix = pattern.slice(0, -4);
    return { matched: pathname === prefix || pathname.startsWith(`${prefix}/`) };
  }

  const { regex, params } = compilePathPattern(pattern);
  const match = regex.exec(pathname);
  if (!match) {
    return { matched: false };
  }

  const values: Record<string, string> = {};
  params.forEach((param, index) => {
    values[param] = decodeURIComponent(match[index + 1] || "");
  });

  return {
    matched: true,
    params: Object.keys(values).length > 0 ? values : undefined,
  };
}

function matchesConfig(
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
      } else if (typeof matcher === "function") {
        return { matched: matcher(ctx) };
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

  const params = { ...(nestedMatch.params || {}) };
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

    let contextState = createWebMiddlewareContext(request);
    let ctx = contextState.ctx;
    let currentRequest = contextState.getRequest();
    const initialPathname = ctx.pathname;
    let parentData: MiddlewareContext["parent"] | undefined;

    if (globalConfig) {
      const globalMatch = matchesConfig(initialPathname, globalConfig, ctx);
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
        headers: mapToHeaders(ctx.headers),
        handled: false,
      };
    }

    for (const candidate of applicable) {
      const { entry, routeMatch } = candidate;
      const configMatch = entry.config
        ? matchesConfig(initialPathname, entry.config, ctx)
        : { matched: true };
      if (!configMatch.matched) {
        continue;
      }

      if (parentData) {
        contextState = createWebMiddlewareContext(currentRequest, parentData);
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
            mapToHeaders(ctx.headers),
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
            headers: mapToHeaders(ctx.headers),
            handled: true,
          };
        }

        if (ctx._handled) {
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
            headers: mapToHeaders(ctx.headers),
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
        headers: headersToRecord(ctx.headers),
      };
    }

    return {
      request: currentRequest,
      response: null,
      data: new Map(ctx.data),
      context: new Map(ctx.locals),
      headers: mapToHeaders(ctx.headers),
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
  for (const [key, value] of middlewareHeaders) {
    if (key.toLowerCase() === "set-cookie") {
      headers.append(key, value);
    } else {
      headers.set(key, value);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
