import type { ComponentType, ReactNode } from "react";
import type { FarmPlugin, FarmPluginContext } from "./plugin";
import type { FarmRequest, FarmResponse } from "./types";

export type FarmIntegrationSlot = "auth" | "payment" | "monitoring" | "logging" | (string & {});

export interface FarmIntegrationRoute {
  path: string;
  methods: readonly string[];
  rawBody?: boolean;
  handler(request: Request): Promise<Response> | Response;
}

export interface FarmIntegrationMiddleware {
  matcher?: string | string[];
  handler(request: Request): Promise<Response | void> | Response | void;
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
  slot: FarmIntegrationSlot;
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
  slot: FarmIntegrationSlot;
  type: string;
  instance: unknown;
  log?: FarmIntegrationLogger;
  routes?: readonly FarmIntegrationRoute[];
  middleware?: readonly FarmIntegrationMiddleware[];
  providers?: readonly FarmIntegrationProvider[];
  documentNavigations?: readonly FarmIntegrationDocumentNavigation[];
  plugins?: readonly FarmPlugin[];
}

export type FarmIntegrationsUserConfig = Record<string, FarmIntegration | undefined>;

export function defineIntegration(
  integration: Omit<FarmIntegration, "kind">,
): FarmIntegration {
  return {
    kind: "farm-integration",
    ...integration,
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
    name: `farm:integration:${integration.slot}:${integration.type}`,
    enforce: "pre",

    async init() {
      if (!integration.log) {
        return;
      }

      for (const route of routes) {
        await integration.log({
          slot: integration.slot,
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
          slot: integration.slot,
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
      const requestContext = context.requestContext.getAll(req);
      const fullUrl = `http://${req.headers.host || "localhost"}${req.url || "/"}`;
      const pathname = new URL(fullUrl).pathname;

      for (const entry of middleware) {
        if (!matchesMatcher(entry.matcher, pathname)) {
          continue;
        }

        const request = await createWebRequest(req, fullUrl);
        const startedAt = Date.now();
        await integration.log?.({
          slot: integration.slot,
          type: integration.type,
          phase: "request:start",
          route: {
            kind: "middleware",
            path: normalizeMatcher(entry.matcher),
            methods: ["ALL"],
          },
          request,
          requestId: getRequestId(req),
          context: requestContext,
        });

        try {
          const response = await entry.handler(request);
          if (response) {
            await sendWebResponse(res, response);
            await integration.log?.({
              slot: integration.slot,
              type: integration.type,
              phase: "request:end",
              route: {
                kind: "middleware",
                path: normalizeMatcher(entry.matcher),
                methods: ["ALL"],
              },
              request,
              response,
              requestId: getRequestId(req),
              durationMs: Date.now() - startedAt,
              context: requestContext,
            });
            return;
          }

          await integration.log?.({
            slot: integration.slot,
            type: integration.type,
            phase: "request:end",
            route: {
              kind: "middleware",
              path: normalizeMatcher(entry.matcher),
              methods: ["ALL"],
            },
            request,
            requestId: getRequestId(req),
            durationMs: Date.now() - startedAt,
            context: requestContext,
          });
        } catch (error) {
          await integration.log?.({
            slot: integration.slot,
            type: integration.type,
            phase: "request:error",
            route: {
              kind: "middleware",
              path: normalizeMatcher(entry.matcher),
              methods: ["ALL"],
            },
            request,
            requestId: getRequestId(req),
            durationMs: Date.now() - startedAt,
            error,
            context: requestContext,
          });
          throw error;
        }
      }

      for (const route of routes) {
        if (!matchesMethod(route.methods, req.method) || !matchesPath(route.path, pathname)) {
          continue;
        }

        const request = await createWebRequest(req, fullUrl);
        const startedAt = Date.now();
        await integration.log?.({
          slot: integration.slot,
          type: integration.type,
          phase: "request:start",
          route: {
            kind: "route",
            path: route.path,
            methods: route.methods,
          },
          request,
          requestId: getRequestId(req),
          context: requestContext,
        });

        try {
          const response = await route.handler(request);
          await sendWebResponse(res, response);
          await integration.log?.({
            slot: integration.slot,
            type: integration.type,
            phase: "request:end",
            route: {
              kind: "route",
              path: route.path,
              methods: route.methods,
            },
            request,
            response,
            requestId: getRequestId(req),
            durationMs: Date.now() - startedAt,
            context: requestContext,
          });
          return;
        } catch (error) {
          await integration.log?.({
            slot: integration.slot,
            type: integration.type,
            phase: "request:error",
            route: {
              kind: "route",
              path: route.path,
              methods: route.methods,
            },
            request,
            requestId: getRequestId(req),
            durationMs: Date.now() - startedAt,
            error,
            context: requestContext,
          });
          throw error;
        }
      }
    },
  };
}

async function createWebRequest(req: FarmRequest, fullUrl: string): Promise<Request> {
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

  let body: Buffer | undefined;
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    body = await readRequestBody(req);
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
  if (!matcher) {
    return true;
  }

  const list = Array.isArray(matcher) ? matcher : [matcher];
  return list.some((item) => {
    if (item === "/(.*)" || item === "*") {
      return true;
    }
    if (item.endsWith("(.*)")) {
      const prefix = item.slice(0, -4);
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    }
    return matchesPath(item, pathname);
  });
}

function matchesPath(pattern: string, pathname: string): boolean {
  const routeSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);

  let routeIndex = 0;
  let pathIndex = 0;

  while (routeIndex < routeSegments.length && pathIndex < pathSegments.length) {
    const routeSegment = routeSegments[routeIndex];
    const pathSegment = pathSegments[pathIndex];

    if (isCatchAllSegment(routeSegment)) {
      return true;
    }

    if (isDynamicSegment(routeSegment)) {
      routeIndex += 1;
      pathIndex += 1;
      continue;
    }

    if (routeSegment !== pathSegment) {
      return false;
    }

    routeIndex += 1;
    pathIndex += 1;
  }

  if (routeIndex === routeSegments.length && pathIndex === pathSegments.length) {
    return true;
  }

  if (routeIndex === routeSegments.length - 1 && isCatchAllSegment(routeSegments[routeIndex])) {
    return true;
  }

  return false;
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
