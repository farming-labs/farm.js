import type { ComponentType, ReactNode } from "react";
import type { FarmIntegrationAPI } from "./integration-api";
import type { FarmPlugin, FarmPluginContext } from "./plugin";
import type { FarmRequest, FarmResponse } from "./types";

export {
  api,
  defineIntegrationAPI,
  defineIntegrationAPIOperation,
} from "./integration-api";
export type {
  FarmIntegrationAPI,
  FarmIntegrationAPIBodyFormat,
  FarmIntegrationAPIMethod,
  FarmIntegrationAPIOperation,
  FarmIntegrationAPIResponseFormat,
} from "./integration-api";

export type FarmIntegrationCategory =
  | "auth"
  | "payment"
  | "monitoring"
  | "logging"
  | (string & {});

/** @deprecated Use FarmIntegrationCategory instead. */
export type FarmIntegrationSlot = FarmIntegrationCategory;

export type FarmIntegrationRouteParamValue = string | string[];
export type FarmIntegrationRouteParams = Record<string, FarmIntegrationRouteParamValue>;

export interface FarmIntegrationRequestContextStore {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown, options?: { exposeToPage?: boolean }): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  snapshot(options?: { exposedOnly?: boolean }): Map<string, unknown>;
}

export interface FarmIntegrationHandlerContext {
  request: Request;
  requestId: string;
  url: URL;
  pathname: string;
  method: string;
  params: FarmIntegrationRouteParams;
  integration: {
    category: FarmIntegrationCategory;
    /** @deprecated Use category instead. */
    slot: FarmIntegrationCategory;
    type: string;
    instance: unknown;
  };
  route: {
    kind: "route" | "middleware";
    path: string;
    methods: readonly string[];
  };
  requestContext: FarmIntegrationRequestContextStore;
  config: FarmPluginContext["config"];
  isDev: boolean;
  isProd: boolean;
}

export interface FarmIntegrationRoute {
  path: string;
  methods: readonly string[];
  rawBody?: boolean;
  handler(
    request: Request,
    context: FarmIntegrationHandlerContext,
  ): Promise<Response> | Response;
}

export interface FarmIntegrationMiddleware {
  matcher?: string | string[];
  handler(
    request: Request,
    context: FarmIntegrationHandlerContext,
  ): Promise<Response | void> | Response | void;
}

export interface FarmIntegrationProviderProps {
  children: ReactNode;
}

export interface FarmIntegrationProvider {
  name: string;
  type: string;
  props?: Record<string, unknown>;
  component?: ComponentType<FarmIntegrationProviderProps>;
}

export interface FarmIntegrationDocumentNavigation {
  matcher: string | readonly string[];
}

export type FarmIntegrationLogPhase =
  | "registered"
  | "request:start"
  | "request:end"
  | "request:error";

export interface FarmIntegrationLogEvent {
  category: FarmIntegrationCategory;
  /** @deprecated Use category instead. */
  slot: FarmIntegrationCategory;
  type: string;
  phase: FarmIntegrationLogPhase;
  route?: {
    kind: "route" | "middleware";
    path: string;
    methods: readonly string[];
  };
  requestId?: string;
  request?: Request;
  response?: Response;
  error?: unknown;
  durationMs?: number;
  context: Map<string, unknown>;
}

export type FarmIntegrationLogger = (
  event: FarmIntegrationLogEvent,
) => void | Promise<void>;

export interface FarmIntegration {
  readonly kind: "farm-integration";
  category: FarmIntegrationCategory;
  /** @deprecated Use category instead. */
  slot?: FarmIntegrationCategory;
  type: string;
  instance: unknown;
  api?: FarmIntegrationAPI;
  log?: FarmIntegrationLogger;
  routes?: readonly FarmIntegrationRoute[];
  middleware?: readonly FarmIntegrationMiddleware[];
  providers?: readonly FarmIntegrationProvider[];
  documentNavigations?: readonly FarmIntegrationDocumentNavigation[];
  plugins?: readonly FarmPlugin[];
}

export type FarmIntegrationsUserConfig = Record<string, FarmIntegration | undefined>;

type FarmIntegrationInput = Omit<FarmIntegration, "kind" | "category" | "slot"> &
  (
    | {
        category: FarmIntegrationCategory;
        slot?: FarmIntegrationCategory;
      }
    | {
        category?: FarmIntegrationCategory;
        slot: FarmIntegrationCategory;
      }
  );

export function defineIntegration(
  integration: FarmIntegrationInput,
): FarmIntegration {
  const category = integration.category ?? integration.slot;

  if (!category) {
    throw new Error("Integration category is required.");
  }

  if (integration.category && integration.slot && integration.category !== integration.slot) {
    throw new Error("Integration category and slot must match when both are provided.");
  }

  return {
    kind: "farm-integration",
    ...integration,
    category,
    slot: category,
  };
}

export function isFarmIntegration(value: unknown): value is FarmIntegration {
  return (
    !!value &&
    typeof value === "object" &&
    (value as FarmIntegration).kind === "farm-integration"
  );
}

export function resolveIntegrationPlugins(
  integrations: FarmIntegrationsUserConfig | undefined,
): FarmPlugin[] {
  if (!integrations) {
    return [];
  }

  const plugins: FarmPlugin[] = [];
  for (const integration of Object.values(integrations)) {
    if (!integration || !isFarmIntegration(integration)) {
      continue;
    }

    plugins.push(createIntegrationPlugin(integration));

    if (integration.plugins?.length) {
      plugins.push(...integration.plugins);
    }
  }

  return plugins;
}

export function getIntegrationProviders(
  integrations: FarmIntegrationsUserConfig | undefined,
): Array<Pick<FarmIntegrationProvider, "name" | "type" | "props">> {
  if (!integrations) {
    return [];
  }

  const providers: Array<Pick<FarmIntegrationProvider, "name" | "type" | "props">> = [];
  for (const integration of Object.values(integrations)) {
    if (!integration || !isFarmIntegration(integration) || !integration.providers?.length) {
      continue;
    }

    for (const provider of integration.providers) {
      providers.push({
        name: provider.name,
        type: provider.type,
        props: provider.props,
      });
    }
  }

  return providers;
}

export function getIntegrationDocumentNavigationMatchers(
  integrations: FarmIntegrationsUserConfig | undefined,
): string[] {
  if (!integrations) {
    return [];
  }

  const matchers: string[] = [];
  for (const integration of Object.values(integrations)) {
    if (!integration || !isFarmIntegration(integration) || !integration.documentNavigations?.length) {
      continue;
    }

    for (const navigation of integration.documentNavigations) {
      const items = Array.isArray(navigation.matcher)
        ? navigation.matcher
        : [navigation.matcher];

      for (const item of items) {
        matchers.push(item);
      }
    }
  }

  return matchers;
}

function createIntegrationPlugin(integration: FarmIntegration): FarmPlugin {
  const routes = [...(integration.routes || [])];
  const middleware = [...(integration.middleware || [])];

  return {
    name: `farm:integration:${integration.category}:${integration.type}`,
    enforce: "pre",

    async init() {
      if (!integration.log) {
        return;
      }

      for (const route of routes) {
        await integration.log({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "registered",
          route: {
            kind: "route",
            path: route.path,
            methods: route.methods,
          },
          context: new Map(),
        });
      }

      for (const entry of middleware) {
        await integration.log({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "registered",
          route: {
            kind: "middleware",
            path: normalizeMatcher(entry.matcher),
            methods: ["ALL"],
          },
          context: new Map(),
        });
      }
    },

    async beforeRequest(req, res, context) {
      const fullUrl = `http://${req.headers.host || "localhost"}${req.url || "/"}`;
      const url = new URL(fullUrl);
      const pathname = url.pathname;
      const requestId = getRequestId(req);
      let bodyLoaded = false;
      let requestBody: Buffer | undefined;

      const getRequestBody = async () => {
        if (!bodyLoaded) {
          bodyLoaded = true;
          if (req.method && req.method !== "GET" && req.method !== "HEAD") {
            requestBody = await readRequestBody(req);
          }
        }

        return requestBody;
      };

      const createHandlerRequest = async () => {
        return createWebRequest(req, fullUrl, await getRequestBody());
      };

      for (const entry of middleware) {
        const params = resolveMatcherParams(entry.matcher, pathname);
        if (!params) {
          continue;
        }

        const request = await createHandlerRequest();
        const handlerContext = createIntegrationHandlerContext({
          integration,
          route: {
            kind: "middleware",
            path: normalizeMatcher(entry.matcher),
            methods: ["ALL"],
          },
          request,
          rawRequest: req,
          params,
          pathname,
          requestId,
          pluginContext: context,
        });
        const startedAt = Date.now();
        await integration.log?.({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "request:start",
          route: {
            kind: "middleware",
            path: normalizeMatcher(entry.matcher),
            methods: ["ALL"],
          },
          request,
          requestId,
          context: handlerContext.requestContext.snapshot(),
        });

        try {
          const response = await entry.handler(request, handlerContext);
          if (response) {
            await sendWebResponse(res, response);
            await integration.log?.({
              category: integration.category,
              slot: integration.category,
              type: integration.type,
              phase: "request:end",
              route: {
                kind: "middleware",
                path: normalizeMatcher(entry.matcher),
                methods: ["ALL"],
              },
              request,
              response,
              requestId,
              durationMs: Date.now() - startedAt,
              context: handlerContext.requestContext.snapshot(),
            });
            return;
          }

          await integration.log?.({
            category: integration.category,
            slot: integration.category,
            type: integration.type,
            phase: "request:end",
            route: {
              kind: "middleware",
              path: normalizeMatcher(entry.matcher),
              methods: ["ALL"],
            },
            request,
            requestId,
            durationMs: Date.now() - startedAt,
            context: handlerContext.requestContext.snapshot(),
          });
        } catch (error) {
          await integration.log?.({
            category: integration.category,
            slot: integration.category,
            type: integration.type,
            phase: "request:error",
            route: {
              kind: "middleware",
              path: normalizeMatcher(entry.matcher),
              methods: ["ALL"],
            },
            request,
            requestId,
            durationMs: Date.now() - startedAt,
            error,
            context: handlerContext.requestContext.snapshot(),
          });
          throw error;
        }
      }

      for (const route of routes) {
        const params =
          matchesMethod(route.methods, req.method)
            ? extractPathParams(route.path, pathname)
            : null;
        if (!params) {
          continue;
        }

        const request = await createHandlerRequest();
        const handlerContext = createIntegrationHandlerContext({
          integration,
          route: {
            kind: "route",
            path: route.path,
            methods: route.methods,
          },
          request,
          rawRequest: req,
          params,
          pathname,
          requestId,
          pluginContext: context,
        });
        const startedAt = Date.now();
        await integration.log?.({
          category: integration.category,
          slot: integration.category,
          type: integration.type,
          phase: "request:start",
          route: {
            kind: "route",
            path: route.path,
            methods: route.methods,
          },
          request,
          requestId,
          context: handlerContext.requestContext.snapshot(),
        });

        try {
          const response = await route.handler(request, handlerContext);
          await sendWebResponse(res, response);
          await integration.log?.({
            category: integration.category,
            slot: integration.category,
            type: integration.type,
            phase: "request:end",
            route: {
              kind: "route",
              path: route.path,
              methods: route.methods,
            },
            request,
            response,
            requestId,
            durationMs: Date.now() - startedAt,
            context: handlerContext.requestContext.snapshot(),
          });
          return;
        } catch (error) {
          await integration.log?.({
            category: integration.category,
            slot: integration.category,
            type: integration.type,
            phase: "request:error",
            route: {
              kind: "route",
              path: route.path,
              methods: route.methods,
            },
            request,
            requestId,
            durationMs: Date.now() - startedAt,
            error,
            context: handlerContext.requestContext.snapshot(),
          });
          throw error;
        }
      }
    },
  };
}

function createIntegrationHandlerContext(input: {
  integration: FarmIntegration;
  route: FarmIntegrationHandlerContext["route"];
  request: Request;
  rawRequest: FarmRequest;
  params: FarmIntegrationRouteParams;
  pathname: string;
  requestId: string;
  pluginContext: FarmPluginContext;
}): FarmIntegrationHandlerContext {
  return {
    request: input.request,
    requestId: input.requestId,
    url: new URL(input.request.url),
    pathname: input.pathname,
    method: input.request.method,
    params: input.params,
    integration: {
      category: input.integration.category,
      slot: input.integration.category,
      type: input.integration.type,
      instance: input.integration.instance,
    },
    route: input.route,
    requestContext: createIntegrationRequestContextStore(
      input.rawRequest,
      input.request,
      input.pluginContext,
    ),
    config: input.pluginContext.config,
    isDev: input.pluginContext.isDev,
    isProd: input.pluginContext.isProd,
  };
}

function createIntegrationRequestContextStore(
  rawRequest: FarmRequest,
  request: Request,
  pluginContext: FarmPluginContext,
): FarmIntegrationRequestContextStore {
  return {
    get(key) {
      const requestValue = pluginContext.requestContext.get(request, key);
      if (requestValue !== undefined) {
        return requestValue;
      }

      return pluginContext.requestContext.get(rawRequest, key);
    },
    set(key, value, options) {
      pluginContext.requestContext.set(rawRequest, key, value, options);
      pluginContext.requestContext.set(request, key, value, options);
    },
    has(key) {
      return (
        pluginContext.requestContext.has(request, key) ||
        pluginContext.requestContext.has(rawRequest, key)
      );
    },
    delete(key) {
      const deletedRequest = pluginContext.requestContext.delete(request, key);
      const deletedRaw = pluginContext.requestContext.delete(rawRequest, key);
      return deletedRequest || deletedRaw;
    },
    clear() {
      pluginContext.requestContext.clear(rawRequest);
      pluginContext.requestContext.clear(request);
    },
    snapshot(options) {
      const merged = pluginContext.requestContext.getAll(rawRequest, options);
      const requestSnapshot = pluginContext.requestContext.getAll(request, options);
      for (const [key, value] of requestSnapshot) {
        merged.set(key, value);
      }
      return merged;
    },
  };
}

function createWebRequest(req: FarmRequest, fullUrl: string, body?: Buffer): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }

  return new Request(fullUrl, {
    method: req.method,
    headers,
    body: body as BodyInit | undefined,
  });
}

async function sendWebResponse(res: FarmResponse, response: Response): Promise<void> {
  res.statusCode = response.status;

  const responseHeaders = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = responseHeaders.getSetCookie?.() || [];
  if (setCookies.length > 0) {
    res.setHeader("Set-Cookie", setCookies);
  }

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie" && setCookies.length > 0) {
      return;
    }
    res.setHeader(key, value);
  });

  const body = await response.arrayBuffer();
  res.end(Buffer.from(body));
}

function matchesMethod(methods: readonly string[], method: string | undefined): boolean {
  if (!method) {
    return false;
  }

  return methods.some((item) => item.toUpperCase() === method.toUpperCase());
}

function matchesMatcher(matcher: string | readonly string[] | undefined, pathname: string): boolean {
  return resolveMatcherParams(matcher, pathname) !== null;
}

function resolveMatcherParams(
  matcher: string | readonly string[] | undefined,
  pathname: string,
): FarmIntegrationRouteParams | null {
  if (!matcher) {
    return {};
  }

  const list = Array.isArray(matcher) ? matcher : [matcher];
  for (const item of list) {
    if (item === "/(.*)" || item === "*") {
      return {};
    }
    if (item.endsWith("(.*)")) {
      const prefix = item.slice(0, -4);
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return {};
      }
      continue;
    }
    const params = extractPathParams(item, pathname);
    if (params) {
      return params;
    }
  }

  return null;
}

function matchesPath(pattern: string, pathname: string): boolean {
  return extractPathParams(pattern, pathname) !== null;
}

function extractPathParams(
  pattern: string,
  pathname: string,
): FarmIntegrationRouteParams | null {
  const routeSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);
  const params: FarmIntegrationRouteParams = {};

  let routeIndex = 0;
  let pathIndex = 0;

  while (routeIndex < routeSegments.length && pathIndex < pathSegments.length) {
    const routeSegment = routeSegments[routeIndex];
    const pathSegment = pathSegments[pathIndex];

    if (isCatchAllSegment(routeSegment)) {
      params[getSegmentParamName(routeSegment)] = pathSegments
        .slice(pathIndex)
        .map((segment) => decodeURIComponent(segment));
      return params;
    }

    if (isDynamicSegment(routeSegment)) {
      params[getSegmentParamName(routeSegment)] = decodeURIComponent(pathSegment);
      routeIndex += 1;
      pathIndex += 1;
      continue;
    }

    if (routeSegment !== pathSegment) {
      return null;
    }

    routeIndex += 1;
    pathIndex += 1;
  }

  if (routeIndex === routeSegments.length && pathIndex === pathSegments.length) {
    return params;
  }

  if (routeIndex === routeSegments.length - 1 && isCatchAllSegment(routeSegments[routeIndex])) {
    params[getSegmentParamName(routeSegments[routeIndex])] = [];
    return params;
  }

  return null;
}

function splitPath(value: string): string[] {
  return value.split("/").filter(Boolean);
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

function isCatchAllSegment(segment: string): boolean {
  return segment.startsWith("[...") && segment.endsWith("]");
}

function getSegmentParamName(segment: string): string {
  if (isCatchAllSegment(segment)) {
    return segment.slice(4, -1);
  }

  return segment.slice(1, -1);
}

function getRequestId(req: FarmRequest): string {
  const headerValue = req.headers["x-request-id"];
  if (Array.isArray(headerValue)) {
    return headerValue[0] || String(Date.now());
  }
  return headerValue || String(Date.now());
}

async function readRequestBody(req: FarmRequest): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function normalizeMatcher(matcher: string | readonly string[] | undefined): string {
  if (!matcher) {
    return "/(.*)";
  }
  return typeof matcher === "string" ? matcher : matcher.join(", ");
}
