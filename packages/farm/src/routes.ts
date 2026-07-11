import { Suspense, createElement, type ComponentType } from "react";
import {
  createFarmCacheKey,
  createRouteDataCacheTag,
  getFarmDataCache,
  type FarmCacheOptions,
  type RouteDataCacheKey,
} from "./cache";
import { getFarmRouteContext } from "./route-context";
import type {
  FarmAppContext,
  LayoutProps,
  Metadata,
  PageProps,
  ParsedRoute,
  PluginContextProps,
  RouteModule,
} from "./types";

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
export type ProgrammaticRouteMaybePromise<T> = T | Promise<T>;
export type ProgrammaticRouteDataStaleTime =
  | number
  | false
  | `${number}ms`
  | `${number}s`
  | `${number}m`
  | `${number}h`;
export type ProgrammaticRouteContext = keyof FarmAppContext extends never
  ? unknown
  : FarmAppContext;

export type ProgrammaticRouteComponentProps<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
  TData = undefined,
> = Omit<PageProps, "params" | "searchParams"> & {
  params: TParams;
  search: TSearch;
  searchParams: Promise<TSearch>;
} & ([TData] extends [undefined] ? { data?: undefined } : { data: TData });

export type ProgrammaticRouteDataContext<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
  TContext = ProgrammaticRouteContext,
> = Omit<ProgrammaticRouteComponentProps<TParams, TSearch>, "context"> & {
  context: TContext;
  pluginContext?: PluginContextProps;
};

export type ProgrammaticRouteDataCacheContext<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
  TBefore = unknown,
  TContext = ProgrammaticRouteContext,
> = ProgrammaticRouteDataContext<TParams, TSearch, TContext> & { before: TBefore };

export type ProgrammaticRouteGuardContext<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
  TContext = ProgrammaticRouteContext,
> = ProgrammaticRouteDataContext<TParams, TSearch, TContext>;

export type ProgrammaticRouteGuard<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
  TContext = ProgrammaticRouteContext,
> = (
  context: ProgrammaticRouteGuardContext<TParams, TSearch, TContext>,
) => ProgrammaticRouteMaybePromise<void>;

export type ProgrammaticRouteErrorComponentProps<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
> = Partial<ProgrammaticRouteComponentProps<TParams, TSearch>> & {
  error: unknown;
};

export type ProgrammaticRoutePendingComponentProps<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
> = Partial<ProgrammaticRouteComponentProps<TParams, TSearch>>;

export type ProgrammaticRouteDataCacheKeys<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
  TBefore = unknown,
  TContext = ProgrammaticRouteContext,
> =
  | readonly string[]
  | ((
      context: ProgrammaticRouteDataCacheContext<TParams, TSearch, TBefore, TContext>,
    ) => ProgrammaticRouteMaybePromise<readonly string[]>);

export interface ProgrammaticRouteDataHooks<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
  TBefore = unknown,
  TData = unknown,
  TContext = ProgrammaticRouteContext,
> {
  key?: (
    context: ProgrammaticRouteDataCacheContext<TParams, TSearch, TBefore, TContext>,
  ) => ProgrammaticRouteMaybePromise<RouteDataCacheKey | null | undefined>;
  staleTime?: ProgrammaticRouteDataStaleTime;
  tags?: ProgrammaticRouteDataCacheKeys<TParams, TSearch, TBefore, TContext>;
  paths?: ProgrammaticRouteDataCacheKeys<TParams, TSearch, TBefore, TContext>;
  before?: (
    context: ProgrammaticRouteDataContext<TParams, TSearch, TContext>,
  ) => ProgrammaticRouteMaybePromise<TBefore>;
  main: (
    context: ProgrammaticRouteDataContext<TParams, TSearch, TContext> & { before: TBefore },
  ) => ProgrammaticRouteMaybePromise<TData>;
  after?: (
    context: ProgrammaticRouteDataContext<TParams, TSearch, TContext> & {
      before: TBefore;
      data: TData;
    },
  ) => ProgrammaticRouteMaybePromise<void>;
}

export type InferProgrammaticRouteData<TDataHooks> =
  TDataHooks extends ProgrammaticRouteDataHooks<any, any, any, infer TData>
    ? Awaited<TData>
    : undefined;

export interface ProgrammaticPageRoute<
  TParams = ProgrammaticRouteParamsFallback,
  TSearch = ProgrammaticRouteSearchFallback,
  TDataHooks extends ProgrammaticRouteDataHooks<TParams, TSearch, any, any, any> | undefined =
    | ProgrammaticRouteDataHooks<TParams, TSearch, any, any, any>
    | undefined,
  TContext = ProgrammaticRouteContext,
> {
  kind: "page";
  path: string;
  component: ComponentType<any>;
  params?: ProgrammaticRouteSchema<TParams>;
  search?: ProgrammaticRouteSchema<TSearch>;
  guard?: ProgrammaticRouteGuard<TParams, TSearch, TContext>;
  data?: TDataHooks;
  pending?: ComponentType<ProgrammaticRoutePendingComponentProps<TParams, TSearch>>;
  error?: ComponentType<ProgrammaticRouteErrorComponentProps<TParams, TSearch>>;
  notFound?: ComponentType<ProgrammaticRouteErrorComponentProps<TParams, TSearch>>;
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
  TDataHooks extends
    | ProgrammaticRouteDataHooks<
        InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
        InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>,
        any,
        any,
        any
      >
    | undefined = undefined,
> = Omit<
  ProgrammaticPageRoute<
    InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
    InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>,
    TDataHooks
  >,
  "kind" | "path" | "component" | "params" | "search" | "data" | "guard"
> & {
  params?: TParamsSchema;
  search?: TSearchSchema;
  guard?: ProgrammaticRouteGuard<
    InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
    InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>
  >;
  data?: TDataHooks;
  component: ComponentType<
    ProgrammaticRouteComponentProps<
      InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
      InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>,
      InferProgrammaticRouteData<TDataHooks>
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
  TDataHooks extends
    | ProgrammaticRouteDataHooks<
        InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
        InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>,
        any,
        any,
        any
      >
    | undefined = undefined,
>(
  path: string,
  options: CreateRouteOptions<TParamsSchema, TSearchSchema, TDataHooks>,
): ProgrammaticPageRoute<
  InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
  InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>,
  TDataHooks
> {
  return routesBuilder.page(path, options) as unknown as ProgrammaticPageRoute<
    InferProgrammaticRouteSchema<TParamsSchema, ProgrammaticRouteParamsFallback>,
    InferProgrammaticRouteSchema<TSearchSchema, ProgrammaticRouteSearchFallback>,
    TDataHooks
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

  if (route.params || route.search || route.guard || route.data) {
    (mod as any).__farmRouteSchemas = {
      params: route.params,
      search: route.search,
    };
    (mod as any).__farmRouteGuard = route.guard;
    (mod as any).__farmRouteData = route.data;
    (mod as any).__farmRouteParsesProps = true;
    (mod as any).__farmResolveRouteProps = (props: PageProps) =>
      resolveProgrammaticRouteProps(route, props);
  }

  if (route.pending || route.error || route.notFound) {
    (mod as any).__farmRouteComponents = {
      pending: route.pending,
      error: route.error,
      notFound: route.notFound,
    };
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
  if (
    !route.params &&
    !route.search &&
    !route.guard &&
    !route.data &&
    !route.pending &&
    !route.error &&
    !route.notFound
  ) {
    return route.component as ComponentType<PageProps>;
  }

  const Component = route.component;

  const FarmProgrammaticPageContent = async function FarmProgrammaticPageContent(props: PageProps) {
    try {
      const resolvedProps = isProgrammaticRoutePropsResolved(props)
        ? props
        : await resolveProgrammaticRouteProps(route, props);

      return createElement(Component, stripProgrammaticRoutePropsMarker(resolvedProps));
    } catch (error) {
      if (isProgrammaticRedirectSignal(error)) {
        throw error;
      }

      if (isProgrammaticNotFoundSignal(error) && route.notFound) {
        return createElement(route.notFound, createProgrammaticRouteErrorProps(error, props));
      }

      if (route.error) {
        return createElement(route.error, createProgrammaticRouteErrorProps(error, props));
      }

      throw error;
    }
  };

  if (route.pending) {
    const PendingComponent = route.pending;
    const PageContent = FarmProgrammaticPageContent as unknown as ComponentType<PageProps>;
    const FarmProgrammaticPage = function FarmProgrammaticPage(props: PageProps) {
      return createElement(
        Suspense,
        {
          fallback: createElement(PendingComponent, createProgrammaticRoutePendingProps(props)),
        },
        createElement(PageContent, props),
      );
    };

    return FarmProgrammaticPage as unknown as ComponentType<PageProps>;
  }

  return FarmProgrammaticPageContent as unknown as ComponentType<PageProps>;
}

function createProgrammaticRoutePendingProps(
  props: PageProps,
): ProgrammaticRoutePendingComponentProps {
  return {
    params: props.params,
    searchParams: props.searchParams,
    path: props.path,
  };
}

function createProgrammaticRouteErrorProps(
  error: unknown,
  props: PageProps,
): ProgrammaticRouteErrorComponentProps {
  return {
    error,
    params: props.params,
    searchParams: props.searchParams,
    path: props.path,
  };
}

function isProgrammaticRedirectSignal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("FARM_REDIRECT;");
}

function isProgrammaticNotFoundSignal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return digest === "FARM_NOT_FOUND";
}

async function resolveProgrammaticRouteProps(
  route: ProgrammaticPageRoute,
  props: PageProps,
): Promise<Record<string, any> & { __farmRoutePropsResolved: true }> {
  const rawSearch = await props.searchParams;
  const params = parseProgrammaticSchema(route.params, props.params, "params", route.path);
  const search = parseProgrammaticSchema(route.search, rawSearch, "search", route.path);
  const routeContextValue = getFarmRouteContext(props);
  const pluginContext = props.context;
  const baseProps = {
    ...props,
    params,
    search,
    searchParams: Promise.resolve(search),
  };
  const routeContextProps = {
    ...baseProps,
    context: routeContextValue,
    pluginContext,
  };

  if (route.guard) {
    await route.guard(routeContextProps as any);
  }

  if (!route.data) {
    return markProgrammaticRoutePropsResolved(baseProps);
  }

  const before = route.data.before ? await route.data.before(routeContextProps as any) : undefined;
  const dataContext = {
    ...(routeContextProps as any),
    before,
  };
  const data = await resolveProgrammaticRouteData(route, route.data, dataContext);

  if (route.data.after) {
    await route.data.after({
      ...(routeContextProps as any),
      before,
      data,
    });
  }

  return markProgrammaticRoutePropsResolved({
    ...baseProps,
    data,
  });
}

async function resolveProgrammaticRouteData(
  route: ProgrammaticPageRoute,
  dataHooks: ProgrammaticRouteDataHooks<any, any, any, any>,
  context: ProgrammaticRouteDataCacheContext<any, any, any>,
): Promise<unknown> {
  if (!dataHooks?.key) {
    return dataHooks.main(context);
  }

  const routeDataKey = await dataHooks.key(context);
  if (routeDataKey == null) {
    return dataHooks.main(context);
  }

  const cacheKey = createFarmCacheKey(["route-data", routeDataKey]);
  const cacheOptions: FarmCacheOptions = {
    tags: [
      createRouteDataCacheTag(routeDataKey),
      ...(await resolveProgrammaticRouteDataKeys(dataHooks.tags, context)),
    ],
    paths: [
      ...(typeof context.path === "string" ? [context.path] : []),
      ...(await resolveProgrammaticRouteDataKeys(dataHooks.paths, context)),
    ],
    revalidate: normalizeProgrammaticRouteStaleTime(dataHooks.staleTime),
  };

  return getFarmDataCache().getOrSet(cacheKey, () => dataHooks.main(context), cacheOptions);
}

async function resolveProgrammaticRouteDataKeys(
  input: ProgrammaticRouteDataCacheKeys<any, any, any> | undefined,
  context: ProgrammaticRouteDataCacheContext<any, any, any>,
): Promise<readonly string[]> {
  if (!input) return [];
  const value = typeof input === "function" ? await input(context) : input;
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}

function normalizeProgrammaticRouteStaleTime(
  staleTime: ProgrammaticRouteDataStaleTime | undefined,
): number | false | undefined {
  if (staleTime === undefined) return undefined;
  if (staleTime === false) return false;

  if (typeof staleTime === "number") {
    if (!Number.isFinite(staleTime) || staleTime <= 0) return undefined;
    return Math.max(1, Math.ceil(staleTime / 1000));
  }

  const match = staleTime.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!match) return undefined;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;

  const unit = match[2];
  const milliseconds =
    unit === "ms"
      ? value
      : unit === "s"
        ? value * 1000
        : unit === "m"
          ? value * 60000
          : value * 3600000;

  return Math.max(1, Math.ceil(milliseconds / 1000));
}

function isProgrammaticRoutePropsResolved(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as any).__farmRoutePropsResolved === true;
}

function markProgrammaticRoutePropsResolved<T extends Record<string, any>>(
  props: T,
): T & { __farmRoutePropsResolved: true } {
  return {
    ...props,
    __farmRoutePropsResolved: true,
  };
}

function stripProgrammaticRoutePropsMarker<TProps>(props: TProps): TProps {
  if (!isProgrammaticRoutePropsResolved(props)) {
    return props;
  }

  const { __farmRoutePropsResolved, ...componentProps } = props as any;
  return componentProps;
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
