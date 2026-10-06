import * as fs from "fs";
import * as https from "https";
import { isIP } from "net";
import * as path from "path";
import * as tls from "tls";
import type {
  FarmConfig,
  FarmRequest,
  FarmResponse,
  LoadingProps,
  PageProps,
  RouteModule,
  SSGPage,
} from "../types";
import type { MatchedRouteSlot, RouteManager } from "../routing/route-manager";
import { logger, toViteModuleId } from "../utils";
import { collectDevStylesheetUrls } from "./dev-styles";
import {
  composeFarmFullDocument,
  extractFarmFullDocument,
  opensFarmFullDocument,
  removeFarmDocumentTitles,
} from "./full-document";
import {
  describeSuppressedAsyncHydration,
  getClientModuleMetadata,
} from "../utils/client-component";
import { Readable, Writable } from "stream";
import {
  _clearCurrentMiddlewareContext,
  _clearCurrentMiddlewareData,
  _runWithMiddlewareContext,
  _runWithMiddlewareData,
} from "../middleware/server";
import { getRequestContextSnapshot } from "../request-context";
import { matchSSGPage, resolveRouteRenderingConfigFromFile } from "../ssg";
import {
  FARM_MARKDOWN_CONTENT_TYPE,
  createFarmMarkdownErrorBody,
  farmRequestWantsMarkdown,
} from "../app-markdown";
import {
  getIntegrationProviders,
  getRegisteredIntegrationAPIManifest,
  isFarmIntegrationProviderComponentReference,
} from "../integrations";
import {
  _runWithCurrentRequest,
  createWebRequestFromFarmRequest,
  resolveFarmRequestURL,
} from "./request";
import { createFarmCacheKey, getFarmDataCache, normalizeRevalidatePath } from "../cache";
import { resolveFarmNotFoundComponentPath } from "../not-found";
import { getFarmAppDirectories } from "../layers";
import { emitFarmEvent } from "../observability";
import {
  getFarmRedirectError,
  isFarmNotFoundError,
  isFarmRedirectError,
} from "../navigation-errors";
import {
  addMetadataImageReference,
  mergeMetadata,
  renderMetadataHead,
  type FarmMetadataImageReference,
  type MetadataImageKind,
} from "../metadata";
import { resolveFarmRouteContext, withFarmRouteContext } from "../route-context";
import { searchParamsToObject } from "../search-params";
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
import { localizeFarmHref } from "../i18n/routing";
import {
  renderFarmLocaleAlternateLinks,
  type FarmLocaleAlternateLinkOptions,
} from "../i18n/alternates";
import {
  createLateNotFoundRecovery,
  createLateRedirectRecovery,
} from "../navigation/late-navigation-recovery";
import { sendWebResponse } from "./response";
import { matchesFarmIfNoneMatch } from "../server-http";
import { renderFarmFontDevHead } from "../font-vite";
import { createFarmMetadataImageResponse } from "../metadata-image";
import { createFarmMetadataRouteResponse } from "../metadata-route";
import {
  collectFarmLlmsTxtPages,
  createFarmDefaultLlmsTxt,
  createFarmLlmsMarkdownReader,
  renderFarmLlmsFullTxt,
  resolveFarmLlmsTxtConfig,
} from "../llms-txt";
import { resolveMarkdownConfig } from "../markdown";
import {
  resolveFarmTrailingSlashRedirect,
  setFarmTrailingSlashPreference,
} from "../trailing-slash";
import { applyFarmBasePath, setFarmBasePath } from "../base-path";
import { DEFAULT_NOT_FOUND_STYLES } from "../components/not-found-styles";
import {
  createDefaultErrorMarkup,
  getDefaultErrorStatusText,
  resolveDefaultErrorStatus,
} from "../components/error-page";
import { createFarmThemeDocumentParts } from "../theme/server-runtime";
import { getTheme as getFarmTheme } from "../theme/server";
import { FARM_VERSION } from "../version";
import type { ViteDevServer } from "vite";
import {
  assertFarmRendererStreamingRuntime,
  getFarmRendererCapabilities,
  getFarmRendererComponentExtensions,
  getFarmRendererStreamingCapabilitiesForRuntime,
  isReactRenderer,
  readFarmRendererWebStream,
  resolveFarmRendererModule,
  type FarmServerRendererRuntime,
  resolveFarmComponentExtensions,
} from "../renderer";
import { isRendererCompiledComponent } from "../integration-provider-build";
import { pathToFileURL } from "node:url";
import { FARM_ISLAND_REPLAYABLE_SELECTOR } from "../island";
import type { FarmIslandStrategy } from "../island";
import { createDefaultErrorDiagnostics } from "./error-diagnostics";
import {
  addFarmCspNonceToScriptTags,
  createFarmCspNonceRewriter,
  createFarmCspNonce,
  getFarmSecurityHeader,
  resolveFarmSecurityConfig,
  type ResolvedFarmSecurityConfig,
} from "../security";

let cachedClerkProvider: { ClerkProvider: any } | null = null;

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

export function shouldServePrerenderedPage(
  nodeEnv: string | undefined,
  method: string | undefined,
): boolean {
  if (nodeEnv !== "production") return false;
  const normalizedMethod = (method || "GET").toUpperCase();
  return normalizedMethod === "GET" || normalizedMethod === "HEAD";
}

function formatSSGManifestError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseSSGManifest(content: string, manifestPath: string): SSGPage[] {
  let manifest: unknown;

  try {
    manifest = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to parse SSG manifest at ${manifestPath}: ${formatSSGManifestError(error)}`,
    );
  }

  if (!Array.isArray(manifest)) {
    throw new Error(`Invalid SSG manifest at ${manifestPath}: expected an array of pages.`);
  }

  for (const [index, page] of manifest.entries()) {
    if (!page || typeof page !== "object" || Array.isArray(page)) {
      throw new Error(`Invalid SSG manifest at ${manifestPath}: page ${index} must be an object.`);
    }

    const entry = page as Record<string, unknown>;
    if (typeof entry.urlPath !== "string") {
      throw new Error(
        `Invalid SSG manifest at ${manifestPath}: page ${index} must have a string urlPath.`,
      );
    }
    if (
      !entry.params ||
      typeof entry.params !== "object" ||
      Array.isArray(entry.params) ||
      Object.values(entry.params).some((value) => typeof value !== "string")
    ) {
      throw new Error(
        `Invalid SSG manifest at ${manifestPath}: page ${index} must have string params.`,
      );
    }
    if (
      entry.revalidate !== undefined &&
      (typeof entry.revalidate !== "number" ||
        !Number.isFinite(entry.revalidate) ||
        entry.revalidate <= 0)
    ) {
      throw new Error(
        `Invalid SSG manifest at ${manifestPath}: page ${index} revalidate must be a positive number.`,
      );
    }
  }

  return manifest as SSGPage[];
}

interface PPRShellCacheOptions {
  pathname: string;
  search: string;
  /**
   * Locale the shell was rendered in, resolved once when these options are built.
   * The shell carries `lang`, `dir`, the message catalog and the alternate links, so
   * it cannot be shared across locales. It is captured rather than read at write
   * time because the shell is stored from a streaming `onComplete` callback, which
   * can run outside the request context that resolved the locale.
   */
  locale: string;
  /**
   * Origin the shell's hreflang alternates resolved against, or "" when the
   * shell emits none. Kept in the key so one host never serves another host's
   * absolute alternate URLs.
   */
  origin?: string;
  revalidate?: number;
}

export interface FarmNavigationFragmentLayout {
  pattern: string;
  module: { default?: any };
}

export interface FarmNavigationFragmentSlot {
  name: string;
  ownerPattern: string;
  containerId: string;
  module: { default?: any };
  props: Record<string, unknown>;
}

export interface FarmNavigationFragmentInput {
  PageComponent: any;
  LoadingComponent?: any;
  pageProps: Record<string, unknown>;
  params: Record<string, string>;
  layouts: FarmNavigationFragmentLayout[];
  /** First destination layout that changed compared with the active shell. */
  layoutStartIndex?: number;
  slots?: FarmNavigationFragmentSlot[];
  pageShouldHydrate: boolean;
  layoutShouldHydrate: boolean;
  islandStrategy?: FarmIslandStrategy | null;
}

const warnedSuppressedAsyncHydrationModules = new Set<string>();

function warnSuppressedAsyncHydrationOnce(modulePath: string, reason?: string): void {
  if (warnedSuppressedAsyncHydrationModules.has(modulePath)) return;
  warnedSuppressedAsyncHydrationModules.add(modulePath);
  logger.warn(describeSuppressedAsyncHydration(modulePath, reason));
}

// Routes whose layout was observed to render a full `<html>` document. The
// streaming path can't rewrite a document after its shell is flushed, so once a
// route is seen to be full-document it is served through the buffered path
// (which composes the document correctly) on every subsequent request.
const fullDocumentRoutes = new Set<string>();

let warnedFullDocumentLayout = false;

function warnFarmFullDocumentLayout(): void {
  if (warnedFullDocumentLayout) return;
  warnedFullDocumentLayout = true;
  logger.warn(
    `A root layout returned a full <html> document. Farm.js owns the document ` +
      `shell, so a layout should return a fragment (its children) — like the docs ` +
      `example — and let the framework provide <html>/<head>/<body>. The document ` +
      `has been composed into the response, but returning a fragment avoids the ` +
      `ambiguity and keeps dev and production identical.`,
  );
}

function hasRequestHeader(req: FarmRequest, name: string): boolean {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * The request pathname (without query/hash) used as the default canonical URL.
 * Prefers the resolved route path recorded on the request, falling back to the
 * raw request URL.
 */
function getFarmMetadataPathname(req: FarmRequest): string | undefined {
  const raw = (req as any).__FARM_ROUTE__ || req.url;
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const boundary = raw.search(/[?#]/);
  return boundary === -1 ? raw : raw.slice(0, boundary);
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

function renderI18nAlternateLinks(
  requestPath: string,
  snapshot: FarmI18nClientSnapshot,
  options: FarmLocaleAlternateLinkOptions,
): string {
  if (snapshot.routing === "none") return "";
  const url = new URL(requestPath, "http://farm.local");
  return renderFarmLocaleAlternateLinks(url.pathname, snapshot, options);
}

/**
 * Refresh a cached PPR shell's dynamic content in the background, once per
 * document. Inlined, so it stays hand-minified.
 *
 * Hydration awaits `__FARM_PPR_REFRESH_PROMISE__`, which settles after the first
 * attempt whether it succeeds or fails, so a failing refresh never delays
 * hydration. A failed attempt (rejected request, non-2xx response, or a document
 * with no #root) leaves the shell untouched and retries with backoff, at most
 * PPR_REFRESH_MAX_ATTEMPTS times; while offline it waits for the `online` event
 * instead of spending an attempt. Retries only apply before hydration starts
 * (the client sets `__FARM_PPR_HYDRATING__`), so they never replace DOM React
 * owns. When retries stop without success the latch is released, so a later
 * explicit refresh can run.
 */
export const PPR_REFRESH_MAX_ATTEMPTS = 3;

export function createPPRRefreshScript(): string {
  return `<script>(function(){if(window.__FARM_PPR_REFRESHING__)return;window.__FARM_PPR_REFRESHING__=true;var owner=document.currentScript;function applyState(doc){doc.querySelectorAll("script[data-farm-refresh-state]").forEach(function(source){var script=document.createElement("script");if(owner&&owner.nonce)script.nonce=owner.nonce;script.textContent=source.textContent||"";document.head.appendChild(script);script.remove();});}function key(node){return node.nodeType===1?node.getAttribute("id"):null}function compatible(current,next){if(current.nodeType!==next.nodeType)return false;if(current.nodeType===1&&current.tagName!==next.tagName)return false;var currentKey=key(current);var nextKey=key(next);return currentKey||nextKey?currentKey===nextKey:true}function syncAttributes(current,next){Array.from(current.attributes).forEach(function(attribute){if(!next.hasAttribute(attribute.name))current.removeAttribute(attribute.name)});Array.from(next.attributes).forEach(function(attribute){if(current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value)})}function syncChildren(current,next){var cursor=current.firstChild;Array.from(next.childNodes).forEach(function(nextChild){if(cursor&&compatible(cursor,nextChild)){var matched=cursor;cursor=cursor.nextSibling;syncNode(matched,nextChild);return}var candidate=cursor;while(candidate&&!compatible(candidate,nextChild))candidate=candidate.nextSibling;if(candidate){current.insertBefore(candidate,cursor);syncNode(candidate,nextChild);return}current.insertBefore(nextChild.cloneNode(true),cursor)});while(cursor){var stale=cursor;cursor=cursor.nextSibling;stale.remove()}}function syncNode(current,next){if(current.nodeType===3||current.nodeType===8){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return}if(current.nodeType!==1)return;var tag=current.tagName;var value=tag==="INPUT"&&current.type==="file"?null:"value" in current?current.value:null;var checked="checked" in current?current.checked:null;var selected=tag==="SELECT"?Array.from(current.options).map(function(option){return option.selected}):null;var focused=document.activeElement===current;var selection=focused&&typeof current.selectionStart==="number"?[current.selectionStart,current.selectionEnd,current.selectionDirection]:null;syncAttributes(current,next);syncChildren(current,next);if(value!==null)current.value=value;if(checked!==null)current.checked=checked;if(selected)Array.from(current.options).forEach(function(option,index){option.selected=selected[index]===true});if(selection)try{current.setSelectionRange(selection[0],selection[1],selection[2])}catch{}}function replaceRoot(html){var doc=new DOMParser().parseFromString(html,"text/html");var next=doc.getElementById("root");var current=document.getElementById("root");if(!next||!current)return false;applyState(doc);syncNode(current,next);return true}var attempts=0,settle;window.__FARM_PPR_REFRESH_PROMISE__=new Promise(function(resolve){settle=resolve;});function release(){window.__FARM_PPR_REFRESHING__=false;}function retry(){settle();if(window.__FARM_PPR_HYDRATING__||attempts>=${PPR_REFRESH_MAX_ATTEMPTS})return release();if(navigator.onLine===false){window.addEventListener("online",run,{once:true});return;}setTimeout(run,1000*Math.pow(2,attempts-1));}function run(){if(window.__FARM_PPR_HYDRATING__)return release();attempts++;fetch(window.location.href,{cache:"no-store",credentials:"same-origin",headers:{"x-farm-ppr-refresh":"1"}}).then(function(response){if(!response.ok)throw new Error("status "+response.status);return response.text();}).then(function(html){if(window.__FARM_PPR_HYDRATING__)return release();if(!replaceRoot(html))throw new Error("no root");settle();}).catch(retry);}run();})();</script>`;
}

export function createPreHydrationClickQueueScript(): string {
  // Inlined into every document, so this stays hand-minified rather than
  // importing from the island runtime, which has not loaded yet at this point.
  //
  // Two kinds of interaction are handled. A click or a submit is HELD: the
  // event is prevented and queued so the island can hydrate and the action can
  // be reproduced against the same target. A pointerdown or a focusin is only
  // OBSERVED: it starts hydration early and native behavior proceeds, so
  // typing into a field or toggling a checkbox is never swallowed. The event
  // set here must match FARM_ISLAND_ACTIVATION_EVENTS.
  const selector = JSON.stringify(FARM_ISLAND_REPLAYABLE_SELECTOR);
  return `<script>(function(){if(window.__FARM_PREHYDRATION_CLICK_QUEUE__)return;var queue=[];window.__FARM_PREHYDRATION_CLICK_QUEUE__=queue;window.__FARM_HYDRATED__=false;document.documentElement.dataset.farmHydrated="false";function isModified(event){return !!(event.metaKey||event.altKey||event.ctrlKey||event.shiftKey)}function inHydrated(node){return !!(node&&node.closest&&node.closest('[data-farm-island-hydrated="true"]'))}function closestQueuedTarget(target){while(target&&target!==document.documentElement){if(target.matches&&target.matches(${selector}))return target;target=target.parentElement}return null}function announce(target,kind){document.dispatchEvent(new CustomEvent("farm:island-interaction",{detail:{target:target,kind:kind||null}}))}function hold(event,target,kind){if(queue.some(function(item){return item.target===target}))return;queue.push({target:target,kind:kind,createdAt:Date.now()});announce(target,kind);event.preventDefault();event.stopImmediatePropagation()}document.addEventListener("click",function(event){if(window.__FARM_HYDRATED__)return;if(event.defaultPrevented||event.button!==0||isModified(event))return;var target=closestQueuedTarget(event.target);if(!target||target.closest&&target.closest("a[href]")||inHydrated(target))return;hold(event,target,"click")},true);document.addEventListener("submit",function(event){if(window.__FARM_HYDRATED__)return;if(event.defaultPrevented)return;var form=event.target;if(!form||form.nodeName!=="FORM"||inHydrated(form))return;hold(event,form,"submit")},true);function observe(event){if(window.__FARM_HYDRATED__)return;var target=event.target;if(!(target&&target.closest)||inHydrated(target))return;announce(target,null)}document.addEventListener("pointerdown",observe,true);document.addEventListener("focusin",observe,true);})();</script>`;
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
  return `<script data-farm-refresh-state>window.__FARM_DEFERRED_DATA__=${serializeInlineValue(
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

/**
 * GETs a page from this HTTPS dev server. The connection goes to the server's
 * own socket address, while SNI and certificate verification use the hostname
 * the page was requested under, which is the name the dev certificate covers.
 */
function requestOwnHttpsServer(
  request: Request,
  address: { host: string; port: number },
): Promise<Response> {
  const url = new URL(request.url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve, reject) => {
    const outgoing = https.request(
      {
        host: address.host,
        port: address.port,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        headers: { ...Object.fromEntries(request.headers), host: url.host },
        // SNI carries names only, never IP addresses.
        ...(isIP(hostname) ? {} : { servername: hostname }),
        checkServerIdentity: (_, certificate) => tls.checkServerIdentity(hostname, certificate),
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
            headers.append(name, item);
          }
        }
        const status = incoming.statusCode ?? 502;
        const hasBody = ![204, 205, 304].includes(status);
        if (!hasBody) incoming.resume();
        resolve(
          new Response(hasBody ? (Readable.toWeb(incoming) as ReadableStream) : null, {
            status,
            headers,
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function isWebResponse(value: unknown): value is Response {
  return (
    typeof Response !== "undefined" &&
    value instanceof Response &&
    typeof value.arrayBuffer === "function"
  );
}

async function parseRouteModuleProps(
  routeModule: RouteModule,
  input: {
    props: PageProps;
    search: Record<string, string | string[] | undefined>;
    routePath: string;
  },
): Promise<
  PageProps & {
    search: unknown;
    data?: unknown;
    __farmCanonicalPath?: string;
    __farmRoutePropsPromise?: Promise<Record<string, unknown>>;
    __farmRoutePropsResolved?: true;
  }
> {
  const resolveRouteProps = (routeModule as any).__farmResolveRouteProps;
  if (typeof resolveRouteProps === "function") {
    // Resolve the top-level route state before starting the HTTP stream. It can
    // still return explicit defer() values for nested Suspense boundaries, but
    // redirects, notFound(), and failures must retain their real HTTP status.
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
  private viteServer?: ViteDevServer;
  private rendererRuntime!: FarmServerRendererRuntime;
  private security: ResolvedFarmSecurityConfig;

  constructor(
    config: Required<FarmConfig>,
    routeManager: RouteManager,
    i18nRuntime?: FarmI18nRuntime,
    viteServer?: ViteDevServer,
  ) {
    this.config = config;
    this.routeManager = routeManager;
    this.i18nRuntime = i18nRuntime;
    this.viteServer = viteServer;
    this.security = resolveFarmSecurityConfig(config.security);
    this.loadSSGManifest();
  }

  async initialize(): Promise<void> {
    if (this.rendererRuntime) return;

    if (this.config.notFound?.component?.trim()) {
      resolveFarmNotFoundComponentPath(this.config, getFarmAppDirectories(this.config));
    }

    const loaded = isReactRenderer(this.config.renderer)
      ? await import("../renderer/react/server")
      : this.viteServer
        ? await this.viteServer.ssrLoadModule(this.config.renderer.server)
        : await import(
            pathToFileURL(
              resolveFarmRendererModule(
                this.config.root || process.cwd(),
                this.config.renderer.server,
              ),
            ).href
          );
    const runtime = loaded as Partial<FarmServerRendererRuntime>;
    const required = ["createElement", "isValidElement", "renderToString"] as const;
    for (const key of required) {
      if (typeof runtime[key] !== "function") {
        throw new Error(
          `Renderer \`${this.config.renderer.name}\` server module must export ${key}().`,
        );
      }
    }

    assertFarmRendererStreamingRuntime(
      this.config.renderer.name,
      this.config.renderer,
      runtime,
      "node",
    );

    this.rendererRuntime = runtime as FarmServerRendererRuntime;
    this.routeManager.setRendererRuntime?.(this.rendererRuntime);
  }

  private createPageBoundary(
    pageElement: unknown,
    options: {
      pageShouldHydrate: boolean;
      layoutShouldHydrate: boolean;
      islandStrategy?: FarmIslandStrategy | null;
    },
  ): unknown {
    return this.rendererRuntime.createElement(
      "div",
      {
        id: "__farm_page__",
        "data-farm-segment": "page",
        "data-farm-client": options.pageShouldHydrate ? "true" : "false",
        ...(options.layoutShouldHydrate ? { "data-farm-layout-client": "true" } : {}),
        "data-farm-island": "page",
        "data-farm-island-strategy": options.islandStrategy || "load",
      },
      pageElement,
    );
  }

  /// Stylesheets the app imported through JS (fontsource packages, component
  /// CSS) that the document must link alongside globals.css — see #658.
  private collectDevStyleHrefs(): string[] {
    const graph = this.viteServer?.moduleGraph;
    if (!graph) return [];
    return collectDevStylesheetUrls(graph.idToModuleMap.values());
  }

  private collectDevStyleLinks(): string[] {
    return this.collectDevStyleHrefs().map(
      (href) => `<link rel="stylesheet" href="${escapeHtmlAttribute(href)}">`,
    );
  }

  private createLayoutBoundary(pattern: string, layoutElement: unknown): unknown {
    return this.rendererRuntime.createElement(
      "div",
      {
        "data-farm-layout-boundary": "true",
        "data-farm-layout-pattern": pattern,
        style: { display: "contents" },
      },
      layoutElement,
    );
  }

  private wrapClientGraph(element: unknown): unknown {
    const getIsolatedClientBoundaryModules = this.routeManager.getIsolatedClientBoundaryModules;
    if (
      !this.rendererRuntime.wrapClientGraph ||
      typeof getIsolatedClientBoundaryModules !== "function" ||
      getIsolatedClientBoundaryModules.call(this.routeManager, this.config.root).size === 0
    ) {
      return element;
    }
    return this.rendererRuntime.wrapClientGraph(element);
  }

  private async renderElementToCompleteHTML(element: unknown): Promise<string> {
    const streaming = getFarmRendererStreamingCapabilitiesForRuntime(this.config.renderer, "node");
    const renderToPipeableStream = streaming.node
      ? this.rendererRuntime.renderToPipeableStream
      : undefined;

    if (renderToPipeableStream) {
      return await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let started = false;
        const writable = new Writable({
          write(chunk, _encoding, callback) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            callback();
          },
        });
        writable.once("finish", () => resolve(Buffer.concat(chunks).toString("utf8")));
        writable.once("error", reject);

        const stream = renderToPipeableStream(element, {
          onShellReady() {
            started = true;
            stream.pipe(writable);
          },
          onShellError(error) {
            reject(error);
          },
          onError(error) {
            if (!started) reject(error);
          },
        });
      });
    }

    if (streaming.web && this.rendererRuntime.renderToReadableStream) {
      const stream = await this.rendererRuntime.renderToReadableStream(element);
      return await readFarmRendererWebStream(stream);
    }

    return await this.rendererRuntime.renderToString(element);
  }

  /**
   * Buffered render carrying document-head markup for renderers that emit it
   * during render (e.g. <svelte:head>). Other renderers return an empty head.
   */
  private async renderElementToDocumentParts(
    element: unknown,
  ): Promise<{ html: string; head: string }> {
    if (this.rendererRuntime.renderToStringWithHead) {
      const rendered = await this.rendererRuntime.renderToStringWithHead(element);
      return { html: rendered.html, head: rendered.head || "" };
    }
    return { html: await this.rendererRuntime.renderToString(element), head: "" };
  }

  /**
   * Render the route tree used by client navigation without producing a second
   * document response. Layout markers let the browser preserve the longest
   * common shell and replace only the first changed boundary.
   */
  async renderNavigationFragment(input: FarmNavigationFragmentInput): Promise<string> {
    await this.initialize();
    setFarmBasePath(this.config.basePath);
    setFarmTrailingSlashPreference(this.config.trailingSlash);
    let element = this.rendererRuntime.createElement(input.PageComponent, input.pageProps);
    if (input.LoadingComponent) {
      element = this.rendererRuntime.createElement(
        this.rendererRuntime.Suspense,
        {
          fallback: this.rendererRuntime.createElement(input.LoadingComponent, {
            params: input.params,
            path: (input.pageProps as any).path,
          }),
        },
        element,
      );
    }
    if (input.pageShouldHydrate && !input.layoutShouldHydrate) {
      element = this.wrapClientGraph(element);
    } else if (
      input.layoutShouldHydrate &&
      !input.pageShouldHydrate &&
      this.rendererRuntime.isolateServerPageGraph
    ) {
      // As in renderPage: the layout keeps this page as server HTML, so its islands stay islands.
      element = this.rendererRuntime.isolateServerPageGraph(element);
    }
    element = this.createPageBoundary(element, {
      pageShouldHydrate: input.pageShouldHydrate,
      layoutShouldHydrate: input.layoutShouldHydrate,
      islandStrategy: input.islandStrategy,
    });

    const layoutStartIndex = Math.max(
      0,
      Math.min(input.layoutStartIndex ?? 0, input.layouts.length),
    );
    for (let index = input.layouts.length - 1; index >= layoutStartIndex; index--) {
      const layout = input.layouts[index]!;
      const LayoutComponent = layout.module.default;
      if (!LayoutComponent) continue;
      const slotProps: Record<string, unknown> = {};
      for (const slot of input.slots || []) {
        if (slot.ownerPattern !== layout.pattern || !slot.module.default) continue;
        let slotElement = this.rendererRuntime.createElement(slot.module.default, slot.props);
        slotElement = this.wrapClientGraph(slotElement);
        slotProps[slot.name] = this.rendererRuntime.createElement(
          "div",
          {
            id: slot.containerId,
            "data-farm-route-slot": slot.name,
            "data-farm-slot-owner": slot.ownerPattern,
          },
          slotElement,
        );
      }
      element = this.rendererRuntime.createElement(LayoutComponent, {
        children: element,
        params: input.params,
        ...slotProps,
      });
      element = this.createLayoutBoundary(layout.pattern, element);
    }

    if (input.layoutShouldHydrate) {
      element = this.wrapClientGraph(element);
    }

    return this.renderElementToCompleteHTML(await this.wrapWithIntegrationProviders(element));
  }

  async runWithRequestContext<T>(request: Request, fn: () => T | Promise<T>): Promise<T> {
    return _runWithCurrentRequest(request, () =>
      this.i18nRuntime?.config.enabled
        ? _runWithFarmI18nRequest(this.i18nRuntime, request, fn, {
            redirect: false,
          })
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
    const manifestPath = path.join(this.config.root, this.config.outDir, "__ssg_manifest.json");
    let content: string;

    try {
      content = fs.readFileSync(manifestPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }

      throw new Error(
        `Failed to read SSG manifest at ${manifestPath}: ${formatSSGManifestError(error)}`,
      );
    }

    this.ssgManifest = parseSSGManifest(content, manifestPath);
    logger.info(`Loaded SSG manifest: ${this.ssgManifest.length} pages`);
  }

  /**
   * Check if a path should be served from SSG cache
   */
  private async shouldServeSSG(pathname: string): Promise<SSGPage | null> {
    const ssgPage = matchSSGPage(pathname, this.ssgManifest);
    if (!ssgPage) return null;

    const cached = await this.getCachedSSGPage(pathname);
    if (cached && (await this.dataCache.isStaleAsync(cached))) {
      // Stale - needs revalidation (serve stale, regenerate in background)
      this.regenerateSSGPage(ssgPage);
    }

    return ssgPage;
  }

  private getSSGCacheKey(urlPath: string): string {
    return createFarmCacheKey(["ssg", normalizeRevalidatePath(urlPath)]);
  }

  private getPPRCacheKey(pathname: string, search = "", locale = "", origin = ""): string {
    const key = ["ppr", locale, normalizeRevalidatePath(pathname), search];
    return createFarmCacheKey(origin ? [...key, origin] : key);
  }

  private getCachedSSGPage(urlPath: string) {
    return this.dataCache.getEntryAsync<CachedSSGPage>(this.getSSGCacheKey(urlPath), {
      allowStale: true,
    });
  }

  private async cacheSSGPage(
    page: SSGPage,
    html: string,
    options: { document: boolean; createdAt?: number },
  ): Promise<void> {
    await this.dataCache.setAsync(
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

  private getCachedPPRShell(pathname: string, search: string, locale = "", origin = "") {
    return this.dataCache.getEntryAsync<CachedPPRShell>(
      this.getPPRCacheKey(pathname, search, locale, origin),
    );
  }

  private async cachePPRShell(options: PPRShellCacheOptions, html: string): Promise<void> {
    const key = this.getPPRCacheKey(
      options.pathname,
      options.search,
      options.locale,
      options.origin,
    );
    await this.dataCache.setAsync(
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
    if (this.security.csp && this.security.csp.nonce) {
      return "csp-nonce";
    }

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

          const { route, layouts } = this.routeManager.matchRoute(page.urlPath);
          const layoutModules = await Promise.all(
            layouts.map((l) => this.routeManager.loadLayoutModule(l.modulePath)),
          );
          const routeManifest = this.routeManager.generateClientManifest(this.config.root);

          const PageComponent = mod.default;
          const pageProps = {
            params: page.params,
            searchParams: Promise.resolve({}),
            path: page.urlPath,
          };

          let pageElement: any = this.rendererRuntime.createElement(PageComponent, pageProps);
          const pageMetadata = routeManifest.routes.find(
            (entry) => entry.pattern === route?.pattern,
          ) ?? {
            shouldHydrate: false,
            islandStrategy: null,
          };
          const layoutMetadata = layouts.map(
            (layout) =>
              routeManifest.layouts.find((entry) => entry.pattern === layout.pattern) ?? {
                shouldHydrate: false,
                islandStrategy: null,
              },
          );
          const layoutShouldHydrate = layoutMetadata.some((metadata) => metadata.shouldHydrate);
          pageElement = this.createPageBoundary(pageElement, {
            pageShouldHydrate: pageMetadata.shouldHydrate,
            layoutShouldHydrate,
            islandStrategy: pageMetadata.islandStrategy,
          });

          for (let i = layoutModules.length - 1; i >= 0; i--) {
            const layoutModule = layoutModules[i];
            const LayoutComponent = layoutModule.default;
            pageElement = this.rendererRuntime.createElement(LayoutComponent, {
              children: pageElement,
              params: page.params,
            });
            pageElement = this.createLayoutBoundary(layouts[i]!.pattern, pageElement);
          }

          const html = await this.rendererRuntime.renderToString(
            await this.wrapWithIntegrationProviders(pageElement),
          );

          // Resolve metadata so the regenerated document keeps its title and
          // meta/OG tags instead of falling back to the framework default
          // ("Farm.js App"). Without this, a static route served from the ISR
          // cache loses its metadata after the first revalidation (issue #1018).
          const mergedMetadata = await this.resolveRouteMetadata({
            layoutModules,
            routeModule: mod,
            pageProps: pageProps as unknown as PageProps,
            pathname: page.urlPath,
          });
          const { title, tags, hasFavicon } = renderMetadataHead(mergedMetadata);
          const metadataHead = `${
            hasFavicon ? "" : '<link rel="icon" href="data:,">\n  '
          }<title>${title}</title>${tags}`;
          // No request drives a background regeneration, so the cached document's
          // hreflang alternates resolve against metadataBase only.
          const fullDocument = this.createFullHTML(
            html,
            pageMetadata.shouldHydrate === true,
            page.urlPath,
            metadataHead,
            { metadata: mergedMetadata },
          );

          await this.cacheSSGPage(page, fullDocument, { document: true });

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
    const cached = await this.getCachedSSGPage(page.urlPath);
    if (cached) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Farm-SSG", "cached");
      if (page.revalidate) {
        res.setHeader("Cache-Control", `s-maxage=${page.revalidate}, stale-while-revalidate`);
      }
      res.write(
        cached.value.document
          ? cached.value.html
          : this.createFullHTML(cached.value.html, false, page.urlPath, undefined, { req }),
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
        await this.cacheSSGPage(page, html, {
          document: true,
          createdAt: stat.mtimeMs,
        });
        const fileCacheEntry = await this.getCachedSSGPage(page.urlPath);
        if (fileCacheEntry && (await this.dataCache.isStaleAsync(fileCacheEntry))) {
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
    await this.initialize();
    setFarmBasePath(this.config.basePath);
    setFarmTrailingSlashPreference(this.config.trailingSlash);
    const cspNonce = createFarmCspNonce(this.security);
    if (cspNonce) {
      (req as any).__FARM_CSP_NONCE__ = cspNonce;
      const header = getFarmSecurityHeader(this.security, cspNonce)!;
      res.setHeader(header.key, header.value);
    }
    const request = createWebRequestFromFarmRequest(req, {
      trustProxy: this.config.server?.trustProxy,
    });
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
    let layouts: Array<{ modulePath: string; pattern: string }> = [];
    let routeSlots: MatchedRouteSlot[] = [];
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
      const url = resolveFarmRequestURL(req, { trustProxy: this.config.server?.trustProxy });
      pathname = url.pathname;
      emitFarmEvent({ type: "render.start", route: pathname, pathname });
      searchParamsObject = searchParamsToObject(url.searchParams);

      const metadataRouteMatch = this.routeManager.matchMetadataRoute(pathname);
      if (metadataRouteMatch) {
        await this.renderMetadataRoute(req, res, metadataRouteMatch);
        completeRender(res.statusCode || 200, pathname);
        return;
      }

      const generatedLlmsKind = this.getGeneratedLlmsKind(pathname);
      if (generatedLlmsKind) {
        await this.renderGeneratedLlmsTxt(req, res, generatedLlmsKind);
        completeRender(res.statusCode || 200, pathname);
        return;
      }

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

      const match = this.routeManager.matchRoute(pathname);
      if (match.route) {
        const redirectLocation = resolveFarmTrailingSlashRedirect(url, this.config.trailingSlash);
        if (redirectLocation) {
          res.statusCode = 308;
          res.setHeader("Location", redirectLocation);
          res.end();
          completeRender(308, match.route.pattern);
          return;
        }
      }

      // Pre-rendered HTML only represents retrieval requests. Other methods must
      // continue through the live route so their request semantics are preserved.
      if (
        !(req as any).__FARM_CSP_NONCE__ &&
        shouldServePrerenderedPage(process.env.NODE_ENV, req.method)
      ) {
        const ssgPage = await this.shouldServeSSG(pathname);
        if (ssgPage) {
          const served = await this.serveSSGPage(req, res, ssgPage);
          if (served) {
            completeRender(res.statusCode || 200, ssgPage.urlPath);
            return;
          }
        }
      }

      // Match route
      const route = match.route;
      params = match.params;
      layouts = match.layouts;
      routeSlots = match.slots ?? [];

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
      pluginExposedContext = getRequestContextSnapshot(req as object, {
        exposedOnly: true,
      });
      const currentRequest = createWebRequestFromFarmRequest(req, {
        trustProxy: this.config.server?.trustProxy,
      });
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
            error?: any;
            notFound?: any;
          }
        | undefined;
      let PageComponent = routeModule.default;
      let pageProps: PageProps & {
        search: unknown;
        data?: unknown;
        error?: unknown;
        __farmRoutePropsPromise?: Promise<Record<string, unknown>>;
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
        { experimentalPPR: this.config.experimental?.ppr === true },
      );
      const pprBypassReason = renderingConfig.ppr
        ? this.getPPRShellBypassReason(req, middlewareMap, middlewareContext, pluginExposedContext)
        : undefined;
      const canCachePPRShell = renderingConfig.ppr && !pprBypassReason;
      const pprI18nSnapshot = canCachePPRShell ? getFarmI18nClientSnapshot() : undefined;
      const pprShellOptions: PPRShellCacheOptions | undefined = canCachePPRShell
        ? {
            pathname,
            search: url.search,
            locale: pprI18nSnapshot?.locale ?? "",
            origin: pprI18nSnapshot && pprI18nSnapshot.routing !== "none" ? url.origin : "",
            revalidate: renderingConfig.revalidate,
          }
        : undefined;

      if (renderingConfig.ppr && pprBypassReason) {
        emitFarmEvent({
          type: "ppr.shell.bypass",
          route: pathname,
          reason: pprBypassReason,
        });
        emitFarmEvent({
          type: "cache.bypass",
          route: pathname,
          reason: pprBypassReason,
        });

        if (pprBypassReason === "refresh") {
          pprRefreshRoute = pathname;
          emitFarmEvent({ type: "ppr.refresh.start", route: pathname });
        }
      }

      if (pprShellOptions) {
        // Same locale for the lookup and the later store, so the two cannot diverge.
        const pprCacheKey = this.getPPRCacheKey(
          pathname,
          url.search,
          pprShellOptions.locale,
          pprShellOptions.origin,
        );
        const cachedPPRShell = await this.getCachedPPRShell(
          pathname,
          url.search,
          pprShellOptions.locale,
          pprShellOptions.origin,
        );
        if (cachedPPRShell) {
          emitFarmEvent({
            type: "ppr.shell.hit",
            route: pathname,
            key: pprCacheKey,
          });
          this.serveCachedPPRShell(res, cachedPPRShell.value, renderingConfig.revalidate);
          completeRender(res.statusCode || 200, pathname);
          return;
        }
        emitFarmEvent({
          type: "ppr.shell.miss",
          route: pathname,
          key: pprCacheKey,
        });
      }

      let LoadingFallbackComponent: any = null;
      if (loadingBoundaryEntry) {
        const loadingModule = await this.routeManager.loadRouteModule(
          loadingBoundaryEntry.modulePath,
        );
        if (loadingModule.default) {
          LoadingFallbackComponent = loadingModule.default;
        }
      }

      let ErrorFallbackComponent: any = null;
      if (errorBoundaryEntry) {
        const errorModule = await this.routeManager.loadRouteModule(errorBoundaryEntry.modulePath);
        if (errorModule.default) {
          ErrorFallbackComponent = errorModule.default;
        }
      }

      // Hydration decisions are compiled into a manifest and reused on requests.
      // Development HMR invalidates this cache when a route module changes.
      const routeManifest = this.routeManager.generateClientManifest(this.config.root);
      const routeManifestEntry = routeManifest.routes.find(
        (entry) => entry.pattern === route.pattern,
      );
      const moduleMetadata =
        routeManifestEntry || getClientModuleMetadata(route.modulePath, this.config.root);
      const isClientComponent = moduleMetadata.isClientComponent;
      const renderedRouteSlots = await Promise.all(
        routeSlots.map(async (slot) => {
          const slotModule = await this.routeManager.loadRouteModule(slot.route.modulePath);
          if (!slotModule.default) {
            throw new Error(
              `Route slot "${slot.name}" module ${slot.route.modulePath} does not export a default component`,
            );
          }

          const slotContext = await this.resolveRouteContext({
            request: currentRequest,
            rawRequest: req,
            params: slot.params,
            search: searchParamsObject,
            path: pathname,
          });
          const rawSlotProps = withFarmRouteContext(
            {
              params: slot.params,
              searchParams: Promise.resolve(searchParamsObject),
              path: pathname,
              middleware: middlewareMap.size > 0 ? { data: middlewareMap } : undefined,
              context: pluginExposedContext.size > 0 ? { data: pluginExposedContext } : undefined,
            } as PageProps & { search: unknown },
            slotContext,
          );
          const slotProps = await parseRouteModuleProps(slotModule, {
            props: rawSlotProps,
            search: searchParamsObject,
            routePath: slot.route.pattern,
          });
          const metadata = routeManifest.slots.find(
            (entry) =>
              entry.name === slot.name &&
              entry.ownerPattern === slot.ownerPattern &&
              entry.pattern === slot.route.pattern,
          ) ?? {
            isClientComponent: false,
            shouldHydrate: false,
          };

          return {
            ...slot,
            module: slotModule,
            props: slotProps,
            isClientComponent: metadata.isClientComponent,
            shouldHydrate: metadata.shouldHydrate,
          };
        }),
      );
      const shouldHydrate = moduleMetadata.shouldHydrate;
      if (moduleMetadata.suppressedAsyncHydration) {
        warnSuppressedAsyncHydrationOnce(
          route.modulePath,
          routeManifestEntry?.suppressedAsyncHydrationReason,
        );
      }
      const layoutHydrationMetadata = layouts.map((layout) => {
        const manifestEntry = routeManifest.layouts.find(
          (entry) => entry.pattern === layout.pattern,
        ) as
          | {
              isClientComponent?: boolean;
              shouldHydrate?: boolean;
              islandStrategy?: "load" | "interaction" | "visible" | "idle" | null;
              hasIsolatedClientBoundaries?: boolean;
              suppressedAsyncHydration?: true;
              suppressedAsyncHydrationReason?: string;
            }
          | undefined;
        if (manifestEntry?.suppressedAsyncHydration) {
          warnSuppressedAsyncHydrationOnce(
            layout.modulePath,
            manifestEntry.suppressedAsyncHydrationReason,
          );
        }
        if (typeof manifestEntry?.shouldHydrate === "boolean") {
          return {
            isClientComponent: manifestEntry.isClientComponent === true,
            shouldHydrate: manifestEntry.shouldHydrate,
            islandStrategy: manifestEntry.islandStrategy ?? null,
            ...(manifestEntry.hasIsolatedClientBoundaries === true
              ? { hasIsolatedClientBoundaries: true }
              : {}),
          };
        }
        return {
          isClientComponent: false,
          shouldHydrate: false,
          islandStrategy: null,
        };
      });
      const shouldHydrateLayout = layoutHydrationMetadata.some(
        (metadata) => metadata.shouldHydrate,
      );
      const clientLayouts = layouts.map((layout, index) => ({
        pattern: layout.pattern,
        modulePath: toViteModuleId(layout.modulePath, this.config.root),
        shouldHydrate: layoutHydrationMetadata[index]?.shouldHydrate === true,
        islandStrategy: layoutHydrationMetadata[index]?.islandStrategy ?? null,
        ...(layoutHydrationMetadata[index]?.hasIsolatedClientBoundaries === true
          ? { hasIsolatedClientBoundaries: true }
          : {}),
      }));
      const hydrationStrategies = [
        ...(shouldHydrate && moduleMetadata.islandStrategy ? [moduleMetadata.islandStrategy] : []),
        ...layoutHydrationMetadata.flatMap((metadata) =>
          metadata.shouldHydrate && metadata.islandStrategy ? [metadata.islandStrategy] : [],
        ),
      ];
      const hydrationIslandStrategy = hydrationStrategies.every(
        (strategy) => strategy === hydrationStrategies[0],
      )
        ? (hydrationStrategies[0] ?? "load")
        : "load";
      const hasHydratableRouteSlots = renderedRouteSlots.some(
        (slot) => slot.isClientComponent || slot.shouldHydrate,
      );
      const hasIsolatedClientBoundaries =
        routeManifestEntry?.hasIsolatedClientBoundaries === true ||
        layoutHydrationMetadata.some((metadata) => metadata.hasIsolatedClientBoundaries === true);

      (req as any).__FARM_PAGE_PATH__ = route.modulePath;
      (req as any).__FARM_ROUTE__ = pathname;
      (req as any).__FARM_IS_CLIENT_COMPONENT__ = isClientComponent;
      (req as any).__FARM_PAGE_SHOULD_HYDRATE__ = shouldHydrate;
      (req as any).__FARM_LAYOUT_SHOULD_HYDRATE__ = shouldHydrateLayout;
      (req as any).__FARM_LAYOUTS__ = clientLayouts;
      if (hasIsolatedClientBoundaries) {
        (req as any).__FARM_HAS_ISOLATED_CLIENT_BOUNDARIES__ = true;
      }
      (req as any).__FARM_SHOULD_HYDRATE__ =
        shouldHydrate || shouldHydrateLayout || hasIsolatedClientBoundaries;
      (req as any).__FARM_ISLAND_STRATEGY__ = hydrationIslandStrategy;
      (req as any).__FARM_HAS_HYDRATABLE_ROUTE_SLOTS__ = hasHydratableRouteSlots;
      (req as any).__FARM_LOADING_MODULE_PATH__ = loadingBoundaryEntry?.modulePath
        ? toViteModuleId(loadingBoundaryEntry.modulePath, this.config.root)
        : null;
      (req as any).__FARM_ROUTE_SLOTS__ = renderedRouteSlots.map((slot) => ({
        name: slot.name,
        ownerPattern: slot.ownerPattern,
        containerId: slot.containerId,
        interception: slot.interception,
        fallback: slot.fallback,
        modulePath: slot.route.modulePath,
        isClientComponent: slot.isClientComponent,
        shouldHydrate: slot.shouldHydrate,
        props: {
          params: slot.props.params,
          search: (slot.props as any).search,
          searchParams: (slot.props as any).search,
          ...("data" in slot.props ? { data: (slot.props as any).data } : {}),
          ...((slot.props as any).__farmCanonicalPath
            ? { __farmCanonicalPath: (slot.props as any).__farmCanonicalPath }
            : {}),
          ...((slot.props as any).__farmRoutePropsResolved
            ? { __farmRoutePropsResolved: true }
            : {}),
          path: pathname,
        },
      }));
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
            let pageElement: any = this.rendererRuntime.createElement(PageComponent, pageProps);

            if (LoadingFallbackComponent) {
              const loadingFallback = this.rendererRuntime.createElement(LoadingFallbackComponent, {
                ...createRouteStateProps({
                  params,
                  searchParamsObject,
                  path: pathname,
                  middlewareMap,
                  pluginExposedContext,
                }),
              });

              pageElement = this.rendererRuntime.createElement(
                this.rendererRuntime.Suspense,
                { fallback: loadingFallback },
                pageElement,
              );
            }

            // A route-wide page owns every compiled client component beneath
            // its React root. Keep shared leaf modules as ordinary components
            // here even when an isolated layout also imports the same module.
            if ((isClientComponent || shouldHydrate) && !shouldHydrateLayout) {
              pageElement = this.wrapClientGraph(pageElement);
            } else if (
              shouldHydrateLayout &&
              !(isClientComponent || shouldHydrate) &&
              this.rendererRuntime.isolateServerPageGraph
            ) {
              // The hydrating layout keeps this page as server HTML, so its client components
              // render as their own islands instead of joining the layout's React tree.
              pageElement = this.rendererRuntime.isolateServerPageGraph(pageElement);
            }

            // Every route gets a stable HTML boundary. Server-only pages keep
            // native markup with no React root; interactive pages hydrate this
            // exact boundary.
            pageElement = this.createPageBoundary(pageElement, {
              pageShouldHydrate: isClientComponent || shouldHydrate,
              layoutShouldHydrate: shouldHydrateLayout,
              islandStrategy: hydrationIslandStrategy,
            });

            let wrappedElement: any = pageElement;
            for (let i = layoutModules.length - 1; i >= 0; i--) {
              const layoutModule = layoutModules[i];
              const layoutEntry = layouts[i];
              const LayoutComponent = layoutModule.default;
              const slotProps: Record<string, any> = {};
              for (const slot of renderedRouteSlots) {
                if (slot.ownerPattern !== layoutEntry.pattern) continue;

                let slotElement = this.rendererRuntime.createElement(
                  slot.module.default,
                  slot.props,
                );
                slotElement = this.wrapClientGraph(slotElement);
                slotElement = this.rendererRuntime.createElement(
                  "div",
                  {
                    id: slot.containerId,
                    "data-farm-route-slot": slot.name,
                    "data-farm-slot-owner": slot.ownerPattern,
                  },
                  slotElement,
                );
                slotProps[slot.name] = slotElement;
              }
              wrappedElement = this.rendererRuntime.createElement(LayoutComponent, {
                children: wrappedElement,
                params,
                ...slotProps,
              });
              wrappedElement = this.createLayoutBoundary(layoutEntry.pattern, wrappedElement);
            }

            if (shouldHydrateLayout) {
              wrappedElement = this.wrapClientGraph(wrappedElement);
            }

            if (ErrorFallbackComponent && this.rendererRuntime.ErrorBoundary) {
              wrappedElement = this.rendererRuntime.createElement(
                this.rendererRuntime.ErrorBoundary,
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
                routeManifest,
                captureStaticShell: Boolean(pprShellOptions),
                observabilityRoute: pathname,
                onSuspenseHoleDetected: pprShellOptions
                  ? () =>
                      emitFarmEvent({
                        type: "ppr.suspense.holeDetected",
                        route: pathname,
                      })
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
    } catch (caughtError) {
      let error = caughtError;

      if (isWebResponse(error)) {
        if (!res.headersSent && !(res as any).writableEnded) {
          await sendWebResponse(res, error);
        } else if (!(res as any).writableEnded) {
          res.end();
        }
        completeRender(error.status, pathname);
        return;
      }

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
          try {
            await this.render404(req, res);
            completeRender(404, pathname);
            return;
          } catch (notFoundRenderError) {
            error = notFoundRenderError;
          }
        } else {
          if (!(res as any).writableEnded) {
            res.end();
          }
          completeRender(404, pathname);
          return;
        }
      }

      emitFarmEvent({ type: "render.error", route: pathname, error });
      const errorStatus = resolveDefaultErrorStatus(error);
      if (pprRefreshRoute) {
        emitFarmEvent({
          type: "ppr.refresh.error",
          route: pprRefreshRoute,
          error,
        });
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
          statusCode: errorStatus,
          errorModulePath: errorBoundaryEntry.modulePath,
        });

        if (rendered) {
          return;
        }
      }

      await this.renderError(req, res, error, errorStatus);
    }
  }

  private async wrapWithIntegrationProviders(element: any): Promise<any> {
    const providers = getIntegrationProviders(this.config.integrations);
    let wrapped = element;

    for (let i = providers.length - 1; i >= 0; i--) {
      const provider = providers[i];
      if (provider.component || provider.type === "clerk") {
        // Production gates on the same capability (nitro/universal-build.ts).
        // A renderer identity check here left every non-React renderer that
        // can host function components throwing in development while its
        // build worked, and named the provider kind rather than the
        // integration in the message.
        const rendererCapabilities = getFarmRendererCapabilities(this.config.renderer);
        if (!rendererCapabilities.functionComponents) {
          throw new Error(
            `Integration provider \`${provider.name}\` requires a renderer that can host ` +
              `function components; \`${this.config.renderer?.name ?? "the configured renderer"}\` cannot.`,
          );
        }
        if (provider.type === "clerk" && !isReactRenderer(this.config.renderer)) {
          throw new Error(
            `Integration provider \`${provider.name}\` uses Clerk's React components, which ` +
              "require the React renderer.",
          );
        }
        let ProviderComponent;
        let providerSourceModule: string | undefined;
        if (isFarmIntegrationProviderComponentReference(provider.component)) {
          providerSourceModule = provider.component.module;
          const providerModuleId = provider.component.module.startsWith(".")
            ? toViteModuleId(
                path.resolve(this.config.root, provider.component.module),
                this.config.root,
              )
            : provider.component.module;
          const providerModule = this.viteServer
            ? await this.viteServer.ssrLoadModule(providerModuleId)
            : await importRuntimeModule(
                provider.component.module.startsWith(".")
                  ? pathToFileURL(path.resolve(this.config.root, provider.component.module)).href
                  : provider.component.module,
              );
          ProviderComponent = providerModule[provider.component.export || "default"];
        } else if (typeof provider.component === "function") {
          ProviderComponent = provider.component;
        } else if (provider.type === "clerk") {
          if (!cachedClerkProvider) {
            cachedClerkProvider = await importRuntimeModule("@clerk/react");
          }
          ProviderComponent = cachedClerkProvider!.ClerkProvider;
        } else {
          throw new Error(
            `Integration provider \`${provider.name}\` has an invalid component reference.`,
          );
        }
        if (!ProviderComponent) {
          throw new Error(
            `Integration provider \`${provider.name}\` did not export its configured component.`,
          );
        }

        // A renderer that compiles its own components cannot tell a plain
        // function component from one of its own, so the build marks the ones
        // Farm wires up (integration-provider-build.ts). Development resolves
        // the module itself and must mark it the same way, or the compat root
        // tries to instantiate a function as a compiled component.
        if (
          provider.type !== "clerk" &&
          typeof this.rendererRuntime.markFunctionComponent === "function" &&
          !isRendererCompiledComponent(
            providerSourceModule ?? "",
            resolveFarmComponentExtensions(this.config.renderer?.componentExtensions),
          )
        ) {
          ProviderComponent = this.rendererRuntime.markFunctionComponent(ProviderComponent);
        }

        wrapped = this.rendererRuntime.createElement(
          ProviderComponent,
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
          await layoutModule.generateMetadata({
            params: options.pageProps.params,
          }),
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

    if (!metadata.manifest) {
      const manifestMatch = this.routeManager.getMatchingMetadataRoute(
        options.pathname,
        "manifest",
      );
      if (manifestMatch) {
        const rawHref = this.routeManager.resolveMetadataRoutePath(
          manifestMatch.metadata,
          manifestMatch.params,
        );
        const snapshot = getFarmI18nClientSnapshot();
        const localizedHref = snapshot
          ? localizeFarmHref(rawHref, snapshot.locale, snapshot)
          : rawHref;
        metadata.manifest = applyFarmBasePath(localizedHref, this.config.basePath);
      }
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
    const localizedHref = snapshot ? localizeFarmHref(rawHref, snapshot.locale, snapshot) : rawHref;
    const href = applyFarmBasePath(localizedHref, this.config.basePath);
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

  private async renderMetadataRoute(
    req: FarmRequest,
    res: FarmResponse,
    match: NonNullable<ReturnType<RouteManager["matchMetadataRoute"]>>,
  ): Promise<void> {
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end();
      return;
    }

    try {
      const routeModule = await this.routeManager.loadRouteModule(match.metadata.modulePath);
      if (routeModule.default === undefined) {
        throw new Error(
          `Metadata route module ${match.metadata.modulePath} does not export a default value or handler`,
        );
      }

      const request = createWebRequestFromFarmRequest(req, {
        trustProxy: this.config.server?.trustProxy,
      });
      const url = new URL(request.url);
      const llmsContext: Partial<Awaited<ReturnType<ServerRenderer["createLlmsTxtContext"]>>> =
        match.metadata.kind === "llms" || match.metadata.kind === "llms-full"
          ? await this.createLlmsTxtContext(request, {
              full: match.metadata.kind === "llms-full",
              req,
            })
          : {};
      const value =
        typeof routeModule.default === "function"
          ? await (routeModule.default as any)({
              request,
              params: match.params,
              searchParams: url.searchParams,
              path: match.routePath,
              ...llmsContext,
            })
          : routeModule.default;
      // llms-full objects need each page's Markdown, which only this side can fetch.
      const body =
        match.metadata.kind === "llms-full" && !(value instanceof Response)
          ? await renderFarmLlmsFullTxt(value, {
              origin: url.origin,
              readMarkdown: llmsContext.markdown!,
            })
          : value;
      const response = createFarmMetadataRouteResponse(match.metadata.kind, body, routeModule, {
        method,
      });
      await sendWebResponse(res as any, response);
    } catch (error) {
      logger.error(`Metadata route render failed for ${match.metadata.modulePath}: ${error}`);
      await sendWebResponse(
        res as any,
        new Response("Internal Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      );
    }
  }

  /** `/llms.txt` and `/llms-full.txt` from `agent.llmsTxt` when no file route owns them. */
  private getGeneratedLlmsKind(pathname: string): "llms" | "llms-full" | null {
    const config = resolveFarmLlmsTxtConfig(this.config.agent?.llmsTxt);
    if (!config.enabled) return null;
    if (pathname === "/llms.txt") return "llms";
    return pathname === "/llms-full.txt" && config.full ? "llms-full" : null;
  }

  private async renderGeneratedLlmsTxt(
    req: FarmRequest,
    res: FarmResponse,
    kind: "llms" | "llms-full",
  ): Promise<void> {
    try {
      const request = createWebRequestFromFarmRequest(req, {
        trustProxy: this.config.server?.trustProxy,
      });
      const config = resolveFarmLlmsTxtConfig(this.config.agent?.llmsTxt);
      const context = await this.createLlmsTxtContext(request, { full: kind === "llms-full", req });
      const body =
        kind === "llms-full"
          ? await renderFarmLlmsFullTxt(context.defaults, {
              origin: new URL(request.url).origin,
              readMarkdown: context.markdown!,
            })
          : context.defaults;
      await sendWebResponse(
        res as any,
        createFarmMetadataRouteResponse(
          kind,
          body,
          { revalidate: config.revalidate },
          { method: req.method },
        ),
      );
    } catch (error) {
      logger.error(`Generated ${kind}.txt failed: ${error}`);
      await sendWebResponse(
        res as any,
        new Response("Internal Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      );
    }
  }

  /** Same inputs the production server gives llms.txt: static pages and root metadata. */
  private async createLlmsTxtContext(
    request: Request,
    options: { full?: boolean; req?: FarmRequest } = {},
  ): Promise<{
    pages: ReturnType<typeof collectFarmLlmsTxtPages>;
    defaults: ReturnType<typeof createFarmDefaultLlmsTxt>;
    markdown?: (url: string) => Promise<string | null>;
  }> {
    const config = resolveFarmLlmsTxtConfig(this.config.agent?.llmsTxt);
    const origin = new URL(request.url).origin;
    const staticRoutes = [...this.routeManager.getRoutes()].filter(
      ([pattern]) => !pattern.includes("["),
    );
    const sources = await Promise.all(
      staticRoutes.map(async ([pattern, route]) => {
        try {
          const metadata = (await this.routeManager.loadRouteModule(route.modulePath)).metadata;
          return { pattern, metadata: metadata as unknown };
        } catch (error) {
          // The page itself will surface this error; list it with its fallback title.
          logger.warn(`Could not read metadata for ${pattern} in llms.txt: ${error}`);
          return { pattern };
        }
      }),
    );

    const rootLayout = this.routeManager.getLayouts().get("/");
    const rootMetadata = rootLayout
      ? (await this.routeManager.loadLayoutModule(rootLayout.modulePath)).metadata
      : undefined;
    const pages = collectFarmLlmsTxtPages(sources, {
      origin,
      basePath: this.config.basePath,
      markdown: resolveMarkdownConfig(this.config.md as any),
      include: config.include,
      exclude: config.exclude,
    });
    return {
      pages,
      defaults: createFarmDefaultLlmsTxt({ origin, pages, config, rootMetadata }),
      ...(options.full ? { markdown: this.createDevMarkdownReader(options.req) } : {}),
    };
  }

  /**
   * Reads page mirrors back through this dev server, the way its .md handler
   * renders pages, so Markdown sources and agent overrides are included. Requests
   * go to the server's own socket address: the page URLs carry the Host header,
   * which a client controls, and fetching them would let anyone who can reach a
   * network-exposed dev server point it at other hosts. Over HTTPS the certificate
   * is still checked against the requested hostname. HEAD reads nothing, since its
   * body is discarded.
   */
  private createDevMarkdownReader(req?: FarmRequest): (url: string) => Promise<string | null> {
    const socket = req?.socket as
      | { localAddress?: string; localPort?: number; encrypted?: boolean }
      | undefined;
    if (req?.method?.toUpperCase() === "HEAD" || !socket?.localAddress || !socket.localPort) {
      return async () => null;
    }
    if (socket.encrypted) {
      const address = { host: socket.localAddress, port: socket.localPort };
      return createFarmLlmsMarkdownReader((page) => requestOwnHttpsServer(page, address));
    }
    const host = socket.localAddress.includes(":")
      ? `[${socket.localAddress}]`
      : socket.localAddress;
    const localOrigin = `http://${host}:${socket.localPort}`;
    const read = createFarmLlmsMarkdownReader((page) => fetch(page));
    return (url) => {
      const target = new URL(url);
      return read(`${localOrigin}${target.pathname}${target.search}`);
    };
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
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end();
      return;
    }

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
    const ifNoneMatch = req.headers["if-none-match"];
    const response = await createFarmMetadataImageResponse(value, imageModule, {
      method: req.method,
      ifNoneMatch: Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch,
    });
    await sendWebResponse(res as any, response);
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
    const requestUrl = resolveFarmRequestURL(req, {
      trustProxy: this.config.server?.trustProxy,
    });
    const isVersioned = requestUrl.searchParams.get("v") === image.staticInfo.hash;

    res.setHeader("Content-Type", image.staticInfo.contentType);
    res.setHeader("Content-Length", image.staticInfo.byteLength);
    res.setHeader("ETag", etag);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Cache-Control",
      isVersioned ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
    );

    if (matchesFarmIfNoneMatch(req.headers["if-none-match"], etag)) {
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
      statusCode: number;
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

      const ErrorComponent = errorModule.default;
      const errorElement = this.rendererRuntime.createElement(ErrorComponent, {
        ...createRouteStateProps({
          params: options.params,
          searchParamsObject: options.searchParamsObject,
          path: options.pathname,
          middlewareMap: options.middlewareMap,
          pluginExposedContext: options.pluginExposedContext,
        }),
        error: options.error,
        reset: () => {},
      });

      let wrapped: any = errorElement;
      const layoutModules = await Promise.all(
        options.layouts.map((layout) => this.routeManager.loadLayoutModule(layout.modulePath)),
      );
      for (let i = layoutModules.length - 1; i >= 0; i--) {
        const LayoutComponent = layoutModules[i].default;
        wrapped = this.rendererRuntime.createElement(LayoutComponent, {
          children: wrapped,
          params: options.params,
        });
      }

      wrapped = await this.wrapWithIntegrationProviders(wrapped);

      const html = await _runWithMiddlewareData(options.middlewareMap, () =>
        _runWithMiddlewareContext(options.middlewareContext, () =>
          this.rendererRuntime.renderToString(wrapped),
        ),
      );
      res.statusCode = options.statusCode;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      // A PPR shell failure leaves the "miss" caching headers (s-maxage,
      // stale-while-revalidate, X-Farm-PPR) on res. Error responses must not be
      // cached by shared/CDN caches, so clear them here, matching renderError.
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (typeof res.removeHeader === "function") {
        res.removeHeader("X-Farm-PPR");
      }
      res.write(
        this.secureDocumentHTML(
          req,
          this.createFullHTML(html, false, options.pathname, undefined, { req }),
        ),
      );
      res.end();
      return true;
    } catch (renderError) {
      logger.warn(`Failed to render route-level error boundary: ${renderError}`);
      return false;
    }
  }

  private async renderBufferedSSR(
    element: unknown,
    req: FarmRequest,
    res: FarmResponse,
    clearMiddlewareData?: () => void,
    options: {
      responseHeaders?: Record<string, string> | undefined;
      routeManifest?: ReturnType<RouteManager["generateClientManifest"]>;
      onComplete?: (html: string) => void | Promise<void>;
      captureStaticShell?: boolean;
      observabilityRoute?: string;
      onSuspenseHoleDetected?: () => void;
    } = {},
  ): Promise<void> {
    const startedAt = Date.now();
    const route = options.observabilityRoute || (req as any).__FARM_ROUTE__ || req.url || "/";
    emitFarmEvent({ type: "render.stream.start", route });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    for (const [key, value] of Object.entries(options.responseHeaders || {})) {
      res.setHeader(key, value);
    }

    try {
      const manifest =
        options.routeManifest ?? this.routeManager.generateClientManifest(this.config.root);
      const clientManifest = {
        clientEntry: "/@farm/client.js",
        routes: {} as Record<string, any>,
        layouts: {} as Record<string, any>,
        slots: [] as Array<Record<string, any>>,
        sharedAssets: [
          {
            tag: "link",
            attrs: { rel: "stylesheet", href: "/src/app/globals.css" },
          },
          ...this.collectDevStyleHrefs().map((href) => ({
            tag: "link",
            attrs: { rel: "stylesheet", href },
          })),
        ],
      };

      for (const routeEntry of manifest.routes) {
        clientManifest.routes[routeEntry.pattern] = {
          modulePath: routeEntry.modulePath,
          pattern: routeEntry.pattern,
          segments: routeEntry.segments,
          search: routeEntry.search,
          isClientComponent: routeEntry.isClientComponent,
          shouldHydrate: routeEntry.shouldHydrate,
          islandStrategy: routeEntry.islandStrategy,
          renderPlan: routeEntry.renderPlan,
          preloads: [routeEntry.modulePath],
          assets: [],
        };
      }
      for (const layoutEntry of manifest.layouts) {
        clientManifest.layouts[layoutEntry.pattern] = {
          modulePath: layoutEntry.modulePath,
          pattern: layoutEntry.pattern,
          shouldHydrate: layoutEntry.shouldHydrate,
          islandStrategy: layoutEntry.islandStrategy,
          preloads: [layoutEntry.modulePath],
          assets: [],
        };
      }
      for (const slotEntry of manifest.slots ?? []) {
        clientManifest.slots.push({
          ...slotEntry,
          preloads: [slotEntry.modulePath],
          assets: [],
        });
      }

      const routeSlots = ((req as any).__FARM_ROUTE_SLOTS__ || []).map(
        (slot: Record<string, any>) => ({
          ...slot,
          modulePath:
            typeof slot.modulePath === "string"
              ? toViteModuleId(slot.modulePath, this.config.root)
              : slot.modulePath,
        }),
      );
      const deferredProps = prepareDeferredData({
        page: (req as any).__FARM_PROPS__ || {},
        slots: routeSlots,
      });
      const pagePath = (req as any).__FARM_PAGE_PATH__;
      const relativePath = pagePath
        ? toViteModuleId(pagePath, this.config.root)
        : "/src/app/page.tsx";
      const deploymentId = this.getDeploymentId();
      const bootstrapScript = `<script data-farm-refresh-state>
window.__FARM_PROPS__ = ${serializeInlineValue((deferredProps.data as any).page)};
window.__FARM_ROUTE_SLOTS__ = ${serializeInlineValue((deferredProps.data as any).slots)};
window.__FARM_DEPLOYMENT_ID__ = ${serializeInlineValue(deploymentId)};
window.__FARM_PATH__ = ${JSON.stringify((req as any).__FARM_ROUTE__ || req.url || "/")};
window.__FARM_IS_CLIENT__ = ${JSON.stringify((req as any).__FARM_IS_CLIENT_COMPONENT__ === true)};
window.__FARM_PAGE_SHOULD_HYDRATE__ = ${JSON.stringify((req as any).__FARM_PAGE_SHOULD_HYDRATE__ === true)};
window.__FARM_LAYOUT_SHOULD_HYDRATE__ = ${JSON.stringify((req as any).__FARM_LAYOUT_SHOULD_HYDRATE__ === true)};
window.__FARM_LAYOUTS__ = ${JSON.stringify((req as any).__FARM_LAYOUTS__ || [])};
window.__FARM_SHOULD_HYDRATE__ = ${JSON.stringify((req as any).__FARM_SHOULD_HYDRATE__ === true)};
window.__FARM_HAS_ISOLATED_CLIENT_BOUNDARIES__ = ${JSON.stringify(
        (req as any).__FARM_HAS_ISOLATED_CLIENT_BOUNDARIES__ === true,
      )};
window.__FARM_ISLAND_STRATEGY__ = ${JSON.stringify((req as any).__FARM_ISLAND_STRATEGY__ || "load")};
window.__FARM_PAGE_MODULE__ = ${JSON.stringify(relativePath)};
window.__FARM_LOADING_MODULE__ = ${JSON.stringify((req as any).__FARM_LOADING_MODULE_PATH__ || null)};
window.__FARM_MANIFEST__ = ${JSON.stringify(clientManifest)};
window.__FARM_INTEGRATION_API_MANIFEST__ = ${JSON.stringify(getRegisteredIntegrationAPIManifest())};
window.__FARM_I18N__ = ${getFarmI18nClientSnapshot() ? serializeInlineValue(getFarmI18nClientSnapshot()) : "null"};
</script>`;
      const deferredScript = createDeferredHydrationScript(deferredProps.records);
      const rendererHydrationScript = this.rendererRuntime.generateHydrationScript?.() || "";
      const { html: content, head: rendererHead } =
        await this.renderElementToDocumentParts(element);
      const {
        title,
        tags: metaTags,
        hasFavicon,
        hasExplicitTitle,
      } = renderMetadataHead((req as any).__FARM_METADATA__, {
        pathname: getFarmMetadataPathname(req),
        jsonLd: this.config.agent?.jsonLd,
      });
      // A renderer-emitted <title> (e.g. <svelte:head>) must take effect: the
      // first <title> in a document wins, so the fallback framework title is
      // suppressed when the renderer supplies one. Explicit metadata titles
      // still come first and win.
      const documentTitleTag =
        !hasExplicitTitle && /<title[\s>]/i.test(rendererHead) ? "" : `<title>${title}</title>`;
      const rendererHasTitle = /<title[\s>]/i.test(rendererHead);
      const i18nSnapshot = getFarmI18nClientSnapshot();
      const alternateTags = i18nSnapshot
        ? renderI18nAlternateLinks(
            (req as any).__FARM_ROUTE__ || req.url || "/",
            i18nSnapshot,
            this.getI18nAlternateOptions(req, (req as any).__FARM_METADATA__),
          )
        : "";
      const themeDocument = createFarmThemeDocumentParts(
        this.config.theme,
        this.config.basePath,
        getFarmTheme(),
      );

      // A layout that returns its own full `<html>` document is composed as the
      // document (Farm assets merged in) rather than nested inside the shell,
      // matching the production build and avoiding invalid nested documents.
      const fullDocument = extractFarmFullDocument(content);
      let html: string;
      if (fullDocument) {
        warnFarmFullDocumentLayout();
        const shouldReplaceLayoutTitle = hasExplicitTitle || rendererHasTitle;
        const documentHtml = shouldReplaceLayoutTitle
          ? removeFarmDocumentTitles(fullDocument)
          : fullDocument;
        const effectiveRendererHead = hasExplicitTitle
          ? removeFarmDocumentTitles(rendererHead)
          : rendererHead;
        html = composeFarmFullDocument(documentHtml, {
          htmlAttributes: `${
            i18nSnapshot
              ? ` lang="${escapeHtmlAttribute(i18nSnapshot.locale)}" dir="${escapeHtmlAttribute(i18nSnapshot.direction)}"`
              : ""
          }${themeDocument.attributes}`,
          replaceHtmlAttributes: [
            ...(i18nSnapshot ? ["lang", "dir"] : []),
            ...(themeDocument.attributes ? ["data-theme"] : []),
          ],
          headAssets: [
            themeDocument.head,
            `<meta name="farm-deployment-id" content="${escapeHtmlAttribute(deploymentId)}">`,
            hasExplicitTitle ? documentTitleTag : "",
            metaTags,
            alternateTags,
            effectiveRendererHead,
            renderFarmFontDevHead(this.config.root || process.cwd()),
            `<link rel="stylesheet" href="/src/app/globals.css">`,
            ...this.collectDevStyleLinks(),
            `<script type="module" src="/@vite/client"></script>`,
            rendererHydrationScript,
            bootstrapScript,
          ]
            .filter(Boolean)
            .join("\n  "),
          bodyFooter: [deferredScript, `<script type="module" src="/@farm/client.js"></script>`]
            .filter(Boolean)
            .join("\n  "),
        });
      } else {
        html = `<!DOCTYPE html>
<html lang="${escapeHtmlAttribute(i18nSnapshot?.locale || "en")}"${
          i18nSnapshot ? ` dir="${i18nSnapshot.direction}"` : ""
        }${themeDocument.attributes}>
<head>
  ${themeDocument.head}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="farm-deployment-id" content="${escapeHtmlAttribute(deploymentId)}">
  ${hasFavicon ? "" : '<link rel="icon" href="data:,">'}
  ${documentTitleTag}${metaTags}${alternateTags}${rendererHead ? `\n  ${rendererHead}` : ""}
  ${renderFarmFontDevHead(this.config.root || process.cwd())}
  <link rel="stylesheet" href="/src/app/globals.css">${this.collectDevStyleLinks()
    .map((l) => `\n  ${l}`)
    .join("")}
  <script type="module" src="/@vite/client"></script>
  ${rendererHydrationScript}
  ${bootstrapScript}
</head>
<body class="">
  <div id="root">${content}</div>
  ${deferredScript}
  <script type="module" src="/@farm/client.js"></script>
</body>
</html>`;
      }

      emitFarmEvent({
        type: "render.stream.shellReady",
        route,
        durationMs: Date.now() - startedAt,
      });
      const securedHtml = this.secureDocumentHTML(req, html);
      if ((req.method || "GET").toUpperCase() !== "HEAD") res.write(securedHtml);
      res.end();
      // The buffered document is rendered per request and never split at a
      // static boundary, so a shell capture must not store it: caching it
      // would serve this visitor's data to everyone until revalidation.
      if (!options.captureStaticShell) await options.onComplete?.(securedHtml);
      emitFarmEvent({
        type: "render.stream.complete",
        route,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      emitFarmEvent({ type: "render.error", route, error });
      throw error;
    } finally {
      clearMiddlewareData?.();
    }
  }

  private async renderWithSSR(
    element: any,
    req: FarmRequest,
    res: FarmResponse,
    clearMiddlewareData?: () => void,
    options: {
      responseHeaders?: Record<string, string> | undefined;
      routeManifest?: ReturnType<RouteManager["generateClientManifest"]>;
      onComplete?: (html: string) => void | Promise<void>;
      captureStaticShell?: boolean;
      observabilityRoute?: string;
      onSuspenseHoleDetected?: () => void;
    } = {},
  ): Promise<void> {
    const renderToPipeableStream = this.rendererRuntime.renderToPipeableStream;
    const fullDocumentRouteKey =
      options.observabilityRoute || (req as any).__FARM_ROUTE__ || req.url || "/";
    // A full-document layout can't be composed once the stream's shell is
    // flushed, so a route previously seen to render one is served through the
    // buffered path, which produces a valid single document.
    if (!renderToPipeableStream || fullDocumentRoutes.has(fullDocumentRouteKey)) {
      return this.renderBufferedSSR(element, req, res, clearMiddlewareData, options);
    }

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
      // Splitting a static shell out of the stream requires knowing where the
      // first dynamic boundary is, and only the renderer that emitted the
      // markers can say. Without that, every chunk would look static and a
      // per-request response would be cached as a shared shell, so skip the
      // shell entirely rather than guess.
      const findStaticShellBoundary = this.rendererRuntime.findStaticShellBoundary;
      const staticShellParts: string[] | undefined =
        options.captureStaticShell && findStaticShellBoundary ? [] : undefined;
      let staticShellClosed = false;
      let suspenseHoleEmitted = false;
      let didError = false;
      // redirect() and notFound() thrown while React renders the shell's first
      // pass (a synchronous page under a loading boundary) still decide the
      // response, because nothing has been sent. One thrown after the shell
      // went out can only be recovered in the document.
      let shellFlushed = false;
      let pendingNavigationError: unknown = null;
      let lateNavigationError: unknown = null;

      // Get the page path for client-side hydration
      const pagePath = (req as any).__FARM_PAGE_PATH__;
      const isClientComponent = (req as any).__FARM_IS_CLIENT_COMPONENT__ === true;
      const relativePath = pagePath
        ? toViteModuleId(pagePath, this.config.root)
        : "/src/app/page.tsx";

      // Generate manifest for client-side SPA navigation (TanStack Start pattern)
      // This manifest is inlined in HTML - no separate file or API endpoint
      const manifest =
        options.routeManifest ?? this.routeManager.generateClientManifest(this.config.root);

      // Convert to object format for client
      const clientManifest = {
        clientEntry: "/@farm/client.js",
        routes: {} as Record<string, any>,
        layouts: {} as Record<string, any>,
        slots: [] as Array<Record<string, any>>,
        sharedAssets: [
          {
            tag: "link",
            attrs: { rel: "stylesheet", href: "/src/app/globals.css" },
          },
          ...this.collectDevStyleHrefs().map((href) => ({
            tag: "link",
            attrs: { rel: "stylesheet", href },
          })),
        ],
      };

      // Convert routes array to object keyed by pattern
      for (const routeEntry of manifest.routes) {
        clientManifest.routes[routeEntry.pattern] = {
          modulePath: routeEntry.modulePath,
          pattern: routeEntry.pattern,
          segments: routeEntry.segments,
          search: routeEntry.search,
          isClientComponent: routeEntry.isClientComponent,
          shouldHydrate: routeEntry.shouldHydrate,
          islandStrategy: routeEntry.islandStrategy,
          renderPlan: routeEntry.renderPlan,
          preloads: [routeEntry.modulePath],
          assets: [],
        };
      }

      // Convert layouts array to object
      for (const layoutEntry of manifest.layouts) {
        clientManifest.layouts[layoutEntry.pattern] = {
          modulePath: layoutEntry.modulePath,
          pattern: layoutEntry.pattern,
          shouldHydrate: layoutEntry.shouldHydrate,
          islandStrategy: layoutEntry.islandStrategy,
          preloads: [layoutEntry.modulePath],
          assets: [],
        };
      }

      for (const slotEntry of manifest.slots ?? []) {
        clientManifest.slots.push({
          ...slotEntry,
          preloads: [slotEntry.modulePath],
          assets: [],
        });
      }

      // Inject page props, component info, and MANIFEST for client-side SPA
      // __FARM_MANIFEST__ contains the full route manifest (TanStack Start pattern)
      const routeSlotPayload = ((req as any).__FARM_ROUTE_SLOTS__ || []).map(
        (slot: Record<string, any>) => ({
          ...slot,
          modulePath:
            typeof slot.modulePath === "string"
              ? toViteModuleId(slot.modulePath, this.config.root)
              : slot.modulePath,
        }),
      );
      const deferredProps = prepareDeferredData({
        page: (req as any).__FARM_PROPS__ || {},
        slots: routeSlotPayload,
      });
      const propsScript = `<script data-farm-refresh-state>
window.__FARM_PROPS__ = ${serializeInlineValue((deferredProps.data as any).page)};
window.__FARM_ROUTE_SLOTS__ = ${serializeInlineValue((deferredProps.data as any).slots)};
window.__FARM_DEPLOYMENT_ID__ = ${serializeInlineValue(deploymentId)};
window.__FARM_PATH__ = ${JSON.stringify((req as any).__FARM_ROUTE__ || req.url || "/")};
window.__FARM_IS_CLIENT__ = ${JSON.stringify(isClientComponent)};
window.__FARM_PAGE_SHOULD_HYDRATE__ = ${JSON.stringify(
        (req as any).__FARM_PAGE_SHOULD_HYDRATE__ === true,
      )};
window.__FARM_LAYOUT_SHOULD_HYDRATE__ = ${JSON.stringify(
        (req as any).__FARM_LAYOUT_SHOULD_HYDRATE__ === true,
      )};
window.__FARM_LAYOUTS__ = ${JSON.stringify((req as any).__FARM_LAYOUTS__ || [])};
window.__FARM_SHOULD_HYDRATE__ = ${JSON.stringify((req as any).__FARM_SHOULD_HYDRATE__ === true)};
window.__FARM_HAS_ISOLATED_CLIENT_BOUNDARIES__ = ${JSON.stringify(
        (req as any).__FARM_HAS_ISOLATED_CLIENT_BOUNDARIES__ === true,
      )};
window.__FARM_ISLAND_STRATEGY__ = ${JSON.stringify((req as any).__FARM_ISLAND_STRATEGY__ || "load")};
window.__FARM_PAGE_MODULE__ = ${JSON.stringify(relativePath)};
window.__FARM_LOADING_MODULE__ = ${JSON.stringify(
        (req as any).__FARM_LOADING_MODULE_PATH__ || null,
      )};
window.__FARM_MANIFEST__ = ${JSON.stringify(clientManifest)};
window.__FARM_INTEGRATION_API_MANIFEST__ = ${JSON.stringify(getRegisteredIntegrationAPIManifest())};
window.__FARM_I18N__ = ${getFarmI18nClientSnapshot() ? serializeInlineValue(getFarmI18nClientSnapshot()) : "null"};
</script>`;
      const hydrationClickQueueScript =
        isClientComponent ||
        (req as any).__FARM_SHOULD_HYDRATE__ === true ||
        (req as any).__FARM_HAS_HYDRATABLE_ROUTE_SLOTS__ === true
          ? createPreHydrationClickQueueScript()
          : "";

      const {
        title,
        tags: metaTags,
        hasFavicon,
      } = renderMetadataHead((req as any).__FARM_METADATA__, {
        pathname: getFarmMetadataPathname(req),
        jsonLd: this.config.agent?.jsonLd,
      });
      const i18nSnapshot = getFarmI18nClientSnapshot();
      const i18nAlternateTags = i18nSnapshot
        ? renderI18nAlternateLinks(
            (req as any).__FARM_ROUTE__ || req.url || "/",
            i18nSnapshot,
            this.getI18nAlternateOptions(req, (req as any).__FARM_METADATA__),
          )
        : "";
      const fontHead = renderFarmFontDevHead(this.config.root || process.cwd());
      const themeDocument = createFarmThemeDocumentParts(
        this.config.theme,
        this.config.basePath,
        getFarmTheme(),
      );

      // React 19: ensure root is a single DOM node so streaming starts early (avoids Fragment delay).
      // A hydrating layout tree already starts with its layout boundary, and the client hydrates
      // #root with exactly that tree (as production renders it), so it must not gain a wrapper.
      const streamRoot =
        (req as any).__FARM_LAYOUT_SHOULD_HYDRATE__ === true
          ? element
          : this.rendererRuntime.createElement("div", { style: { display: "contents" } }, element);
      const devStyleLinks = this.collectDevStyleLinks();
      const cspNonce = this.getCspNonce(req);
      const secureDocumentHTML = (html: string) =>
        cspNonce ? addFarmCspNonceToScriptTags(html, cspNonce) : html;
      const createLateNavigationRecovery = (navigationError: unknown) =>
        this.createLateNavigationRecoveryHTML(req, navigationError);
      const { pipe, abort } = renderToPipeableStream(streamRoot, {
        nonce: cspNonce,
        onShellReady() {
          if (pendingNavigationError) {
            abort?.(pendingNavigationError);
            if (clearMiddlewareData) {
              clearMiddlewareData();
            }
            reject(pendingNavigationError);
            return;
          }
          shellFlushed = true;
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
          }${themeDocument.attributes}>
<head>
  ${themeDocument.head}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="farm-deployment-id" content="${escapeHtmlAttribute(deploymentId)}">
  ${hasFavicon ? "" : '<link rel="icon" href="data:,">'}
  <title>${title}</title>${metaTags}${i18nAlternateTags}
  ${fontHead}
  <link rel="stylesheet" href="/src/app/globals.css" />${devStyleLinks
    .map((l) => `\n  ${l}`)
    .join("")}
  <script type="module" src="/@vite/client"></script>
  ${propsScript}
  ${hydrationClickQueueScript}
</head>
<body class="">
  <div id="root">`;
          const securedShell = secureDocumentHTML(shell);
          htmlParts.push(securedShell);
          staticShellParts?.push(securedShell);

          let firstChunk = true;
          let checkedFullDocument = false;
          const cspNonceRewriter = cspNonce ? createFarmCspNonceRewriter(cspNonce) : undefined;
          const cspStreamDecoder = cspNonceRewriter ? new TextDecoder() : undefined;
          const recordRenderedChunk = (chunkText: string) => {
            if (!chunkText) return;
            if (!checkedFullDocument) {
              checkedFullDocument = true;
              if (opensFarmFullDocument(chunkText)) {
                fullDocumentRoutes.add(fullDocumentRouteKey);
                warnFarmFullDocumentLayout();
              }
            }
            htmlParts.push(chunkText);

            if (staticShellParts && findStaticShellBoundary && !staticShellClosed) {
              const dynamicIndex = findStaticShellBoundary(chunkText);
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
          };
          const writableStream = new Writable({
            write(chunk, encoding, callback) {
              if (firstChunk && process.env.FARM_VERBOSE) {
                console.log(`[FARM STREAM] first pipe chunk at ${Date.now() - streamStartTime}ms`);
                firstChunk = false;
              }
              const chunkText = Buffer.isBuffer(chunk)
                ? cspStreamDecoder
                  ? cspStreamDecoder.decode(chunk, { stream: true })
                  : chunk.toString()
                : String(chunk);
              const securedChunkText = cspNonceRewriter
                ? cspNonceRewriter.write(chunkText)
                : chunkText;
              // The shell was already flushed, so this response still nests the
              // document; record the route so later requests take the buffered
              // path (which composes it correctly) and warn the developer once.
              recordRenderedChunk(securedChunkText);

              const onWrite = () => {
                if (typeof (res as any).flush === "function") (res as any).flush();
                callback();
              };
              if (cspNonceRewriter) res.write(securedChunkText, onWrite);
              else res.write(chunk, encoding, onWrite);
            },
            final: (callback) => {
              if (lateNavigationError) {
                const navigationError = lateNavigationError;
                lateNavigationError = null;
                createLateNavigationRecovery(navigationError).then(
                  (recovery: string) => {
                    const secured = secureDocumentHTML(recovery);
                    htmlParts.push(secured);
                    res.write(secured);
                    finishStream(callback);
                  },
                  (error: unknown) => {
                    logger.error(`Could not recover from a late navigation error: ${error}`);
                    finishStream(callback);
                  },
                );
                return;
              }
              finishStream(callback);
            },
          });
          const finishStream = (callback: (error?: Error | null) => void) => {
            if (cspNonceRewriter) {
              const tail = cspNonceRewriter.write(cspStreamDecoder!.decode(), true);
              recordRenderedChunk(tail);
              if (tail) res.write(tail);
            }
            const suspenseRevealFallback = `<script>(function(){function moveFragment(srcId,placeholderId){var src=document.getElementById(srcId),ph=document.getElementById(placeholderId);if(!src||!ph||!ph.parentNode)return false;while(src.firstChild)ph.parentNode.insertBefore(src.firstChild,ph);ph.parentNode.removeChild(ph);if(src.parentNode)src.parentNode.removeChild(src);return true}function revealBoundary(boundaryId,sectionId){var boundary=document.getElementById(boundaryId),section=document.getElementById(sectionId);if(!boundary||!section||!boundary.parentNode)return false;var start=boundary.previousSibling;if(!start||start.nodeType!==8)return false;var parent=boundary.parentNode;var node=boundary;var depth=0;while(node){if(node.nodeType===8){var data=node.data;if(data==="/$"||data==="/&"){if(depth===0)break;depth--;}else if(data==="$"||data==="$?"||data==="$~"||data==="$!"||data==="&"){depth++;}}var next=node.nextSibling;parent.removeChild(node);node=next;}while(section.firstChild)parent.insertBefore(section.firstChild,node);if(section.parentNode)section.parentNode.removeChild(section);start.data="$";return true}var tries=0;var timer=setInterval(function(){var changed=false;document.querySelectorAll('div[id^="S:"]').forEach(function(section){var suffix=section.id.slice(2);changed=moveFragment('S:'+suffix,'P:'+suffix)||changed;});document.querySelectorAll('template[id^="B:"]').forEach(function(boundary){var suffix=boundary.id.slice(2);changed=revealBoundary('B:'+suffix,'S:'+suffix)||changed;});tries++;if(tries>80||(!document.querySelector('template[id^="B:"]')&&!document.querySelector('template[id^="P:"]'))){clearInterval(timer);}},50);})();</script>`;
            const footer = secureDocumentHTML(
              createDocumentFooter({
                suspenseRevealFallback,
                deferredHydrationScript: createDeferredHydrationScript(deferredProps.records),
              }),
            );
            htmlParts.push(footer);
            res.write(footer);
            res.end();
            callback();
            if (clearMiddlewareData) {
              clearMiddlewareData();
            }
            // A shell capture without a renderer-owned boundary detector has
            // nothing safe to store: falling back to the full streamed
            // response would cache one visitor's rendered data as the shared
            // shell. Cache only what was actually split out as static.
            if (
              !didError &&
              options.onComplete &&
              (!options.captureStaticShell || staticShellParts)
            ) {
              if (staticShellParts) {
                staticShellParts.push(
                  createDocumentFooter({
                    suspenseRevealFallback,
                    refreshPPR: staticShellClosed,
                  }),
                );
              }

              const cachedHtml = staticShellParts ? staticShellParts.join("") : htmlParts.join("");
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
          };

          // Queue the shell immediately, then start piping the Suspense stream.
          // Waiting for the write callback can delay the fallback until the whole
          // response is ready under some dev-server wrappers.
          res.write(securedShell);
          if (typeof (res as any).flush === "function") {
            (res as any).flush();
          }
          pipe(writableStream);
        },
        onShellError(error) {
          didError = true;
          if (!isWebResponse(error) && !isFarmRedirectError(error) && !isFarmNotFoundError(error)) {
            logger.error(`SSR shell error: ${error}`);
            emitFarmEvent({
              type: "render.error",
              route: observabilityRoute,
              error,
            });
          }

          if (clearMiddlewareData) {
            clearMiddlewareData();
          }

          reject(error);
        },
        onError(error) {
          didError = true;
          if (isFarmRedirectError(error) || isFarmNotFoundError(error)) {
            if (!shellFlushed) pendingNavigationError ??= error;
            else lateNavigationError ??= error;
            return;
          }
          if (!isWebResponse(error)) {
            logger.error(`SSR streaming error: ${error}`);
            emitFarmEvent({
              type: "render.error",
              route: observabilityRoute,
              error,
            });
          }
        },
      });
    });
  }

  /**
   * Answer a redirect() or notFound() thrown by middleware, before anything was
   * sent. Returns false for any other error.
   */
  async respondToNavigationError(
    req: FarmRequest,
    res: FarmResponse,
    error: unknown,
  ): Promise<boolean> {
    if (isFarmRedirectError(error)) {
      const redirect = getFarmRedirectError(error)!;
      res.statusCode = redirect.status;
      // Middleware runs before locale routing; like ctx.redirect(), the target
      // goes out as written (the production runner does the same).
      res.setHeader("Location", redirect.url);
      res.end();
      return true;
    }
    if (isFarmNotFoundError(error)) {
      await this.render404(req, res);
      return true;
    }
    return false;
  }

  private localizeRedirectUrl(url: string): string {
    const snapshot = getFarmI18nClientSnapshot();
    return snapshot && url.startsWith("/") && !url.startsWith("//")
      ? localizeFarmHref(url, snapshot.locale, snapshot)
      : url;
  }

  /** The app's not-found component, or null when it relies on the built-in page. */
  private async loadNotFoundComponent(): Promise<unknown> {
    const notFoundPath = resolveFarmNotFoundComponentPath(
      this.config,
      getFarmAppDirectories(this.config),
    );
    if (!notFoundPath) return null;
    const notFoundModule = await this.routeManager.loadRouteModule(notFoundPath);
    return notFoundModule.default ?? null;
  }

  private defaultNotFoundContent(): string {
    const homeHref = escapeHtmlAttribute(applyFarmBasePath("/", this.config.basePath));
    return `<style>${DEFAULT_NOT_FOUND_STYLES}</style><main class="farm-default-not-found" aria-labelledby="farm-default-not-found-title" aria-describedby="farm-default-not-found-description"><div class="farm-default-not-found__content"><h1 id="farm-default-not-found-title" class="farm-default-not-found__code">404</h1><p id="farm-default-not-found-description" class="farm-default-not-found__description">Not found</p><a class="farm-default-not-found__home" href="${homeHref}">GO HOME</a></div></main>`;
  }

  /**
   * A redirect() or notFound() thrown after the shell was sent can no longer
   * change the status. Like Next.js, finish the document so it recovers:
   * redirect in the browser, or swap the page for the not-found UI and mark
   * the document noindex.
   */
  private async createLateNavigationRecoveryHTML(
    req: FarmRequest,
    error: unknown,
  ): Promise<string> {
    if (isFarmRedirectError(error)) {
      return createLateRedirectRecovery(this.localizeRedirectUrl(getFarmRedirectError(error)!.url));
    }
    const pathname = resolveFarmRequestURL(req, {
      trustProxy: this.config.server?.trustProxy,
    }).pathname;
    // The layouts are already in the streamed shell, so only the page area is
    // replaced. A not-found page that needs context from its layout cannot
    // render on its own; recover with the built-in page instead.
    let content = this.defaultNotFoundContent();
    const NotFoundComponent = await this.loadNotFoundComponent();
    if (NotFoundComponent) {
      try {
        content = await this.rendererRuntime.renderToString(
          await this.wrapWithIntegrationProviders(
            this.rendererRuntime.createElement(NotFoundComponent, { pathname }),
          ),
        );
      } catch (error) {
        logger.warn(`not-found page could not render outside its layout, using Farm's: ${error}`);
      }
    }
    return createLateNotFoundRecovery(content);
  }

  private async render404(req: FarmRequest, res: FarmResponse): Promise<void> {
    res.statusCode = 404;

    const pathname = resolveFarmRequestURL(req, {
      trustProxy: this.config.server?.trustProxy,
    }).pathname;

    // Agents that navigate in Markdown (a `.md` URL or `Accept: text/markdown`)
    // get a Markdown error body instead of the HTML not-found shell.
    const acceptHeader = req.headers.accept;
    const accept = Array.isArray(acceptHeader) ? acceptHeader.join(",") : acceptHeader;
    if (farmRequestWantsMarkdown(pathname, accept)) {
      res.setHeader("Content-Type", FARM_MARKDOWN_CONTENT_TYPE);
      res.setHeader("X-Farm-Markdown-Error", "404");
      res.setHeader("Cache-Control", "no-store");
      res.end(createFarmMarkdownErrorBody(404, pathname, this.config.basePath || "/"));
      return;
    }

    try {
      // Look for custom not-found page
      const appDir = path.join(this.config.root, this.config.srcDir, "app");
      const notFoundExtensions = getFarmRendererComponentExtensions(this.config.renderer);
      const notFoundPath = resolveFarmNotFoundComponentPath(
        this.config,
        getFarmAppDirectories(this.config),
      );

      if (notFoundPath) {
        const NotFoundComponent = await this.loadNotFoundComponent();

        if (NotFoundComponent) {
          // Look for root layout
          let LayoutComponent: any = null;
          for (const ext of notFoundExtensions) {
            const layoutPath = path.join(appDir, `layout${ext}`);
            if (fs.existsSync(layoutPath)) {
              const layoutModule = await this.routeManager.loadLayoutModule(layoutPath);
              LayoutComponent = layoutModule.default;
              break;
            }
          }

          // Render the 404 page
          let element: any = this.rendererRuntime.createElement(NotFoundComponent, { pathname });

          // Wrap with layout if available
          if (LayoutComponent) {
            element = this.rendererRuntime.createElement(LayoutComponent, {
              children: element,
            });
          }

          element = await this.wrapWithIntegrationProviders(element);

          // Render to string
          const content = await this.rendererRuntime.renderToString(element);

          const html = this.createFullHTML(content, false, pathname, undefined, { req });
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.write(this.secureDocumentHTML(req, html));
          res.end();
          return;
        }
      }
    } catch (error) {
      throw new Error(`Failed to render custom 404 page: ${error}`);
    }

    // Render the shared adaptive fallback when the app does not provide its own page.
    const defaultContent = this.defaultNotFoundContent();

    const html = this.createFullHTML(defaultContent, false, pathname, undefined, { req });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.write(this.secureDocumentHTML(req, html));
    res.end();
  }

  private async renderError(
    req: FarmRequest,
    res: FarmResponse,
    error: unknown,
    statusCode = 500,
  ): Promise<void> {
    if (res.headersSent || (res as any).writableEnded) {
      if (!(res as any).writableEnded) {
        res.end();
      }
      return;
    }

    res.statusCode = statusCode;
    const isDev = process.env.NODE_ENV === "development";
    const requestUrl = resolveFarmRequestURL(req, {
      trustProxy: this.config.server?.trustProxy,
    });
    const diagnostics = isDev
      ? createDefaultErrorDiagnostics(error, this.config.root || process.cwd())
      : undefined;
    const statusText = getDefaultErrorStatusText(statusCode);
    const content = createDefaultErrorMarkup({
      statusCode,
      statusText,
      requestPath: requestUrl.pathname,
      method: req.method || "GET",
      message: diagnostics?.message,
      errorName: diagnostics?.name,
      stack: diagnostics?.stack,
      sourceFrame: diagnostics?.sourceFrame,
      development: isDev,
      farmVersion: FARM_VERSION,
      nodeVersion: process.version,
      mode: isDev ? "development" : "production",
    });

    const html = this.createFullHTML(
      content,
      false,
      requestUrl.pathname,
      `<link rel="icon" href="data:,">\n  <title>${statusCode} - ${statusText}</title>`,
      { req },
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.write(this.secureDocumentHTML(req, html));
    res.end();
  }

  /**
   * Where i18n hreflang alternates resolve to absolute URLs: the route's
   * metadataBase, otherwise the request origin under the same trustProxy rule
   * as every other request URL.
   */
  private getI18nAlternateOptions(
    req: FarmRequest | undefined,
    metadata: unknown,
  ): FarmLocaleAlternateLinkOptions {
    return {
      metadataBase: (metadata as { metadataBase?: unknown } | undefined)?.metadataBase,
      origin: req
        ? resolveFarmRequestURL(req, { trustProxy: this.config.server?.trustProxy }).origin
        : undefined,
    };
  }

  private createFullHTML(
    content: string,
    isClientComponent = false,
    requestPath = "/",
    metadataHead?: string,
    alternates: { req?: FarmRequest; metadata?: unknown } = {},
  ): string {
    const i18nSnapshot = getFarmI18nClientSnapshot();
    const clientScript = isClientComponent
      ? `  <script type="module" src="/@farm/client.js"></script>`
      : "";
    const integrationManifestScript = `<script>
window.__FARM_DEPLOYMENT_ID__ = ${serializeInlineValue(this.getDeploymentId())};
window.__FARM_INTEGRATION_API_MANIFEST__ = ${JSON.stringify(getRegisteredIntegrationAPIManifest())};
${i18nSnapshot ? `window.__FARM_I18N__ = ${serializeInlineValue(i18nSnapshot)};` : ""}
</script>`;
    const alternateLinks = i18nSnapshot
      ? renderI18nAlternateLinks(
          requestPath,
          i18nSnapshot,
          this.getI18nAlternateOptions(alternates.req, alternates.metadata),
        )
      : "";
    const fontHead = renderFarmFontDevHead(this.config.root || process.cwd());
    const themeDocument = createFarmThemeDocumentParts(
      this.config.theme,
      this.config.basePath,
      getFarmTheme(),
    );
    const rendererHydrationScript = this.rendererRuntime.generateHydrationScript?.() || "";

    // A layout that returns its own full `<html>` document must not be nested
    // inside this shell (that yields invalid nested `<html>`/`<head>`/`<body>`).
    // Compose Farm's managed assets into the layout's document instead, matching
    // the production build's `hasFullDocument` path.
    const fullDocument = extractFarmFullDocument(content);
    if (fullDocument) {
      warnFarmFullDocumentLayout();
      return composeFarmFullDocument(
        metadataHead ? removeFarmDocumentTitles(fullDocument) : fullDocument,
        {
          htmlAttributes: `${
            i18nSnapshot
              ? ` lang="${escapeHtmlAttribute(i18nSnapshot.locale)}" dir="${escapeHtmlAttribute(i18nSnapshot.direction)}"`
              : ""
          }${themeDocument.attributes}`,
          replaceHtmlAttributes: [
            ...(i18nSnapshot ? ["lang", "dir"] : []),
            ...(themeDocument.attributes ? ["data-theme"] : []),
          ],
          headAssets: [
            themeDocument.head,
            `<meta name="farm-deployment-id" content="${escapeHtmlAttribute(this.getDeploymentId())}">`,
            metadataHead,
            alternateLinks,
            fontHead,
            `<link rel="stylesheet" href="/src/app/globals.css" />`,
            ...this.collectDevStyleLinks(),
            `<script type="module" src="/@vite/client"></script>`,
            rendererHydrationScript,
            integrationManifestScript,
          ]
            .filter(Boolean)
            .join("\n  "),
          bodyFooter: clientScript.trim(),
        },
      );
    }

    return `<!DOCTYPE html>
<html lang="${escapeHtmlAttribute(i18nSnapshot?.locale || "en")}"${
      i18nSnapshot ? ` dir="${i18nSnapshot.direction}"` : ""
    }${themeDocument.attributes}>
<head>
  ${themeDocument.head}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="farm-deployment-id" content="${escapeHtmlAttribute(this.getDeploymentId())}">
  ${metadataHead ?? '<link rel="icon" href="data:,">\n  <title>Farm.js App</title>'}${alternateLinks}
  ${fontHead}
  <link rel="stylesheet" href="/src/app/globals.css" />${this.collectDevStyleLinks()
    .map((l) => `\n  ${l}`)
    .join("")}
  <script type="module" src="/@vite/client"></script>
  ${rendererHydrationScript}
  ${integrationManifestScript}
</head>
<body class="">
  <div id="root">${content}</div>
${clientScript}
</body>
</html>`;
  }

  private getCspNonce(req: FarmRequest): string | undefined {
    const value = (req as any).__FARM_CSP_NONCE__;
    return typeof value === "string" ? value : undefined;
  }

  private secureDocumentHTML(req: FarmRequest, html: string): string {
    const nonce = this.getCspNonce(req);
    return nonce ? addFarmCspNonceToScriptTags(html, nonce) : html;
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
