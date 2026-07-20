import React from "react";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import * as fs from "fs";
import * as path from "path";
import type {
  FarmConfig,
  FarmRequest,
  FarmResponse,
  LoadingProps,
  PageProps,
  RouteModule,
  SSGPage,
} from "../types";
import type { RouteManager } from "../routing/route-manager";
import { logger } from "../utils";
import { getClientModuleMetadata } from "../utils/client-component";
import { Writable } from "stream";
import {
  _clearCurrentMiddlewareContext,
  _clearCurrentMiddlewareData,
  _runWithMiddlewareContext,
  _runWithMiddlewareData,
} from "../middleware/server";
import { getRequestContextSnapshot } from "../request-context";
import { matchSSGPage, resolveRouteRenderingConfigFromFile } from "../ssg";
import { getIntegrationProviders, getRegisteredIntegrationAPIManifest } from "../integrations";
import { _runWithCurrentRequest, createWebRequestFromFarmRequest } from "./request";
import { createFarmCacheKey, getFarmDataCache, normalizeRevalidatePath } from "../cache";
import { emitFarmEvent } from "../observability";
import { getFarmRedirectError, isFarmNotFoundError, isFarmRedirectError } from "../navigation";
import {
  addMetadataImageReference,
  mergeMetadata,
  renderMetadataHead,
  type FarmMetadataImageReference,
  type MetadataImageKind,
} from "../metadata";
import { resolveFarmRouteContext, withFarmRouteContext } from "../route-context";
import { prepareDeferredData, snapshotDeferredData, type DeferredRecord } from "../deferred";
import { createFarmDeploymentCookie, FARM_DEPLOYMENT_ID_HEADER } from "../deployment";
import type { StaticMetadataImageInfo } from "../static-metadata-image";
import {
  _runWithFarmI18nRequest,
  getFarmI18nClientSnapshot,
  type FarmI18nClientSnapshot,
  type FarmI18nRuntime,
} from "../i18n/server";
import { createFarmLocaleCookie, getFarmLocaleVaryHeaders } from "../i18n/resolver";
import { localizeFarmHref, localizeFarmPathname } from "../i18n/routing";

let cachedClerkProvider: {
  ClerkProvider: React.ComponentType<{ children?: React.ReactNode } & Record<string, unknown>>;
} | null = null;

const importRuntimeModule = new Function("specifier", "return import(specifier);") as (
  specifier: string,
) => Promise<any>;

interface CachedSSGPage {
  html: string;
  document: boolean;
}

interface CachedPPRShell {
  html: string;
}

interface PPRShellCacheOptions {
  pathname: string;
  search: string;
  revalidate?: number;
}

function hasRequestHeader(req: FarmRequest, name: string): boolean {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function serializeInlineValue(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appendResponseHeader(res: FarmResponse, name: string, value: string): void {
  const current = res.getHeader(name);
  if (current === undefined) {
    res.setHeader(name, value);
  } else if (Array.isArray(current)) {
    res.setHeader(name, [...current.map(String), value]);
  } else {
    res.setHeader(name, [String(current), value]);
  }
}

function appendResponseVary(res: FarmResponse, value: string): void {
  const current = res.getHeader("Vary");
  const values = new Set(
    (Array.isArray(current) ? current.join(",") : String(current || ""))
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  values.add(value);
  res.setHeader("Vary", Array.from(values).join(", "));
}

function renderI18nAlternateLinks(requestPath: string, snapshot: FarmI18nClientSnapshot): string {
  if (snapshot.routing === "none") return "";
  const url = new URL(requestPath, "http://farm.local");
  const links = snapshot.locales.map((locale) => {
    const href = localizeFarmPathname(url.pathname, locale, snapshot);
    return `<link rel="alternate" hreflang="${escapeHtmlAttribute(locale)}" href="${escapeHtmlAttribute(href)}">`;
  });
  links.push(
    `<link rel="alternate" hreflang="x-default" href="${escapeHtmlAttribute(
      localizeFarmPathname(url.pathname, snapshot.defaultLocale, snapshot),
    )}">`,
  );
  return links.join("");
}

function findPPRDynamicChunkIndex(chunk: string): number {
  const markerIndexes = [
    chunk.indexOf('id="S:'),
    chunk.indexOf("id='S:"),
    chunk.indexOf("$RC("),
    chunk.indexOf("$RS("),
    chunk.indexOf("$RV("),
    chunk.indexOf("$RX("),
  ].filter((index) => index >= 0);

  if (markerIndexes.length === 0) {
    return -1;
  }

  const markerIndex = Math.min(...markerIndexes);
  const tagStart = chunk.lastIndexOf("<", markerIndex);
  return tagStart >= 0 ? tagStart : markerIndex;
}

function createPPRRefreshScript(): string {
  return `<script>(function(){if(window.__FARM_PPR_REFRESHING__)return;window.__FARM_PPR_REFRESHING__=true;function replaceRoot(html){var doc=new DOMParser().parseFromString(html,"text/html");var next=doc.getElementById("root");var current=document.getElementById("root");if(!next||!current)return;current.innerHTML=next.innerHTML;}fetch(window.location.href,{credentials:"same-origin",headers:{"x-farm-ppr-refresh":"1"}}).then(function(response){return response.ok?response.text():null;}).then(function(html){if(html)replaceRoot(html);}).catch(function(){});})();</script>`;
}

function createPreHydrationClickQueueScript(): string {
  return `<script>(function(){if(window.__FARM_PREHYDRATION_CLICK_QUEUE__)return;var queue=[];window.__FARM_PREHYDRATION_CLICK_QUEUE__=queue;window.__FARM_HYDRATED__=false;document.documentElement.dataset.farmHydrated="false";function isModified(event){return !!(event.metaKey||event.altKey||event.ctrlKey||event.shiftKey)}function closestQueuedTarget(target){while(target&&target!==document.documentElement){if(target.matches&&target.matches('button,[role="button"],input[type="button"],input[type="submit"],input[type="reset"]'))return target;target=target.parentElement}return null}document.addEventListener("click",function(event){if(window.__FARM_HYDRATED__)return;if(event.defaultPrevented||event.button!==0||isModified(event))return;var target=closestQueuedTarget(event.target);if(!target||target.closest&&target.closest("a[href]"))return;if(queue.some(function(item){return item.target===target}))return;queue.push({target:target,createdAt:Date.now()});event.preventDefault();event.stopImmediatePropagation()},true);})();</script>`;
}

function searchParamsToObject(
  searchParams: URLSearchParams,
): Record<string, string | string[] | undefined> {
  const output: Record<string, string | string[] | undefined> = {};

  searchParams.forEach((value, key) => {
    const existing = output[key];
    if (existing) {
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        output[key] = [existing, value];
      }
    } else {
      output[key] = value;
    }
  });

  return output;
}

function createDocumentFooter(options: {
  suspenseRevealFallback: string;
  refreshPPR?: boolean;
  deferredHydrationScript?: string;
}): string {
  return `</div>
  ${options.suspenseRevealFallback}
  ${options.refreshPPR ? createPPRRefreshScript() : ""}
  ${options.deferredHydrationScript || ""}
  <script type="module" src="/@farm/client.js"></script>
</body>
</html>`;
}

function createDeferredHydrationScript(records: readonly DeferredRecord[]): string {
  if (records.length === 0) return "";
  return `<script>window.__FARM_DEFERRED_DATA__=${serializeInlineValue(
    snapshotDeferredData(records),
  )};</script>`;
}

function toMiddlewareMap(input: unknown): Map<string, any> {
  if (input instanceof Map) {
    return new Map(input as Map<string, any>);
  }
  if (input && typeof input === "object") {
    return new Map(Object.entries(input as Record<string, any>));
  }
  return new Map<string, any>();
}

function isWebResponse(value: unknown): value is Response {
  return (
    typeof Response !== "undefined" &&
    value instanceof Response &&
    typeof value.arrayBuffer === "function"
  );
}

class FarmRouteErrorBoundary extends React.Component<
  {
    Fallback: React.ComponentType<any>;
    fallbackProps: Record<string, any>;
    children: React.ReactNode;
  },
  { hasError: boolean; error: unknown }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const Fallback = this.props.Fallback;
      return React.createElement(Fallback, {
        ...this.props.fallbackProps,
        error: this.state.error,
        reset: () => this.setState({ hasError: false, error: null }),
      });
    }
    return this.props.children as React.ReactElement;
  }
}

async function parseRouteModuleProps(
  routeModule: RouteModule,
  input: {
    props: PageProps;
    search: Record<string, string | string[] | undefined>;
    routePath: string;
  },
): Promise<PageProps & { search: unknown; data?: unknown; __farmRoutePropsResolved?: true }> {
  const resolveRouteProps = (routeModule as any).__farmResolveRouteProps;
  if (typeof resolveRouteProps === "function") {
    return await resolveRouteProps(input.props);
  }

  if ((routeModule as any).__farmRouteParsesProps) {
    return {
      ...input.props,
      search: input.search,
    };
  }

  const schemas = (routeModule as any).__farmRouteSchemas;
  const params = parseRouteModuleSchema(
    schemas?.params,
    input.props.params,
    "params",
    input.routePath,
  );
  const search = parseRouteModuleSchema(schemas?.search, input.search, "search", input.routePath);

  return {
    ...input.props,
    params: params as Record<string, string>,
    search,
    searchParams: Promise.resolve(search as Record<string, string | string[] | undefined>),
  };
}

function parseRouteModuleSchema(
  schema: { parse?: (value: unknown) => unknown } | undefined,
  value: unknown,
  label: string,
  routePath: string,
): unknown {
  if (!schema || typeof schema.parse !== "function") {
    return value;
  }

  try {
    return schema.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} for route "${routePath}": ${message}`);
  }
}

function createRouteStateProps(input: {
  params: Record<string, string>;
  searchParamsObject: Record<string, string | string[] | undefined>;
  path: string;
  middlewareMap: Map<string, any>;
  pluginExposedContext: Map<string, any>;
}): LoadingProps {
  return {
    params: input.params,
    search: input.searchParamsObject,
    searchParams: Promise.resolve(input.searchParamsObject),
    path: input.path,
    middleware: input.middlewareMap.size > 0 ? { data: input.middlewareMap } : undefined,
    context: input.pluginExposedContext.size > 0 ? { data: input.pluginExposedContext } : undefined,
  };
}

export class ServerRenderer {
  private config: Required<FarmConfig>;
  private routeManager: RouteManager;
  private ssgManifest: SSGPage[] = [];
  private dataCache = getFarmDataCache();
  private i18nRuntime?: FarmI18nRuntime;

  constructor(
    config: Required<FarmConfig>,
    routeManager: RouteManager,
    i18nRuntime?: FarmI18nRuntime,
  ) {
    this.config = config;
    this.routeManager = routeManager;
    this.i18nRuntime = i18nRuntime;
    this.loadSSGManifest();
  }

  async runWithRequestContext<T>(request: Request, fn: () => T | Promise<T>): Promise<T> {
    return _runWithCurrentRequest(request, () =>
      this.i18nRuntime?.config.enabled
        ? _runWithFarmI18nRequest(this.i18nRuntime, request, fn, { redirect: false })
        : fn(),
    );
  }

  async resolveRouteContext(input: {
    request: Request;
    rawRequest?: FarmRequest;
    params: Record<string, string>;
    search: Record<string, string | string[] | undefined>;
    path: string;
  }): Promise<unknown> {
    return resolveFarmRouteContext(this.config, input);
  }

  /**
   * Load SSG manifest from build output
   */
  private loadSSGManifest(): void {
    try {
      const manifestPath = path.join(this.config.root, this.config.outDir, "__ssg_manifest.json");
      if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, "utf-8");
        this.ssgManifest = JSON.parse(content);
        logger.info(`Loaded SSG manifest: ${this.ssgManifest.length} pages`);
      }
    } catch (error) {
      // No manifest in dev mode or first build
    }
  }

  /**
   * Check if a path should be served from SSG cache
   */
  private shouldServeSSG(pathname: string): SSGPage | null {
    const ssgPage = matchSSGPage(pathname, this.ssgManifest);
    if (!ssgPage) return null;

    const cached = this.getCachedSSGPage(pathname);
    if (cached && this.dataCache.isStale(cached)) {
      // Stale - needs revalidation (serve stale, regenerate in background)
      this.regenerateSSGPage(ssgPage);
    }

    return ssgPage;
  }

  private getSSGCacheKey(urlPath: string): string {
    return createFarmCacheKey(["ssg", normalizeRevalidatePath(urlPath)]);
  }

  private getPPRCacheKey(pathname: string, search = ""): string {
    return createFarmCacheKey(["ppr", normalizeRevalidatePath(pathname), search]);
  }

  private getCachedSSGPage(urlPath: string) {
    return this.dataCache.getEntry<CachedSSGPage>(this.getSSGCacheKey(urlPath), {
      allowStale: true,
    });
  }

  private cacheSSGPage(
    page: SSGPage,
    html: string,
    options: { document: boolean; createdAt?: number },
  ): void {
    this.dataCache.set(
      this.getSSGCacheKey(page.urlPath),
      { html, document: options.document },
      {
        createdAt: options.createdAt,
        paths: [page.urlPath],
        tags: ["ssg"],
        revalidate: page.revalidate ?? false,
      },
    );
  }

  private getCachedPPRShell(pathname: string, search: string) {
    return this.dataCache.getEntry<CachedPPRShell>(this.getPPRCacheKey(pathname, search));
  }

  private cachePPRShell(options: PPRShellCacheOptions, html: string): void {
    const key = this.getPPRCacheKey(options.pathname, options.search);
    this.dataCache.set(
      key,
      { html },
      {
        paths: [options.pathname],
        tags: ["ppr"],
        revalidate: options.revalidate ?? false,
      },
    );
    emitFarmEvent({
      type: "ppr.shell.cached",
      route: options.pathname,
      key,
      revalidate: options.revalidate,
    });
  }

  private getPPRShellBypassReason(
    req: FarmRequest,
    middlewareMap: Map<string, any>,
    middlewareContext: Map<string, any>,
    pluginExposedContext: Map<string, any>,
  ): string | undefined {
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return "method";
    }

    if (req.headers.cookie) {
      return "cookie";
    }

    if (req.headers.authorization) {
      return "authorization";
    }

    if (hasRequestHeader(req, "x-farm-ppr-refresh")) {
      return "refresh";
    }

    if (middlewareMap.size > 0) {
      return "middleware-data";
    }

    if (middlewareContext.size > 0) {
      return "middleware-context";
    }

    if (pluginExposedContext.size > 0) {
      return "plugin-context";
    }

    return undefined;
  }

  private getPPRHeaders(status: "hit" | "miss" | "bypass", revalidate?: number) {
    const headers: Record<string, string> = {
      "X-Farm-PPR": status,
    };

    if (status === "bypass") {
      headers["Cache-Control"] = "private, no-store";
      return headers;
    }

    if (typeof revalidate === "number" && revalidate > 0) {
      headers["Cache-Control"] = `s-maxage=${revalidate}, stale-while-revalidate`;
    }

    return headers;
  }

  private serveCachedPPRShell(res: FarmResponse, shell: CachedPPRShell, revalidate?: number): void {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    for (const [key, value] of Object.entries(this.getPPRHeaders("hit", revalidate))) {
      res.setHeader(key, value);
    }
    res.write(shell.html);
    res.end();
  }

  /**
   * Regenerate an SSG page in the background (ISR)
   */
  private async regenerateSSGPage(page: SSGPage): Promise<void> {
    try {
      // This runs in the background - don't await
      setImmediate(async () => {
        try {
          const mod = await this.routeManager.loadRouteModule(page.filePath);
          if (!mod?.default) return;

          const { layouts } = this.routeManager.matchRoute(page.urlPath);
          const layoutModules = await Promise.all(
            layouts.map((l) => this.routeManager.loadLayoutModule(l.modulePath)),
          );

          const PageComponent = mod.default;
          const pageProps = {
            params: page.params,
            searchParams: Promise.resolve({}),
            path: page.urlPath,
          };

          let pageElement = React.createElement(
            PageComponent as React.ComponentType<unknown>,
            pageProps as React.Attributes,
          );

          for (let i = layoutModules.length - 1; i >= 0; i--) {
            const layoutModule = layoutModules[i];
            const LayoutComponent = layoutModule.default;
            pageElement = React.createElement(
              LayoutComponent as React.ComponentType<unknown>,
              {
                children: pageElement,
                params: page.params,
              } as React.Attributes,
            );
          }

          const { renderToString } = await import("react-dom/server");
          const html = renderToString(await this.wrapWithIntegrationProviders(pageElement));

          this.cacheSSGPage(page, html, { document: false });

          logger.info(`ISR: Regenerated ${page.urlPath}`);
        } catch (error) {
          logger.error(`ISR regeneration failed for ${page.urlPath}: ${error}`);
        }
      });
    } catch (error) {
      logger.error(`ISR trigger failed: ${error}`);
    }
  }

  /**
   * Serve a pre-rendered SSG page
   */
  private async serveSSGPage(req: FarmRequest, res: FarmResponse, page: SSGPage): Promise<boolean> {
    // Check cache first (for ISR)
    const cached = this.getCachedSSGPage(page.urlPath);
    if (cached) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Farm-SSG", "cached");
      if (page.revalidate) {
        res.setHeader("Cache-Control", `s-maxage=${page.revalidate}, stale-while-revalidate`);
      }
      res.write(
        cached.value.document
          ? cached.value.html
          : this.createFullHTML(cached.value.html, false, page.urlPath),
      );
      res.end();
      return true;
    }

    // Try to read from file system (production)
    try {
      const htmlPath =
        page.urlPath === "/"
          ? path.join(this.config.root, this.config.outDir, "client", "index.html")
          : path.join(this.config.root, this.config.outDir, "client", page.urlPath + ".html");

      if (fs.existsSync(htmlPath)) {
        const stat = fs.statSync(htmlPath);
        const html = fs.readFileSync(htmlPath, "utf-8");
        this.cacheSSGPage(page, html, { document: true, createdAt: stat.mtimeMs });
        const fileCacheEntry = this.getCachedSSGPage(page.urlPath);
        if (fileCacheEntry && this.dataCache.isStale(fileCacheEntry)) {
          this.regenerateSSGPage(page);
        }

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Farm-SSG", "file");
        if (page.revalidate) {
          res.setHeader("Cache-Control", `s-maxage=${page.revalidate}, stale-while-revalidate`);
        }
        res.write(html);
        res.end();
        return true;
      }
    } catch (error) {
      logger.error(`Failed to serve SSG page ${page.urlPath}: ${error}`);
    }

    return false;
  }

  async renderPage(req: FarmRequest, res: FarmResponse): Promise<void> {
    const request = createWebRequestFromFarmRequest(req);
    const runtime = this.i18nRuntime;

    if (runtime?.config.enabled) {
      const resolution = runtime.resolveRequest(request);
      const varyHeaders = getFarmLocaleVaryHeaders(runtime.config, resolution);
      for (const header of varyHeaders) appendResponseVary(res, header);
      if (resolution.persist) {
        appendResponseHeader(
          res,
          "Set-Cookie",
          createFarmLocaleCookie(resolution.locale, runtime.config),
        );
      }
      if (resolution.redirect && (request.method === "GET" || request.method === "HEAD")) {
        res.statusCode = 307;
        res.setHeader("Location", resolution.redirect);
        if (varyHeaders.length > 0) res.setHeader("Cache-Control", "private, no-store");
        res.end();
        return;
      }
    }

    return this.runWithRequestContext(request, () => this.renderPageInContext(req, res));
  }

  private async renderPageInContext(req: FarmRequest, res: FarmResponse): Promise<void> {
    const renderStartTime = Date.now();
    let pathname = "/";
    let params: Record<string, string> = {};
    let layouts: Array<{ modulePath: string }> = [];
    let searchParamsObject: Record<string, string | string[] | undefined> = {};
    let middlewareMap = new Map<string, any>();
    let middlewareContext = new Map<string, any>();
    let pluginExposedContext = new Map<string, any>();
    let errorBoundaryEntry: { modulePath: string } | null = null;
    let pprRefreshRoute: string | null = null;

    const completeRender = (status = res.statusCode || 200, route = pathname) => {
      emitFarmEvent({
        type: "render.complete",
        route,
        pathname,
        status,
        durationMs: Date.now() - renderStartTime,
      });
    };

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      pathname = url.pathname;
      emitFarmEvent({ type: "render.start", route: pathname, pathname });
      searchParamsObject = searchParamsToObject(url.searchParams);

      const metadataImageMatch = this.routeManager.matchMetadataImage(pathname);
      if (metadataImageMatch) {
        await this.renderMetadataImage(req, res, {
          pathname,
          searchParamsObject,
          ...metadataImageMatch,
        });
        completeRender(res.statusCode || 200, pathname);
        return;
      }

      this.applyDeploymentHeaders(req, res);

      // Check for pre-rendered SSG page first (production only)
      if (process.env.NODE_ENV === "production") {
        const ssgPage = this.shouldServeSSG(pathname);
        if (ssgPage) {
          const served = await this.serveSSGPage(req, res, ssgPage);
          if (served) {
            completeRender(res.statusCode || 200, ssgPage.urlPath);
            return;
          }
        }
      }

      // Match route
      const match = this.routeManager.matchRoute(pathname);
      const route = match.route;
      params = match.params;
      layouts = match.layouts;

      if (!route) {
        emitFarmEvent({ type: "route.notFound", pathname });
        await this.render404(req, res);
        completeRender(404);
        return;
      }

      emitFarmEvent({
        type: "route.matched",
        pathname,
        route: route.pattern,
        params,
      });

      const loadingBoundaryEntry = this.routeManager.getMatchingLoading(pathname);
      errorBoundaryEntry = this.routeManager.getMatchingError(pathname);

      middlewareMap = toMiddlewareMap((req as any).__FARM_MIDDLEWARE_DATA__);
      middlewareContext = toMiddlewareMap((req as any).__FARM_MIDDLEWARE_CONTEXT__);
      pluginExposedContext = getRequestContextSnapshot(req as object, { exposedOnly: true });
      const currentRequest = createWebRequestFromFarmRequest(req);
      const routeContext = await this.resolveRouteContext({
        request: currentRequest,
        rawRequest: req,
        params,
        search: searchParamsObject,
        path: pathname,
      });

      // Load route module
      const routeModule = await this.routeManager.loadRouteModule(route.modulePath);

      if (!routeModule.default) {
        throw new Error(`Route module ${route.modulePath} does not export a default component`);
      }

      // Create page props with searchParams as plain object and middleware data
      const rawPageProps: PageProps = withFarmRouteContext(
        {
          params,
          searchParams: Promise.resolve(searchParamsObject),
          path: pathname,
          middleware: middlewareMap.size > 0 ? { data: middlewareMap } : undefined,
          context: pluginExposedContext.size > 0 ? { data: pluginExposedContext } : undefined,
        } as PageProps & { search: unknown },
        routeContext,
      );
      const programmaticRouteComponents = (routeModule as any).__farmRouteComponents as
        | {
            error?: React.ComponentType<any>;
            notFound?: React.ComponentType<any>;
          }
        | undefined;
      let PageComponent = routeModule.default;
      let pageProps: PageProps & {
        search: unknown;
        data?: unknown;
        error?: unknown;
        __farmRoutePropsResolved?: true;
      };

      try {
        pageProps = await parseRouteModuleProps(routeModule, {
          props: rawPageProps,
          search: searchParamsObject,
          routePath: route.pattern,
        });
      } catch (error) {
        if (isFarmRedirectError(error)) throw error;

        const routeStateProps = {
          ...rawPageProps,
          search: searchParamsObject,
          searchParams: Promise.resolve(searchParamsObject),
          error,
        };

        if (isFarmNotFoundError(error) && programmaticRouteComponents?.notFound) {
          res.statusCode = 404;
          PageComponent = programmaticRouteComponents.notFound;
          pageProps = routeStateProps;
        } else if (programmaticRouteComponents?.error) {
          res.statusCode = 500;
          PageComponent = programmaticRouteComponents.error;
          pageProps = routeStateProps;
        } else {
          throw error;
        }
      }

      const renderingConfig = await resolveRouteRenderingConfigFromFile(
        routeModule,
        route.modulePath,
      );
      const pprBypassReason = renderingConfig.ppr
        ? this.getPPRShellBypassReason(req, middlewareMap, middlewareContext, pluginExposedContext)
        : undefined;
      const canCachePPRShell = renderingConfig.ppr && !pprBypassReason;
      const pprShellOptions: PPRShellCacheOptions | undefined = canCachePPRShell
        ? {
            pathname,
            search: url.search,
            revalidate: renderingConfig.revalidate,
          }
        : undefined;

      if (renderingConfig.ppr && pprBypassReason) {
        emitFarmEvent({ type: "ppr.shell.bypass", route: pathname, reason: pprBypassReason });
        emitFarmEvent({ type: "cache.bypass", route: pathname, reason: pprBypassReason });

        if (pprBypassReason === "refresh") {
          pprRefreshRoute = pathname;
          emitFarmEvent({ type: "ppr.refresh.start", route: pathname });
        }
      }

      if (pprShellOptions) {
        const pprCacheKey = this.getPPRCacheKey(pathname, url.search);
        const cachedPPRShell = this.getCachedPPRShell(pathname, url.search);
        if (cachedPPRShell) {
          emitFarmEvent({ type: "ppr.shell.hit", route: pathname, key: pprCacheKey });
          this.serveCachedPPRShell(res, cachedPPRShell.value, renderingConfig.revalidate);
          completeRender(res.statusCode || 200, pathname);
          return;
        }
        emitFarmEvent({ type: "ppr.shell.miss", route: pathname, key: pprCacheKey });
      }

      let LoadingFallbackComponent: React.ComponentType<any> | null = null;
      if (loadingBoundaryEntry) {
        const loadingModule = await this.routeManager.loadRouteModule(
          loadingBoundaryEntry.modulePath,
        );
        if (loadingModule.default) {
          LoadingFallbackComponent = loadingModule.default;
        }
      }

      let ErrorFallbackComponent: React.ComponentType<any> | null = null;
      if (errorBoundaryEntry) {
        const errorModule = await this.routeManager.loadRouteModule(errorBoundaryEntry.modulePath);
        if (errorModule.default) {
          ErrorFallbackComponent = errorModule.default;
        }
      }

      let isClientComponent = false;
      let shouldHydrate = false;
      const moduleMetadata = getClientModuleMetadata(route.modulePath, this.config.root);
      isClientComponent = moduleMetadata.isClientComponent;
      shouldHydrate = moduleMetadata.shouldHydrate;

      (req as any).__FARM_PAGE_PATH__ = route.modulePath;
      (req as any).__FARM_ROUTE__ = pathname;
      (req as any).__FARM_IS_CLIENT_COMPONENT__ = isClientComponent;
      (req as any).__FARM_SHOULD_HYDRATE__ = shouldHydrate;
      (req as any).__FARM_LOADING_MODULE_PATH__ = loadingBoundaryEntry?.modulePath
        ? loadingBoundaryEntry.modulePath.substring(
            loadingBoundaryEntry.modulePath.indexOf("/src/app/"),
          )
        : null;
      // Store pageProps for client-side hydration (serializable version - no Promises)
      (req as any).__FARM_PROPS__ = {
        params: pageProps.params,
        search: (pageProps as any).search,
        searchParams: (pageProps as any).search,
        ...("data" in pageProps ? { data: (pageProps as any).data } : {}),
        ...((pageProps as any).__farmCanonicalPath
          ? { __farmCanonicalPath: (pageProps as any).__farmCanonicalPath }
          : {}),
        ...((pageProps as any).__farmRoutePropsResolved ? { __farmRoutePropsResolved: true } : {}),
        path: pathname,
        middleware:
          middlewareMap.size > 0
            ? {
                data: Object.fromEntries(middlewareMap),
              }
            : undefined,
        context:
          pluginExposedContext.size > 0
            ? {
                data: Object.fromEntries(pluginExposedContext),
              }
            : undefined,
      };

      // Load layout modules
      const layoutModules = await Promise.all(
        layouts.map((layout) => this.routeManager.loadLayoutModule(layout.modulePath)),
      );

      const mergedMetadata = await this.resolveRouteMetadata({
        layoutModules,
        routeModule,
        pageProps,
        pathname,
      });

      // Store metadata on request for renderWithSSR
      (req as any).__FARM_METADATA__ = mergedMetadata;

      // Get middleware data for AsyncLocalStorage
      const middlewareDataForContext = middlewareMap;

      await _runWithMiddlewareData(middlewareDataForContext, async () => {
        await _runWithMiddlewareContext(middlewareContext, async () => {
          await _runWithCurrentRequest(currentRequest, async () => {
            let pageElement = React.createElement(
              PageComponent as React.ComponentType<unknown>,
              pageProps as React.Attributes,
            );

            if (LoadingFallbackComponent) {
              const loadingFallback = React.createElement(LoadingFallbackComponent, {
                ...createRouteStateProps({
                  params,
                  searchParamsObject,
                  path: pathname,
                  middlewareMap,
                  pluginExposedContext,
                }),
              } as React.Attributes);

              pageElement = React.createElement(
                React.Suspense,
                { fallback: loadingFallback },
                pageElement,
              );
            }

            // Wrap hydratable pages in a targeted container so the client can attach
            // without re-hydrating the surrounding layout shell.
            if (isClientComponent || shouldHydrate) {
              pageElement = React.createElement(
                "div",
                { id: "__farm_page__", "data-farm-client": "true" },
                pageElement,
              );
            }

            let wrappedElement: React.ReactElement = pageElement;
            for (let i = layoutModules.length - 1; i >= 0; i--) {
              const layoutModule = layoutModules[i];
              const LayoutComponent = layoutModule.default;
              wrappedElement = React.createElement(
                LayoutComponent as React.ComponentType<unknown>,
                {
                  children: wrappedElement,
                  params,
                } as React.Attributes,
              );
            }

            if (ErrorFallbackComponent) {
              wrappedElement = React.createElement(
                FarmRouteErrorBoundary,
                {
                  Fallback: ErrorFallbackComponent,
                  fallbackProps: {
                    ...createRouteStateProps({
                      params,
                      searchParamsObject,
                      path: pathname,
                      middlewareMap,
                      pluginExposedContext,
                    }),
                  },
                },
                wrappedElement,
              );
            }

            const integratedElement = await this.wrapWithIntegrationProviders(wrappedElement);
            const pprHeaders = renderingConfig.ppr
              ? this.getPPRHeaders(pprShellOptions ? "miss" : "bypass", renderingConfig.revalidate)
              : undefined;

            // Render with middleware data available
            await this.renderWithSSR(
              integratedElement,
              req,
              res,
              () => {
                _clearCurrentMiddlewareData();
                _clearCurrentMiddlewareContext();
              },
              {
                responseHeaders: pprHeaders,
                captureStaticShell: Boolean(pprShellOptions),
                observabilityRoute: pathname,
                onSuspenseHoleDetected: pprShellOptions
                  ? () => emitFarmEvent({ type: "ppr.suspense.holeDetected", route: pathname })
                  : undefined,
                onComplete:
                  pprShellOptions && req.method !== "HEAD"
                    ? (html) => this.cachePPRShell(pprShellOptions, html)
                    : undefined,
              },
            );
            if (pprRefreshRoute) {
              emitFarmEvent({
                type: "ppr.refresh.complete",
                route: pprRefreshRoute,
                durationMs: Date.now() - renderStartTime,
              });
            }
            completeRender(res.statusCode || 200, pathname);
          });
        });
      });
    } catch (error) {
      if (isFarmRedirectError(error)) {
        const redirect = getFarmRedirectError(error)!;
        const snapshot = getFarmI18nClientSnapshot();
        const redirectUrl =
          snapshot && redirect.url.startsWith("/") && !redirect.url.startsWith("//")
            ? localizeFarmHref(redirect.url, snapshot.locale, snapshot)
            : redirect.url;
        emitFarmEvent({
          type: "route.redirect",
          from: pathname,
          to: redirectUrl,
          status: redirect.status,
        });
        if (!res.headersSent && !(res as any).writableEnded) {
          res.statusCode = redirect.status;
          res.setHeader("Location", redirectUrl);
          res.end();
        } else if (!(res as any).writableEnded) {
          res.end();
        }
        completeRender(redirect.status, pathname);
        return;
      }

      if (isFarmNotFoundError(error)) {
        emitFarmEvent({ type: "route.notFound", pathname });
        if (!res.headersSent && !(res as any).writableEnded) {
          await this.render404(req, res);
        } else if (!(res as any).writableEnded) {
          res.end();
        }
        completeRender(404, pathname);
        return;
      }

      emitFarmEvent({ type: "render.error", route: pathname, error });
      if (pprRefreshRoute) {
        emitFarmEvent({ type: "ppr.refresh.error", route: pprRefreshRoute, error });
      }
      logger.error(`Error rendering page: ${error}`);

      if (res.headersSent || (res as any).writableEnded) {
        if (!(res as any).writableEnded) {
          res.end();
        }
        return;
      }

      if (errorBoundaryEntry) {
        const rendered = await this.renderRouteErrorBoundary(req, res, {
          pathname,
          params,
          layouts,
          searchParamsObject,
          middlewareMap,
          middlewareContext,
          pluginExposedContext,
          error,
          errorModulePath: errorBoundaryEntry.modulePath,
        });

        if (rendered) {
          return;
        }
      }

      await this.render500(req, res, error);
    }
  }

  private async wrapWithIntegrationProviders(
    element: React.ReactElement,
  ): Promise<React.ReactElement> {
    const providers = getIntegrationProviders(this.config.integrations);
    let wrapped = element;

    for (let i = providers.length - 1; i >= 0; i--) {
      const provider = providers[i];
      if (provider.type === "clerk") {
        if (!cachedClerkProvider) {
          cachedClerkProvider = await importRuntimeModule("@clerk/react");
        }

        wrapped = React.createElement(
          cachedClerkProvider!.ClerkProvider,
          provider.props || {},
          wrapped,
        );
      }
    }

    return wrapped;
  }

  private async resolveRouteMetadata(options: {
    layoutModules: Array<Record<string, any>>;
    routeModule: RouteModule;
    pageProps: PageProps;
    pathname: string;
  }): Promise<Record<string, any>> {
    let metadata: Record<string, any> = {};

    for (const layoutModule of options.layoutModules) {
      metadata = mergeMetadata(metadata, layoutModule.metadata);
      if (typeof layoutModule.generateMetadata === "function") {
        metadata = mergeMetadata(
          metadata,
          await layoutModule.generateMetadata({ params: options.pageProps.params }),
        );
      }
    }

    metadata = mergeMetadata(metadata, (options.routeModule as any).metadata);
    if (typeof (options.routeModule as any).generateMetadata === "function") {
      metadata = mergeMetadata(
        metadata,
        await (options.routeModule as any).generateMetadata(options.pageProps),
      );
    }

    for (const kind of ["opengraph", "twitter"] as const) {
      const reference = await this.resolveMetadataImageReference(kind, options.pathname);
      if (reference) {
        metadata = addMetadataImageReference(metadata, reference);
      }
    }

    return metadata;
  }

  private async resolveMetadataImageReference(
    kind: MetadataImageKind,
    pathname: string,
  ): Promise<FarmMetadataImageReference | null> {
    const match = this.routeManager.getMatchingMetadataImage(pathname, kind);
    if (!match) return null;

    const rawHref = this.routeManager.resolveMetadataImagePath(match.image, match.params);
    const snapshot = getFarmI18nClientSnapshot();
    const href = snapshot ? localizeFarmHref(rawHref, snapshot.locale, snapshot) : rawHref;
    const reference: FarmMetadataImageReference = {
      kind,
      href,
    };

    if (match.image.sourceType === "static" && match.image.staticInfo) {
      return {
        ...reference,
        width: match.image.staticInfo.width,
        height: match.image.staticInfo.height,
        alt: match.image.staticInfo.alt,
        contentType: match.image.staticInfo.contentType,
      };
    }

    try {
      const imageModule = await this.routeManager.loadRouteModule(match.image.modulePath);
      const size = (imageModule as any).size;
      if (size && typeof size === "object") {
        reference.width = typeof size.width === "number" ? size.width : undefined;
        reference.height = typeof size.height === "number" ? size.height : undefined;
      }
      if (typeof (imageModule as any).alt === "string") {
        reference.alt = (imageModule as any).alt;
      }
      if (typeof (imageModule as any).contentType === "string") {
        reference.contentType = (imageModule as any).contentType;
      }
    } catch (error) {
      logger.warn(`Failed to read ${kind} image metadata for ${pathname}: ${error}`);
    }

    return reference;
  }

  private async renderMetadataImage(
    req: FarmRequest,
    res: FarmResponse,
    options: {
      pathname: string;
      pagePath: string;
      params: Record<string, string>;
      searchParamsObject: Record<string, string | string[] | undefined>;
      image: {
        modulePath: string;
        kind: MetadataImageKind;
        sourceType?: "module" | "static";
        staticInfo?: StaticMetadataImageInfo;
      };
    },
  ): Promise<void> {
    if (options.image.sourceType === "static") {
      if (!options.image.staticInfo) {
        throw new Error(`Static metadata image ${options.image.modulePath} is missing file info`);
      }
      await this.writeStaticMetadataImageResponse(req, res, {
        modulePath: options.image.modulePath,
        staticInfo: options.image.staticInfo,
      });
      return;
    }

    const imageModule = await this.routeManager.loadRouteModule(options.image.modulePath);
    if (!imageModule.default) {
      throw new Error(
        `Metadata image module ${options.image.modulePath} does not export a default component or handler`,
      );
    }

    const imageProps: PageProps = {
      params: options.params,
      searchParams: Promise.resolve(options.searchParamsObject),
      path: options.pagePath,
    };
    const handlerResult =
      typeof imageModule.default === "function"
        ? await (imageModule.default as any)(imageProps)
        : imageModule.default;

    await this.writeMetadataImageResponse(req, res, handlerResult, imageModule);
  }

  private async writeMetadataImageResponse(
    req: FarmRequest,
    res: FarmResponse,
    value: unknown,
    imageModule: RouteModule,
  ): Promise<void> {
    if (isWebResponse(value)) {
      res.statusCode = value.status;
      value.headers.forEach((headerValue, key) => {
        res.setHeader(key, headerValue);
      });

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      const body = Buffer.from(await value.arrayBuffer());
      res.write(body);
      res.end();
      return;
    }

    const contentType = (imageModule as any).contentType || "image/svg+xml; charset=utf-8";
    let body: string | Buffer;

    if (typeof value === "string") {
      body = value;
    } else if (value instanceof ArrayBuffer) {
      body = Buffer.from(value);
    } else if (ArrayBuffer.isView(value)) {
      body = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    } else if (React.isValidElement(value)) {
      body = renderToStaticMarkup(value);
    } else {
      throw new Error("Metadata image must return a Response, string, bytes, or React element");
    }

    res.statusCode = res.statusCode || 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.write(body);
    res.end();
  }

  private async writeStaticMetadataImageResponse(
    req: FarmRequest,
    res: FarmResponse,
    image: { modulePath: string; staticInfo: StaticMetadataImageInfo },
  ): Promise<void> {
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end();
      return;
    }

    const etag = `"${image.staticInfo.hash}"`;
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const isVersioned = requestUrl.searchParams.get("v") === image.staticInfo.hash;

    res.setHeader("Content-Type", image.staticInfo.contentType);
    res.setHeader("Content-Length", image.staticInfo.byteLength);
    res.setHeader("ETag", etag);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Cache-Control",
      isVersioned ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
    );

    if (req.headers["if-none-match"] === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }

    res.statusCode = res.statusCode || 200;
    if (method === "HEAD") {
      res.end();
      return;
    }

    res.write(await fs.promises.readFile(image.modulePath));
    res.end();
  }

  private async renderRouteErrorBoundary(
    req: FarmRequest,
    res: FarmResponse,
    options: {
      pathname: string;
      params: Record<string, string>;
      layouts: Array<{ modulePath: string }>;
      searchParamsObject: Record<string, string | string[] | undefined>;
      middlewareMap: Map<string, any>;
      middlewareContext: Map<string, any>;
      pluginExposedContext: Map<string, any>;
      error: unknown;
      errorModulePath: string;
    },
  ): Promise<boolean> {
    try {
      if (res.headersSent || (res as any).writableEnded) {
        if (!(res as any).writableEnded) {
          res.end();
        }
        return true;
      }

      const errorModule = await this.routeManager.loadRouteModule(options.errorModulePath);
      if (!errorModule.default) {
        return false;
      }

      const ErrorComponent = errorModule.default as React.ComponentType<unknown>;
      const errorElement = React.createElement(ErrorComponent, {
        ...createRouteStateProps({
          params: options.params,
          searchParamsObject: options.searchParamsObject,
          path: options.pathname,
          middlewareMap: options.middlewareMap,
          pluginExposedContext: options.pluginExposedContext,
        }),
        error: options.error,
        reset: () => {},
      } as React.Attributes);

      let wrapped: React.ReactElement = errorElement;
      const layoutModules = await Promise.all(
        options.layouts.map((layout) => this.routeManager.loadLayoutModule(layout.modulePath)),
      );
      for (let i = layoutModules.length - 1; i >= 0; i--) {
        const LayoutComponent = layoutModules[i].default;
        wrapped = React.createElement(
          LayoutComponent as React.ComponentType<unknown>,
          {
            children: wrapped,
            params: options.params,
          } as React.Attributes,
        );
      }

      const ReactDOMServer = await import("react-dom/server");
      const html = await _runWithMiddlewareData(options.middlewareMap, () =>
        _runWithMiddlewareContext(options.middlewareContext, () =>
          ReactDOMServer.renderToString(wrapped),
        ),
      );
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.write(this.createFullHTML(html, false, options.pathname));
      res.end();
      return true;
    } catch (renderError) {
      logger.warn(`Failed to render route-level error boundary: ${renderError}`);
      return false;
    }
  }

  private async renderWithSSR(
    element: React.ReactElement,
    req: FarmRequest,
    res: FarmResponse,
    clearMiddlewareData?: () => void,
    options: {
      responseHeaders?: Record<string, string> | undefined;
      onComplete?: (html: string) => void | Promise<void>;
      captureStaticShell?: boolean;
      observabilityRoute?: string;
      onSuspenseHoleDetected?: () => void;
    } = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const streamStartTime = Date.now();
      const observabilityRoute =
        options.observabilityRoute || (req as any).__FARM_ROUTE__ || req.url || "/";
      const deploymentId = this.getDeploymentId();
      emitFarmEvent({ type: "render.stream.start", route: observabilityRoute });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      for (const [key, value] of Object.entries(options.responseHeaders || {})) {
        res.setHeader(key, value);
      }

      const htmlParts: string[] = [];
      const staticShellParts: string[] | undefined = options.captureStaticShell ? [] : undefined;
      let staticShellClosed = false;
      let suspenseHoleEmitted = false;
      let didError = false;

      // Get the page path for client-side hydration
      const pagePath = (req as any).__FARM_PAGE_PATH__;
      const isClientComponent = (req as any).__FARM_IS_CLIENT_COMPONENT__ === true;
      const relativePath = pagePath
        ? pagePath.startsWith(this.config.root)
          ? pagePath.slice(this.config.root.length)
          : pagePath
        : "/src/app/page.tsx";

      // Generate manifest for client-side SPA navigation (TanStack Start pattern)
      // This manifest is inlined in HTML - no separate file or API endpoint
      const manifest = this.routeManager.generateClientManifest(this.config.root);

      // Convert to object format for client
      const clientManifest = {
        clientEntry: "/@farm/client.js",
        routes: {} as Record<string, any>,
        layouts: {} as Record<string, any>,
        sharedAssets: [{ tag: "link", attrs: { rel: "stylesheet", href: "/src/app/globals.css" } }],
      };

      // Convert routes array to object keyed by pattern
      for (const routeEntry of manifest.routes) {
        const moduleMetadata = getClientModuleMetadata(routeEntry.modulePath, this.config.root);
        const isClient = moduleMetadata.isClientComponent;
        const shouldHydrateRoute = moduleMetadata.shouldHydrate;

        clientManifest.routes[routeEntry.pattern] = {
          modulePath: routeEntry.modulePath,
          pattern: routeEntry.pattern,
          segments: routeEntry.segments,
          search: routeEntry.search,
          isClientComponent: isClient,
          shouldHydrate: shouldHydrateRoute,
          preloads: [routeEntry.modulePath],
          assets: [],
        };
      }

      // Convert layouts array to object
      for (const layoutEntry of manifest.layouts) {
        clientManifest.layouts[layoutEntry.pattern] = {
          modulePath: layoutEntry.modulePath,
          pattern: layoutEntry.pattern,
          preloads: [layoutEntry.modulePath],
          assets: [],
        };
      }

      // Inject page props, component info, and MANIFEST for client-side SPA
      // __FARM_MANIFEST__ contains the full route manifest (TanStack Start pattern)
      const deferredProps = prepareDeferredData((req as any).__FARM_PROPS__ || {});
      const propsScript = `<script>
window.__FARM_PROPS__ = ${serializeInlineValue(deferredProps.data)};
window.__FARM_DEPLOYMENT_ID__ = ${serializeInlineValue(deploymentId)};
window.__FARM_PATH__ = ${JSON.stringify((req as any).__FARM_ROUTE__ || req.url || "/")};
window.__FARM_IS_CLIENT__ = ${JSON.stringify(isClientComponent)};
window.__FARM_SHOULD_HYDRATE__ = ${JSON.stringify((req as any).__FARM_SHOULD_HYDRATE__ === true)};
window.__FARM_PAGE_MODULE__ = ${JSON.stringify(relativePath)};
window.__FARM_LOADING_MODULE__ = ${JSON.stringify(
        (req as any).__FARM_LOADING_MODULE_PATH__ || null,
      )};
window.__FARM_MANIFEST__ = ${JSON.stringify(clientManifest)};
window.__FARM_INTEGRATION_API_MANIFEST__ = ${JSON.stringify(getRegisteredIntegrationAPIManifest())};
${getFarmI18nClientSnapshot() ? `window.__FARM_I18N__ = ${serializeInlineValue(getFarmI18nClientSnapshot())};` : ""}
</script>`;
      const hydrationClickQueueScript =
        isClientComponent || (req as any).__FARM_SHOULD_HYDRATE__ === true
          ? createPreHydrationClickQueueScript()
          : "";

      const {
        title,
        tags: metaTags,
        hasFavicon,
      } = renderMetadataHead((req as any).__FARM_METADATA__);
      const i18nSnapshot = getFarmI18nClientSnapshot();
      const i18nAlternateTags = i18nSnapshot
        ? renderI18nAlternateLinks((req as any).__FARM_ROUTE__ || req.url || "/", i18nSnapshot)
        : "";

      // React 19: ensure root is a single DOM node so streaming starts early (avoids Fragment delay)
      const streamRoot = React.createElement("div", { style: { display: "contents" } }, element);
      const { pipe, abort } = renderToPipeableStream(streamRoot, {
        onShellReady() {
          const shellReadyMs = Date.now() - streamStartTime;
          emitFarmEvent({
            type: "render.stream.shellReady",
            route: observabilityRoute,
            durationMs: shellReadyMs,
          });
          if (process.env.FARM_VERBOSE) {
            console.log(`[FARM STREAM] onShellReady at ${shellReadyMs}ms`);
          }
          const shell = `<!DOCTYPE html>
<html lang="${escapeHtmlAttribute(i18nSnapshot?.locale || "en")}"${
            i18nSnapshot ? ` dir="${i18nSnapshot.direction}"` : ""
          }>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="farm-deployment-id" content="${escapeHtmlAttribute(deploymentId)}">
  ${hasFavicon ? "" : '<link rel="icon" href="data:,">'}
  <title>${title}</title>${metaTags}${i18nAlternateTags}
  <link rel="stylesheet" href="/src/app/globals.css" />
  <script type="module" src="/@vite/client"></script>
  ${propsScript}
  ${hydrationClickQueueScript}
</head>
<body class="">
  <div id="root">`;
          htmlParts.push(shell);
          staticShellParts?.push(shell);

          let firstChunk = true;
          const writableStream = new Writable({
            write(chunk, encoding, callback) {
              if (firstChunk && process.env.FARM_VERBOSE) {
                console.log(`[FARM STREAM] first pipe chunk at ${Date.now() - streamStartTime}ms`);
                firstChunk = false;
              }
              const chunkText = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
              htmlParts.push(chunkText);

              if (staticShellParts && !staticShellClosed) {
                const dynamicIndex = findPPRDynamicChunkIndex(chunkText);
                if (dynamicIndex >= 0) {
                  if (dynamicIndex > 0) {
                    staticShellParts.push(chunkText.slice(0, dynamicIndex));
                  }
                  staticShellClosed = true;
                  if (!suspenseHoleEmitted) {
                    suspenseHoleEmitted = true;
                    options.onSuspenseHoleDetected?.();
                  }
                } else {
                  staticShellParts.push(chunkText);
                }
              }

              res.write(chunk, encoding, () => {
                if (typeof (res as any).flush === "function") (res as any).flush();
                callback();
              });
            },
            final(callback) {
              const suspenseRevealFallback = `<script>(function(){function moveFragment(srcId,placeholderId){var src=document.getElementById(srcId),ph=document.getElementById(placeholderId);if(!src||!ph||!ph.parentNode)return false;while(src.firstChild)ph.parentNode.insertBefore(src.firstChild,ph);ph.parentNode.removeChild(ph);if(src.parentNode)src.parentNode.removeChild(src);return true}function revealBoundary(boundaryId,sectionId){var boundary=document.getElementById(boundaryId),section=document.getElementById(sectionId);if(!boundary||!section||!boundary.parentNode)return false;var start=boundary.previousSibling;if(!start||start.nodeType!==8)return false;var parent=boundary.parentNode;var node=boundary;var depth=0;while(node){if(node.nodeType===8){var data=node.data;if(data==="/$"||data==="/&"){if(depth===0)break;depth--;}else if(data==="$"||data==="$?"||data==="$~"||data==="$!"||data==="&"){depth++;}}var next=node.nextSibling;parent.removeChild(node);node=next;}while(section.firstChild)parent.insertBefore(section.firstChild,node);if(section.parentNode)section.parentNode.removeChild(section);start.data="$";return true}var tries=0;var timer=setInterval(function(){var changed=false;document.querySelectorAll('div[id^="S:"]').forEach(function(section){var suffix=section.id.slice(2);changed=moveFragment('S:'+suffix,'P:'+suffix)||changed;});document.querySelectorAll('template[id^="B:"]').forEach(function(boundary){var suffix=boundary.id.slice(2);changed=revealBoundary('B:'+suffix,'S:'+suffix)||changed;});tries++;if(tries>80||(!document.querySelector('template[id^="B:"]')&&!document.querySelector('template[id^="P:"]'))){clearInterval(timer);}},50);})();</script>`;
              const footer = createDocumentFooter({
                suspenseRevealFallback,
                deferredHydrationScript: createDeferredHydrationScript(deferredProps.records),
              });
              htmlParts.push(footer);
              res.write(footer);
              res.end();
              callback();
              if (clearMiddlewareData) {
                clearMiddlewareData();
              }
              if (!didError && options.onComplete) {
                if (staticShellParts) {
                  staticShellParts.push(
                    createDocumentFooter({
                      suspenseRevealFallback,
                      refreshPPR: staticShellClosed,
                    }),
                  );
                }

                const cachedHtml = staticShellParts
                  ? staticShellParts.join("")
                  : htmlParts.join("");
                Promise.resolve(options.onComplete(cachedHtml)).catch((error) => {
                  logger.warn(`Failed to cache PPR shell: ${error}`);
                });
              }
              emitFarmEvent({
                type: "render.stream.complete",
                route: observabilityRoute,
                durationMs: Date.now() - streamStartTime,
              });
              resolve();
            },
          });

          // Queue the shell immediately, then start piping the Suspense stream.
          // Waiting for the write callback can delay the fallback until the whole
          // response is ready under some dev-server wrappers.
          res.write(shell);
          if (typeof (res as any).flush === "function") {
            (res as any).flush();
          }
          pipe(writableStream);
        },
        onShellError(error) {
          didError = true;
          if (!isFarmRedirectError(error) && !isFarmNotFoundError(error)) {
            logger.error(`SSR shell error: ${error}`);
            emitFarmEvent({ type: "render.error", route: observabilityRoute, error });
          }

          if (clearMiddlewareData) {
            clearMiddlewareData();
          }

          reject(error);
        },
        onError(error) {
          didError = true;
          if (!isFarmRedirectError(error) && !isFarmNotFoundError(error)) {
            logger.error(`SSR streaming error: ${error}`);
            emitFarmEvent({ type: "render.error", route: observabilityRoute, error });
          }
        },
      });
    });
  }

  private async render404(req: FarmRequest, res: FarmResponse): Promise<void> {
    res.statusCode = 404;

    const pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;

    try {
      // Look for custom not-found page
      const appDir = path.join(this.config.root, this.config.srcDir, "app");
      const notFoundExtensions = [".tsx", ".jsx", ".ts", ".js"];
      let notFoundPath: string | null = null;

      for (const ext of notFoundExtensions) {
        const checkPath = path.join(appDir, `not-found${ext}`);
        if (fs.existsSync(checkPath)) {
          notFoundPath = checkPath;
          break;
        }
      }

      if (notFoundPath) {
        // Use routeManager to load the module (uses Vite's ssrLoadModule in dev)
        const notFoundModule = await this.routeManager.loadRouteModule(notFoundPath);
        const NotFoundComponent = notFoundModule.default;

        if (NotFoundComponent) {
          // Look for root layout
          let LayoutComponent: React.ComponentType<unknown> | null = null;
          for (const ext of notFoundExtensions) {
            const layoutPath = path.join(appDir, `layout${ext}`);
            if (fs.existsSync(layoutPath)) {
              try {
                const layoutModule = await this.routeManager.loadLayoutModule(layoutPath);
                LayoutComponent = layoutModule.default as React.ComponentType<unknown>;
              } catch {
                // Layout import failed, continue without it
              }
              break;
            }
          }

          // Render the 404 page
          let element = React.createElement(
            NotFoundComponent as React.ComponentType<unknown>,
            { pathname } as React.Attributes,
          );

          // Wrap with layout if available
          if (LayoutComponent) {
            element = React.createElement(
              LayoutComponent as React.ComponentType<unknown>,
              { children: element } as React.Attributes,
            );
          }

          // Render to string
          const ReactDOMServer = await import("react-dom/server");
          const content = ReactDOMServer.renderToString(element);

          const html = this.createFullHTML(content, false, pathname);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.write(html);
          res.end();
          return;
        }
      }
    } catch (error) {
      logger.warn(`Failed to render custom 404 page: ${error}`);
    }

    // Fallback to default styled 404 page
    const defaultContent = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;padding:20px;text-align:center;">
        <div style="background:white;border-radius:12px;padding:48px;box-shadow:0 4px 6px rgba(0,0,0,0.1);max-width:500px;width:100%;">
          <h1 style="font-size:96px;font-weight:bold;color:#22c55e;margin:0 0 16px;line-height:1;">404</h1>
          <h2 style="font-size:24px;font-weight:600;color:#1f2937;margin:0 0 16px;">Page Not Found</h2>
          <p style="font-size:16px;color:#6b7280;margin:0 0 24px;">
            The page <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${pathname}</code> doesn't exist.
          </p>
          <a href="/" style="display:inline-block;background:#22c55e;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;">Go Home</a>
        </div>
        <p style="margin-top:24px;font-size:14px;color:#9ca3af;">Powered by Farm.js</p>
      </div>
    `;

    const html = this.createFullHTML(defaultContent, false, pathname);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.write(html);
    res.end();
  }

  private async render500(req: FarmRequest, res: FarmResponse, error: any): Promise<void> {
    if (res.headersSent || (res as any).writableEnded) {
      if (!(res as any).writableEnded) {
        res.end();
      }
      return;
    }

    res.statusCode = 500;

    const isDev = process.env.NODE_ENV === "development";
    const errorMessage = isDev ? error.stack || error.message : "Internal Server Error";

    const html = this.createFullHTML(
      `
        <h1>500 - Internal Server Error</h1>
        ${isDev ? `<pre>${errorMessage}</pre>` : ""}
      `,
      false,
      req.url || "/",
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.write(html);
    res.end();
  }

  private createFullHTML(content: string, isClientComponent = false, requestPath = "/"): string {
    const i18nSnapshot = getFarmI18nClientSnapshot();
    const clientScript = isClientComponent
      ? `  <script type="module" src="/@farm/client.js"></script>`
      : "";
    const integrationManifestScript = `<script>
window.__FARM_DEPLOYMENT_ID__ = ${serializeInlineValue(this.getDeploymentId())};
window.__FARM_INTEGRATION_API_MANIFEST__ = ${JSON.stringify(getRegisteredIntegrationAPIManifest())};
${i18nSnapshot ? `window.__FARM_I18N__ = ${serializeInlineValue(i18nSnapshot)};` : ""}
</script>`;
    const alternateLinks = i18nSnapshot ? renderI18nAlternateLinks(requestPath, i18nSnapshot) : "";

    return `<!DOCTYPE html>
<html lang="${escapeHtmlAttribute(i18nSnapshot?.locale || "en")}"${
      i18nSnapshot ? ` dir="${i18nSnapshot.direction}"` : ""
    }>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="farm-deployment-id" content="${escapeHtmlAttribute(this.getDeploymentId())}">
  <link rel="icon" href="data:,">
  <title>Farm.js App</title>${alternateLinks}
  <link rel="stylesheet" href="/src/app/globals.css" />
  <script type="module" src="/@vite/client"></script>
  ${integrationManifestScript}
</head>
<body class="">
  <div id="root">${content}</div>
${clientScript}
</body>
</html>`;
  }

  private applyDeploymentHeaders(req: FarmRequest, res: FarmResponse): void {
    const deploymentId = this.getDeploymentId();
    res.setHeader(FARM_DEPLOYMENT_ID_HEADER, deploymentId);
    if ((req.method || "GET").toUpperCase() !== "GET") return;

    const forwardedProto = req.headers["x-forwarded-proto"];
    const isSecure =
      (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
        ?.split(",")[0]
        ?.trim() === "https" || Boolean((req.socket as any)?.encrypted);
    const cookie = createFarmDeploymentCookie(deploymentId, this.config.basePath || "/", isSecure);
    const existing = res.getHeader("Set-Cookie");

    if (Array.isArray(existing)) {
      res.setHeader("Set-Cookie", [...existing, cookie]);
    } else if (existing) {
      res.setHeader("Set-Cookie", [String(existing), cookie]);
    } else {
      res.setHeader("Set-Cookie", cookie);
    }
  }

  private getDeploymentId(): string {
    return this.config.deploymentId || "development";
  }
}
