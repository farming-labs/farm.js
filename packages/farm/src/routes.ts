import { createElement, type ComponentType } from "react";
import type { LayoutProps, Metadata, PageProps, ParsedRoute, RouteModule } from "./types";

export type ProgrammaticRouteRenderMode = "static" | "dynamic";
export type ProgrammaticRouteMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "OPTIONS";

export type ProgrammaticRoutePrimitive = string | number | boolean;
export type ProgrammaticStaticPathParams = Record<
  string,
  ProgrammaticRoutePrimitive | readonly ProgrammaticRoutePrimitive[]
>;
export type ProgrammaticStaticPath =
  | string
  | readonly ProgrammaticRoutePrimitive[]
  | ProgrammaticStaticPathParams;
export type ProgrammaticStaticPaths = () =>
  | readonly ProgrammaticStaticPath[]
  | Promise<readonly ProgrammaticStaticPath[]>;

export interface ProgrammaticRouteSchema<TOutput = unknown> {
  parse(value: unknown): TOutput;
}

export type InferProgrammaticRouteSchema<TSchema, TFallback> =
  TSchema extends ProgrammaticRouteSchema<infer TOutput> ? TOutput : TFallback;

export type ProgrammaticRouteParamsFallback = Record<string, string>;
export type ProgrammaticRouteSearchFallback = Record<string, string | string[] | undefined>;

export type ProgrammaticRouteComponentProps<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
> = Omit<PageProps, "params" | "searchParams"> & {
  params: TParams;
  search: TSearch;
  searchParams: Promise<TSearch>;
};

export interface ProgrammaticPageRoute<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
> {
  kind: "page";
  path: string;
  component: ComponentType<any>;
  params?: ProgrammaticRouteSchema<TParams>;
  search?: ProgrammaticRouteSchema<TSearch>;
  render?: ProgrammaticRouteRenderMode;
  staticPaths?: ProgrammaticStaticPaths;
  revalidate?: number | false;
  ppr?: boolean;
  metadata?: Metadata & Record<string, any>;
  generateMetadata?: RouteModule["generateMetadata"];
}

export interface ProgrammaticLayoutRoute {
  kind: "layout";
  path: string;
  component: ComponentType<LayoutProps>;
  metadata?: Metadata & Record<string, any>;
  generateMetadata?: (props: { params: Record<string, string> }) => Promise<Metadata> | Metadata;
}

export type ProgrammaticApiRouteOptions = Partial<Record<ProgrammaticRouteMethod, any>> & {
  render?: ProgrammaticRouteRenderMode;
};

export interface ProgrammaticApiRoute {
  kind: "api";
  path: string;
  methods: Partial<Record<ProgrammaticRouteMethod, any>>;
  render?: ProgrammaticRouteRenderMode;
}

export interface ProgrammaticRedirectRoute {
  kind: "redirect";
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
}

export type ProgrammaticRouteDefinition =
  | ProgrammaticPageRoute<any, any>
  | ProgrammaticLayoutRoute
  | ProgrammaticApiRoute
  | ProgrammaticRedirectRoute;

export interface ProgrammaticRouteManifest {
  readonly __farmRoutes: true;
  routes: ProgrammaticRouteDefinition[];
}

export interface ProgrammaticRouteBuilder {
  page(
    path: string,
    options: Omit<ProgrammaticPageRoute<any, any>, "kind" | "path">,
  ): ProgrammaticPageRoute;
  layout(
    path: string,
    options: Omit<ProgrammaticLayoutRoute, "kind" | "path">,
  ): ProgrammaticLayoutRoute;
  api(path: string, options: ProgrammaticApiRouteOptions): ProgrammaticApiRoute;
  redirect(
    source: string,
    destination: string,
    options?: Omit<ProgrammaticRedirectRoute, "kind" | "source" | "destination">,
  ): ProgrammaticRedirectRoute;
}

export type ProgrammaticRouteFactory = (
  builder: ProgrammaticRouteBuilder,
) => readonly ProgrammaticRouteDefinition[];

export type CreateRouteOptions<
  TParamsSchema extends ProgrammaticRouteSchema<any> | undefined = undefined,
  TSearchSchema extends ProgrammaticRouteSchema<any> | undefined = undefined,
> = Omit<
  ProgrammaticPageRoute<
    InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
    InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>
  >,
  "kind" | "path" | "component" | "params" | "search"
> & {
  params?: TParamsSchema;
  search?: TSearchSchema;
  component: ComponentType<
    ProgrammaticRouteComponentProps<
      InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
      InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>
    >
  >;
};

const FARM_ROUTES_BRAND = Symbol.for("farm.routes");
export const PROGRAMMATIC_ROUTE_FILE_NAMES = [
  "farm.route.ts",
  "farm.route.tsx",
  "farm.route.js",
  "farm.route.jsx",
  "farm.routes.ts",
  "farm.routes.tsx",
  "farm.routes.js",
  "farm.routes.jsx",
  "routes.ts",
  "routes.tsx",
  "routes.js",
  "routes.jsx",
];

export function defineRoutes(
  input: readonly ProgrammaticRouteDefinition[] | ProgrammaticRouteFactory,
): ProgrammaticRouteManifest {
  const routes = typeof input === "function" ? input(routesBuilder) : input;
  const manifest = {
    __farmRoutes: true as const,
    routes: routes.map(normalizeProgrammaticRoute),
  };

  Object.defineProperty(manifest, FARM_ROUTES_BRAND, {
    value: true,
    enumerable: false,
  });

  return manifest;
}

export const routesBuilder: ProgrammaticRouteBuilder = {
  page(path, options) {
    return normalizeProgrammaticRoute({
      kind: "page",
      path,
      ...options,
    }) as ProgrammaticPageRoute;
  },
  layout(path, options) {
    return normalizeProgrammaticRoute({
      kind: "layout",
      path,
      ...options,
    }) as ProgrammaticLayoutRoute;
  },
  api(path, options) {
    const { render, ...methods } = options;
    return normalizeProgrammaticRoute({
      kind: "api",
      path,
      render,
      methods: normalizeApiMethods(methods),
    }) as ProgrammaticApiRoute;
  },
  redirect(source, destination, options = {}) {
    return normalizeProgrammaticRoute({
      kind: "redirect",
      source,
      destination,
      ...options,
    }) as ProgrammaticRedirectRoute;
  },
};

export const page = routesBuilder.page;
export const layout = routesBuilder.layout;
export const api = routesBuilder.api;
export const redirect = routesBuilder.redirect;

export function createRoute<
  TParamsSchema extends ProgrammaticRouteSchema<any> | undefined = undefined,
  TSearchSchema extends ProgrammaticRouteSchema<any> | undefined = undefined,
>(
  path: string,
  options: CreateRouteOptions<TParamsSchema, TSearchSchema>,
): ProgrammaticPageRoute<
  InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
  InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>
> {
  return routesBuilder.page(path, options) as ProgrammaticPageRoute<
    InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
    InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>
  >;
}

export function isProgrammaticRoutesFileName(fileName: string): boolean {
  const normalized = fileName.replace(/\\/g, "/");
  const baseName = normalized.split("/").pop() || normalized;
  return PROGRAMMATIC_ROUTE_FILE_NAMES.includes(baseName);
}

export function getProgrammaticRouteManifest(
  mod: Record<string, any> | null | undefined,
): ProgrammaticRouteManifest | null {
  if (!mod) return null;

  const candidates = [mod.default, mod.routes, mod.Route];
  for (const candidate of candidates) {
    if (isProgrammaticRouteManifest(candidate)) {
      return candidate;
    }
    if (isProgrammaticRouteDefinition(candidate)) {
      return defineRoutes([candidate]);
    }
    if (Array.isArray(candidate)) {
      return defineRoutes(candidate as ProgrammaticRouteDefinition[]);
    }
  }

  const routeDefinitions = Object.values(mod).filter(isProgrammaticRouteDefinition);
  if (routeDefinitions.length > 0) {
    return defineRoutes(routeDefinitions);
  }

  return null;
}

export function isProgrammaticRouteManifest(value: unknown): value is ProgrammaticRouteManifest {
  return (
    !!value &&
    typeof value === "object" &&
    (value as ProgrammaticRouteManifest).__farmRoutes === true &&
    Array.isArray((value as ProgrammaticRouteManifest).routes)
  );
}

export function isProgrammaticRouteDefinition(
  value: unknown,
): value is ProgrammaticRouteDefinition {
  if (!value || typeof value !== "object") {
    return false;
  }

  const kind = (value as { kind?: unknown }).kind;
  return kind === "page" || kind === "layout" || kind === "api" || kind === "redirect";
}

export function createProgrammaticRouteModuleId(
  filePath: string,
  kind: "page" | "layout",
  routePath: string,
): string {
  return `${filePath}?farm-route=${kind}:${encodeURIComponent(normalizeRoutePath(routePath))}`;
}

export function parseProgrammaticRouteModuleId(moduleId: string): {
  filePath: string;
  kind: "page" | "layout";
  routePath: string;
} | null {
  const queryIndex = moduleId.indexOf("?");
  if (queryIndex === -1) {
    return null;
  }

  const filePath = moduleId.slice(0, queryIndex);
  const params = new URLSearchParams(moduleId.slice(queryIndex + 1));
  const value = params.get("farm-route");
  if (!value) {
    return null;
  }

  const separator = value.indexOf(":");
  if (separator === -1) {
    return null;
  }

  const kind = value.slice(0, separator);
  if (kind !== "page" && kind !== "layout") {
    return null;
  }

  return {
    filePath,
    kind,
    routePath: normalizeRoutePath(value.slice(separator + 1)),
  };
}

export function parseProgrammaticRoutePath(
  routePath: string,
  type: ParsedRoute["type"] = "page",
): ParsedRoute {
  const fileName = type === "layout" ? "layout.tsx" : "page.tsx";
  const normalized = normalizeRoutePath(routePath);
  const filePath =
    normalized === "/" ? fileName : `${normalized.slice(1).replace(/\/+$/, "")}/${fileName}`;

  return {
    filePath,
    type,
    segments: normalized === "/" ? [] : normalized.slice(1).split("/").map(parseRouteSegment),
  };
}

export function createRouteModuleFromProgrammaticPage(route: ProgrammaticPageRoute): RouteModule {
  const mod: RouteModule = {
    default: createProgrammaticPageComponent(route),
  };

  if (route.params || route.search) {
    (mod as any).__farmRouteSchemas = {
      params: route.params,
      search: route.search,
    };
    (mod as any).__farmRouteParsesProps = true;
  }

  if (route.render === "static" || route.staticPaths) {
    mod.ssg = true;
    mod.dynamic = "force-static";
  } else if (route.render === "dynamic") {
    mod.ssg = false;
    mod.dynamic = "force-dynamic";
  }

  if (typeof route.revalidate !== "undefined") {
    mod.revalidate = route.revalidate;
  }

  if (route.ppr) {
    mod.ppr = true;
  }

  if (route.metadata) {
    mod.metadata = route.metadata;
  }

  if (route.generateMetadata) {
    mod.generateMetadata = route.generateMetadata;
  }

  if (route.staticPaths) {
    mod.getStaticPaths = async () => normalizeStaticPaths(route.path, await route.staticPaths!());
  }

  return mod;
}

export function createLayoutModuleFromProgrammaticLayout(route: ProgrammaticLayoutRoute) {
  return {
    default: route.component,
    metadata: route.metadata,
    generateMetadata: route.generateMetadata,
  };
}

export function scanProgrammaticPagePaths(source: string): string[] {
  const paths = new Set<string>();
  const callRe = /\b(?:page|createRoute)\s*\(\s*(["'`])([^"'`]+)\1/g;

  for (const match of source.matchAll(callRe)) {
    if (match[2]) {
      paths.add(normalizeRoutePath(match[2]));
    }
  }

  return Array.from(paths);
}

function createProgrammaticPageComponent(route: ProgrammaticPageRoute): ComponentType<PageProps> {
  if (!route.params && !route.search) {
    return route.component as ComponentType<PageProps>;
  }

  const Component = route.component;

  const FarmProgrammaticPage = async function FarmProgrammaticPage(props: PageProps) {
    const rawSearch = await props.searchParams;
    const params = parseProgrammaticSchema(route.params, props.params, "params", route.path);
    const search = parseProgrammaticSchema(route.search, rawSearch, "search", route.path);

    return createElement(Component, {
      ...props,
      params,
      search,
      searchParams: Promise.resolve(search),
    });
  };

  return FarmProgrammaticPage as unknown as ComponentType<PageProps>;
}

function parseProgrammaticSchema<TFallback>(
  schema: ProgrammaticRouteSchema<any> | undefined,
  value: TFallback,
  label: string,
  routePath: string,
): unknown {
  if (!schema) {
    return value;
  }

  try {
    return schema.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} for route "${routePath}": ${message}`);
  }
}

function normalizeProgrammaticRoute(
  route: ProgrammaticRouteDefinition,
): ProgrammaticRouteDefinition {
  if (route.kind === "redirect") {
    return {
      ...route,
      source: normalizeRoutePath(route.source),
    };
  }

  if (route.kind === "api") {
    return {
      ...route,
      path: normalizeRoutePath(route.path),
      methods: normalizeApiMethods(route.methods),
    };
  }

  return {
    ...route,
    path: normalizeRoutePath(route.path),
  };
}

function normalizeRoutePath(routePath: string): string {
  const withSlash = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const withoutTrailing = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
  return withoutTrailing || "/";
}

function parseRouteSegment(segment: string): ParsedRoute["segments"][number] {
  if (segment.startsWith("[") && segment.endsWith("]")) {
    let name = segment.slice(1, -1);
    let isOptional = false;
    let isCatchAll = false;

    if (name.startsWith("[") && name.endsWith("]")) {
      isOptional = true;
      name = name.slice(1, -1);
    }

    if (name.startsWith("...")) {
      isCatchAll = true;
      name = name.slice(3);
    }

    return {
      segment: name,
      isDynamic: true,
      isOptional,
      isCatchAll,
    };
  }

  return {
    segment,
    isDynamic: false,
    isOptional: false,
    isCatchAll: false,
  };
}

function normalizeApiMethods(
  methods: Record<string, any>,
): Partial<Record<ProgrammaticRouteMethod, any>> {
  const normalized: Partial<Record<ProgrammaticRouteMethod, any>> = {};

  for (const [method, handler] of Object.entries(methods)) {
    const normalizedMethod = method.toUpperCase() as ProgrammaticRouteMethod;
    if (handler && isProgrammaticRouteMethod(normalizedMethod)) {
      normalized[normalizedMethod] = handler;
    }
  }

  return normalized;
}

function isProgrammaticRouteMethod(method: string): method is ProgrammaticRouteMethod {
  return (
    method === "GET" ||
    method === "HEAD" ||
    method === "POST" ||
    method === "PUT" ||
    method === "DELETE" ||
    method === "PATCH" ||
    method === "OPTIONS"
  );
}

function normalizeStaticPaths(
  routePath: string,
  paths: readonly ProgrammaticStaticPath[],
): Record<string, string>[] {
  const dynamicSegments = parseProgrammaticRoutePath(routePath).segments.filter(
    (segment) => segment.isDynamic,
  );

  return paths.map((entry) => {
    if (typeof entry === "string" || Array.isArray(entry)) {
      if (dynamicSegments.length !== 1) {
        throw new Error(
          `staticPaths for "${routePath}" must return objects when the route has ${dynamicSegments.length} dynamic params.`,
        );
      }

      const value = Array.isArray(entry) ? entry.join("/") : entry;
      return { [dynamicSegments[0].segment]: String(value) };
    }

    return Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(String).join("/") : String(value),
      ]),
    );
  });
}
