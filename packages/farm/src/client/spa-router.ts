"use client";

import { readDeferredDataResponse } from "../deferred";
import { notifyHistoryChange } from "./history-sync";
import {
  createFarmDeploymentMismatchError,
  createFarmDeploymentRequestHeaders,
  isFarmDeploymentMismatchResponse,
} from "../deployment";
import type { FarmClientNavigationSession, FarmClientPluginManager } from "./plugin";
import { _hydrateFarmI18n, isFarmLocaleChangeHref } from "../i18n/client-runtime";
import type { FarmI18nClientSnapshot } from "../i18n/types";
import type { FarmIslandStrategy } from "../island";
import type { FarmRouteRenderPlan } from "../navigation/render-plan";

/**
 * Farm.js SPA Router
 *
 * Provides client-side navigation without full page reloads.
 * Features:
 * - Prefetch on viewport intersection
 * - Prefetch on hover
 * - Page caching
 * - History API integration
 * - Scroll restoration
 */

interface PageData {
  props: Record<string, any>;
  modulePath: string;
  loadingModulePath?: string | null;
  canonicalPath?: string;
  isClientComponent?: boolean;
  shouldHydrate?: boolean;
  islandStrategy?: FarmIslandStrategy | null;
  renderPlan?: FarmRouteRenderPlan;
  fragment?: {
    html: string;
    layoutPatterns: string[];
  };
  metadata?: {
    title?: string;
    description?: string;
  };
  layoutModules?: string[];
  routeSlots?: RouteSlotPageData[];
  interception?: {
    from?: string;
    slots: string[];
  };
  i18n?: FarmI18nClientSnapshot;
}

interface RouteSlotPageData {
  name: string;
  ownerPattern: string;
  containerId: string;
  interception: boolean;
  fallback: boolean;
  modulePath: string;
  isClientComponent: boolean;
  shouldHydrate: boolean;
  props: Record<string, any>;
}

export interface RouterOptions {
  prefetchTimeout?: number;
  cacheMaxAge?: number;
  scrollRestoration?: boolean;
  shouldUseDocumentNavigation?: (pathname: string) => boolean;
  deploymentId?: string;
}

interface CacheEntry {
  data: PageData;
  timestamp: number;
}

export interface FarmNavigationBlockerContext {
  from: string;
  to: string;
  action: "push" | "replace" | "pop";
}

export type FarmNavigationBlocker = (
  context: FarmNavigationBlockerContext,
) => boolean | void | Promise<boolean | void>;

export type FarmViewTransitionMode = boolean | "auto";

export interface FarmNavigateOptions {
  replace?: boolean;
  scroll?: boolean;
  state?: unknown;
  viewTransition?: FarmViewTransitionMode;
  /** Re-fetch the current route even when its URL has not changed. */
  refresh?: boolean;
}

export interface FarmNavigationLocation {
  href: string;
  pathname: string;
  search: string;
  hash: string;
}

export interface FarmNavigationState {
  state: "idle" | "loading";
  pending: boolean;
  from: string | null;
  to: FarmNavigationLocation | null;
  action: FarmNavigationBlockerContext["action"] | null;
  startedAt: number | null;
}

export type FarmNavigationListener = (state: FarmNavigationState) => void;

const FARM_PAGE_STATE_KEY = "__farmPageState";
const FARM_INTERCEPT_FROM_KEY = "__farmInterceptFrom";
const FARM_HISTORY_INDEX_KEY = "__farmHistoryIndex";

function readHistoryIndex(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[FARM_HISTORY_INDEX_KEY];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
const IDLE_NAVIGATION_STATE: FarmNavigationState = {
  state: "idle",
  pending: false,
  from: null,
  to: null,
  action: null,
  startedAt: null,
};

function getActiveLayoutChainHeader(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const patterns = Array.from(
    document.querySelectorAll<HTMLElement>('[data-farm-layout-boundary="true"]'),
  )
    .map((element) => element.dataset.farmLayoutPattern)
    .filter((pattern): pattern is string => Boolean(pattern));
  return patterns.length > 0 ? JSON.stringify(patterns) : undefined;
}

// Global router instance
let routerInstance: SPARouter | null = null;

export class SPARouter {
  private cache: Map<string, CacheEntry> = new Map();
  private prefetchingUrls: Set<string> = new Set();
  private observers: Map<Element, IntersectionObserver> = new Map();
  private blockers: Set<FarmNavigationBlocker> = new Set();
  private navigationListeners: Set<FarmNavigationListener> = new Set();
  private navigationState: FarmNavigationState = IDLE_NAVIGATION_STATE;
  private currentHistoryPath: string | null = null;
  private currentHistoryIndex: number | null = null;
  private suppressNextPopState = false;
  private scrollElements: Map<string, HTMLElement> = new Map();
  private options: Required<Omit<RouterOptions, "deploymentId">> &
    Pick<RouterOptions, "deploymentId">;
  private onNavigate?: (data: PageData) => Promise<void>;
  private clientPlugins?: Pick<
    FarmClientPluginManager,
    | "beginNavigation"
    | "markNavigationLoaded"
    | "resolveNavigation"
    | "scheduleNavigationRendered"
    | "failNavigation"
  >;

  private readonly onPopState = (event: PopStateEvent) => {
    void this.handlePopState(event);
  };

  private readonly onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (this.blockers.size > 0) {
      event.preventDefault();
      event.returnValue = "";
    }
    this.saveScrollPosition(window.location.pathname + window.location.search);
  };

  constructor(options: RouterOptions = {}) {
    this.options = {
      prefetchTimeout: options.prefetchTimeout ?? 100,
      cacheMaxAge: options.cacheMaxAge ?? 30000, // 30 seconds
      scrollRestoration: options.scrollRestoration ?? true,
      shouldUseDocumentNavigation: options.shouldUseDocumentNavigation ?? (() => false),
      deploymentId: options.deploymentId ?? readBrowserDeploymentId(),
    };

    if (typeof window !== "undefined") {
      // Listen for popstate (back/forward navigation)
      window.addEventListener("popstate", this.onPopState);

      // Save scroll position before unload
      window.addEventListener("beforeunload", this.onBeforeUnload);

      // Track the rendered location and its position in the history stack so
      // popstate can report a real `from` and revert blocked traversals.
      this.currentHistoryPath = window.location.pathname + window.location.search;
      const existingIndex = readHistoryIndex(window.history.state);
      if (existingIndex == null) {
        try {
          window.history.replaceState(
            {
              ...((window.history.state as object | null) ?? {}),
              [FARM_HISTORY_INDEX_KEY]: 0,
            },
            "",
            window.location.href,
          );
          this.currentHistoryIndex = 0;
        } catch {
          this.currentHistoryIndex = null;
        }
      } else {
        this.currentHistoryIndex = existingIndex;
      }
    }
  }

  /** Remove global listeners. Intended for tests and teardown. */
  destroy(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("popstate", this.onPopState);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
  }

  /**
   * Set the navigation handler that updates React
   */
  setNavigationHandler(handler: (data: PageData) => Promise<void>) {
    this.onNavigate = handler;
  }

  /**
   * Connect Farm's browser plugin lifecycle to SPA navigation.
   */
  setClientPluginManager(manager: FarmClientPluginManager) {
    this.clientPlugins = manager;
  }

  /**
   * Navigate to a new URL
   */
  async navigate(href: string, options: FarmNavigateOptions = {}): Promise<void> {
    const {
      replace = false,
      scroll = true,
      state,
      viewTransition = false,
      refresh = false,
    } = options;

    // Parse the URL
    const url = new URL(href, window.location.origin);
    const pathname = url.pathname;
    const search = url.search;
    const fullPath = pathname + search;

    if (
      isFarmLocaleChangeHref(url.toString()) ||
      this.options.shouldUseDocumentNavigation(pathname)
    ) {
      if (replace) window.location.replace(url.toString());
      else window.location.assign(url.toString());
      return;
    }

    // Same page navigation - just update hash/scroll
    if (!refresh && pathname === window.location.pathname && search === window.location.search) {
      if (url.hash) {
        window.location.hash = url.hash;
      }
      return;
    }

    const from = window.location.pathname + window.location.search;
    if (
      await this.shouldBlockNavigation({
        from,
        to: fullPath,
        action: replace ? "replace" : "push",
      })
    ) {
      return;
    }

    // Save current scroll position
    if (this.options.scrollRestoration) {
      this.saveScrollPosition(window.location.pathname + window.location.search);
    }

    this.startNavigation({
      from,
      to: createNavigationLocation(url),
      action: replace ? "replace" : "push",
    });

    let clientNavigation: FarmClientNavigationSession | undefined;
    try {
      clientNavigation = await this.clientPlugins?.beginNavigation({
        from,
        to: url,
        action: replace ? "replace" : "push",
      });

      // Fetch page data (from cache or server)
      const pageData = await this.fetchPageData(fullPath, true, from, refresh);
      if (clientNavigation) {
        await this.clientPlugins?.markNavigationLoaded(clientNavigation, pageData);
      }

      await this.runViewTransition(viewTransition, () =>
        this.commitNavigation({
          fullPath,
          pageData,
          pathname,
          replace,
          scroll,
          state,
          url,
        }),
      );

      if (clientNavigation) {
        await this.clientPlugins?.resolveNavigation(clientNavigation);
        void this.clientPlugins?.scheduleNavigationRendered(clientNavigation);
      }
      this.finishNavigation();
    } catch (error) {
      if (clientNavigation) {
        await this.clientPlugins?.failNavigation(clientNavigation, error);
      }
      this.finishNavigation();
      console.error("[Farm.js] Navigation error:", error);
      // Fall back to full page navigation
      window.location.href = href;
    }
  }

  /**
   * Re-render the active route from the server while preserving the document,
   * shared layouts, client runtime, and browser history entry.
   */
  refresh(options: Omit<FarmNavigateOptions, "replace" | "refresh"> = {}): Promise<void> {
    return this.navigate(window.location.href, {
      ...options,
      replace: true,
      refresh: true,
      scroll: options.scroll ?? false,
    });
  }

  /**
   * Prefetch a URL
   */
  async prefetch(href: string): Promise<void> {
    if (isFarmLocaleChangeHref(href)) return;
    const url = new URL(href, window.location.origin);
    const fullPath = url.pathname + url.search;
    const interceptFrom = window.location.pathname + window.location.search;

    // Skip if already prefetching or cached
    if (this.prefetchingUrls.has(fullPath)) return;
    if (this.isCached(fullPath, interceptFrom)) return;

    this.prefetchingUrls.add(fullPath);

    try {
      await this.fetchPageData(fullPath, false, interceptFrom);
    } catch (error) {
      console.warn("[Farm.js] Prefetch failed:", href, error);
    } finally {
      this.prefetchingUrls.delete(fullPath);
    }
  }

  /**
   * Observe an element for viewport intersection (prefetch when visible)
   */
  observeForPrefetch(element: HTMLAnchorElement): void {
    if (typeof IntersectionObserver === "undefined") return;

    const href = element.getAttribute("href");
    if (!href || this.isExternalUrl(href)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Delay prefetch slightly to avoid prefetching during scroll
            setTimeout(() => {
              this.prefetch(href);
            }, this.options.prefetchTimeout);

            // Stop observing after first intersection
            observer.unobserve(element);
            this.observers.delete(element);
          }
        }
      },
      { rootMargin: "200px" }, // Start prefetching when 200px from viewport
    );

    observer.observe(element);
    this.observers.set(element, observer);
  }

  /**
   * Stop observing an element
   */
  unobserveForPrefetch(element: HTMLAnchorElement): void {
    const observer = this.observers.get(element);
    if (observer) {
      observer.unobserve(element);
      this.observers.delete(element);
    }
  }

  addBlocker(blocker: FarmNavigationBlocker): () => void {
    this.blockers.add(blocker);
    return () => {
      this.blockers.delete(blocker);
    };
  }

  getNavigationState(): FarmNavigationState {
    return this.navigationState;
  }

  subscribeNavigation(listener: FarmNavigationListener): () => void {
    this.navigationListeners.add(listener);
    listener(this.navigationState);
    return () => {
      this.navigationListeners.delete(listener);
    };
  }

  registerScrollElement(key: string, element: HTMLElement): () => void {
    this.scrollElements.set(key, element);
    this.restoreScrollElement(window.location.pathname + window.location.search, key, element);
    return () => {
      if (this.scrollElements.get(key) === element) {
        this.scrollElements.delete(key);
      }
    };
  }

  pushState(state: unknown, href?: string): void {
    this.writePageState("push", state, href);
  }

  replaceState(state: unknown, href?: string): void {
    this.writePageState("replace", state, href);
  }

  private async commitNavigation(options: {
    fullPath: string;
    pageData: PageData;
    pathname: string;
    replace: boolean;
    scroll: boolean;
    state: unknown;
    url: URL;
  }): Promise<void> {
    const historyPath = options.pageData.canonicalPath || options.fullPath;
    const historyState = createHistoryState(
      historyPath,
      options.state,
      undefined,
      options.pageData.interception?.from ?? null,
    ) as Record<string, unknown>;
    const nextHistoryIndex =
      this.currentHistoryIndex == null
        ? null
        : options.replace
          ? this.currentHistoryIndex
          : this.currentHistoryIndex + 1;
    if (nextHistoryIndex != null) {
      historyState[FARM_HISTORY_INDEX_KEY] = nextHistoryIndex;
    }
    if (options.replace) {
      window.history.replaceState(historyState, "", historyPath);
    } else {
      window.history.pushState(historyState, "", historyPath);
    }
    this.currentHistoryIndex = nextHistoryIndex;
    this.currentHistoryPath =
      new URL(historyPath, window.location.origin).pathname +
      new URL(historyPath, window.location.origin).search;

    if (options.pageData.metadata?.title) {
      document.title = options.pageData.metadata.title;
    }

    if (options.pageData.metadata?.description) {
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement("meta");
        metaDesc.setAttribute("name", "description");
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute("content", options.pageData.metadata.description);
    }

    _hydrateFarmI18n(options.pageData.i18n);

    if (this.onNavigate) {
      await this.onNavigate(options.pageData);
    }

    if (options.scroll) {
      if (options.url.hash) {
        const element = getHashTargetElement(options.url.hash);
        if (element) {
          element.scrollIntoView();
        }
      } else {
        window.scrollTo(0, 0);
      }
    } else if (this.options.scrollRestoration) {
      this.restoreScrollPosition(this.currentHistoryPath ?? options.fullPath);
    }
  }

  private async runViewTransition(
    mode: FarmViewTransitionMode,
    callback: () => Promise<void>,
  ): Promise<void> {
    if (!mode || typeof document === "undefined") {
      await callback();
      return;
    }

    const startViewTransition = (document as any).startViewTransition;
    if (typeof startViewTransition !== "function") {
      await callback();
      return;
    }

    const transition = startViewTransition.call(document, () => callback());
    const updateDone = transition?.updateCallbackDone || transition?.ready;
    if (updateDone && typeof updateDone.then === "function") {
      await updateDone;
    }
    transition?.finished?.catch?.(() => undefined);
  }

  /**
   * Fetch page data from cache or server
   */
  private async fetchPageData(
    path: string,
    recover = true,
    interceptFrom?: string,
    fresh = false,
  ): Promise<PageData> {
    const cacheKey = getPageDataCacheKey(path, interceptFrom);
    // Check cache first
    const cached = fresh ? undefined : this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.options.cacheMaxAge) {
      return cached.data;
    }

    // Fetch from server. The active layout chain lets the server omit shared
    // shell HTML from the fragment without inspecting component source.
    const activeLayoutChain = getActiveLayoutChainHeader();
    const response = await fetch(`/__farm/page-data?path=${encodeURIComponent(path)}`, {
      headers: createFarmDeploymentRequestHeaders(this.options.deploymentId, {
        Accept: "application/x-farm-deferred+json, application/json",
        "X-Farm-SPA": "1",
        ...(activeLayoutChain ? { "X-Farm-Layout-Chain": activeLayoutChain } : {}),
        ...(interceptFrom ? { "X-Farm-Intercept-From": interceptFrom } : {}),
      }),
    });

    if (isFarmDeploymentMismatchResponse(response, this.options.deploymentId)) {
      const error = createFarmDeploymentMismatchError(
        response,
        this.options.deploymentId || "unknown",
      );
      dispatchDeploymentMismatch(error);
      if (recover) {
        window.location.assign(path);
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch page data: ${response.status}`);
    }

    const data = await readDeferredDataResponse<PageData>(response);

    // Cache the result
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data;
  }

  /**
   * Put the browser URL back on the rendered page after a blocked pop. When
   * both entries carry a Farm history index the traversal is reversed
   * exactly; otherwise the current path is pushed again, which restores the
   * address bar at the cost of one extra history entry.
   */
  private revertBlockedPopState(event: PopStateEvent, from: string): void {
    const eventIndex = readHistoryIndex(event.state);
    if (eventIndex != null && this.currentHistoryIndex != null) {
      const delta = eventIndex - this.currentHistoryIndex;
      if (delta !== 0) {
        this.suppressNextPopState = true;
        window.history.go(-delta);
        return;
      }
    }

    try {
      const restoredState: Record<string, unknown> = {
        path: from,
      };
      if (this.currentHistoryIndex != null && eventIndex != null) {
        restoredState[FARM_HISTORY_INDEX_KEY] = eventIndex + 1;
        this.currentHistoryIndex = eventIndex + 1;
      }
      window.history.pushState(restoredState, "", from);
    } catch {
      // Leave the URL as-is if the history API rejects the write; the
      // rendered page is still the blocked-from page.
    }
  }

  /**
   * Handle browser back/forward navigation
   */
  private async handlePopState(event: PopStateEvent): Promise<void> {
    if (document.documentElement.dataset.farmDocsRuntime === "true") return;

    if (this.suppressNextPopState) {
      // This traversal is our own revert of a blocked pop; the rendered page
      // never changed.
      this.suppressNextPopState = false;
      return;
    }

    const path = window.location.pathname + window.location.search;
    // The browser has already moved to the destination entry, so its state
    // describes `to`; the page still rendered is the tracked current path.
    const from = this.currentHistoryPath ?? path;

    if (
      await this.shouldBlockNavigation({
        from,
        to: path,
        action: "pop",
      })
    ) {
      this.revertBlockedPopState(event, from);
      return;
    }

    this.currentHistoryPath = path;
    this.currentHistoryIndex = readHistoryIndex(event.state);

    this.startNavigation({
      from,
      to: createNavigationLocation(new URL(window.location.href)),
      action: "pop",
    });

    let clientNavigation: FarmClientNavigationSession | undefined;
    try {
      clientNavigation = await this.clientPlugins?.beginNavigation({
        from: null,
        to: window.location.href,
        action: "pop",
      });
      const interceptFrom =
        typeof event.state?.[FARM_INTERCEPT_FROM_KEY] === "string"
          ? event.state[FARM_INTERCEPT_FROM_KEY]
          : undefined;
      const pageData = await this.fetchPageData(path, true, interceptFrom);
      if (clientNavigation) {
        await this.clientPlugins?.markNavigationLoaded(clientNavigation, pageData);
      }

      // Update document title
      if (pageData.metadata?.title) {
        document.title = pageData.metadata.title;
      }

      _hydrateFarmI18n(pageData.i18n);

      // Call the navigation handler to update React
      if (this.onNavigate) {
        await this.onNavigate(pageData);
      }

      // Restore scroll position
      if (this.options.scrollRestoration) {
        this.restoreScrollPosition(window.location.pathname + window.location.search);
      }

      if (clientNavigation) {
        await this.clientPlugins?.resolveNavigation(clientNavigation);
        void this.clientPlugins?.scheduleNavigationRendered(clientNavigation);
      }
      this.finishNavigation();
    } catch (error) {
      if (clientNavigation) {
        await this.clientPlugins?.failNavigation(clientNavigation, error);
      }
      this.finishNavigation();
      console.error("[Farm.js] Popstate navigation error:", error);
      // Reload the page as fallback
      window.location.reload();
    }
  }

  /**
   * Check if URL is cached
   */
  private isCached(path: string, interceptFrom?: string): boolean {
    const cached = this.cache.get(getPageDataCacheKey(path, interceptFrom));
    return cached !== undefined && Date.now() - cached.timestamp < this.options.cacheMaxAge;
  }

  /**
   * Check if URL is external
   */
  private isExternalUrl(href: string): boolean {
    return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//");
  }

  private async shouldBlockNavigation(context: FarmNavigationBlockerContext): Promise<boolean> {
    for (const blocker of this.blockers) {
      if (await blocker(context)) {
        return true;
      }
    }
    return false;
  }

  private startNavigation(options: {
    from: string;
    to: FarmNavigationLocation;
    action: FarmNavigationBlockerContext["action"];
  }): void {
    this.setNavigationState({
      state: "loading",
      pending: true,
      from: options.from,
      to: options.to,
      action: options.action,
      startedAt: Date.now(),
    });
  }

  private finishNavigation(): void {
    this.setNavigationState(IDLE_NAVIGATION_STATE);
  }

  private setNavigationState(state: FarmNavigationState): void {
    this.navigationState = state;
    for (const listener of this.navigationListeners) {
      listener(state);
    }
  }

  private writePageState(action: "push" | "replace", state: unknown, href?: string): void {
    if (typeof window === "undefined") return;

    const url = href ? new URL(href, window.location.origin).toString() : window.location.href;
    const nextPath = new URL(url).pathname + new URL(url).search;
    const nextState = createHistoryState(nextPath, state, window.history.state) as Record<
      string,
      unknown
    >;

    if (action === "replace") {
      window.history.replaceState(nextState, "", url);
    } else {
      if (this.currentHistoryIndex != null) {
        nextState[FARM_HISTORY_INDEX_KEY] = this.currentHistoryIndex + 1;
      }
      window.history.pushState(nextState, "", url);
      this.currentHistoryIndex =
        this.currentHistoryIndex == null ? null : this.currentHistoryIndex + 1;
    }
    this.currentHistoryPath = nextPath;

    notifyHistoryChange("page-state");
  }

  /**
   * Save scroll position for a path
   */
  private saveScrollPosition(path: string): void {
    try {
      sessionStorage.setItem(
        `farm-scroll-${path}`,
        JSON.stringify({ x: window.scrollX, y: window.scrollY }),
      );
      for (const [key, element] of this.scrollElements) {
        sessionStorage.setItem(
          getScrollElementStorageKey(path, key),
          JSON.stringify({ x: element.scrollLeft, y: element.scrollTop }),
        );
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Restore scroll position for a path
   */
  private restoreScrollPosition(path: string): void {
    try {
      const saved = sessionStorage.getItem(`farm-scroll-${path}`);
      if (saved) {
        const { x, y } = JSON.parse(saved);
        setTimeout(() => window.scrollTo(x, y), 0);
      }
      for (const [key, element] of this.scrollElements) {
        this.restoreScrollElement(path, key, element);
      }
    } catch {
      // Ignore storage errors
    }
  }

  private restoreScrollElement(path: string, key: string, element: HTMLElement): void {
    try {
      const saved = sessionStorage.getItem(getScrollElementStorageKey(path, key));
      if (!saved) return;
      const { x, y } = JSON.parse(saved);
      setTimeout(() => {
        element.scrollLeft = x;
        element.scrollTop = y;
      }, 0);
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Clear the page cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

function readBrowserDeploymentId(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const runtimeId = (window as Window & { __FARM_DEPLOYMENT_ID__?: unknown })
    .__FARM_DEPLOYMENT_ID__;
  if (typeof runtimeId === "string" && runtimeId) return runtimeId;

  return document.querySelector<HTMLMetaElement>('meta[name="farm-deployment-id"]')?.content;
}

function dispatchDeploymentMismatch(error: Error): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent("farm:deployment-mismatch", { detail: error }));
}

/**
 * Get or create the global router instance
 */
export function getInstalledFarmSPARouter(): SPARouter | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __FARM_SPA_ROUTER__?: SPARouter }).__FARM_SPA_ROUTER__;
}

export function getRouter(): SPARouter {
  if (typeof window === "undefined") {
    // Return a no-op router for SSR
    return new SPARouter();
  }

  const installedRouter = getInstalledFarmSPARouter();
  if (installedRouter) {
    routerInstance = installedRouter;
    return installedRouter;
  }

  if (!routerInstance) {
    routerInstance = new SPARouter();
  }

  return routerInstance;
}

/**
 * Navigate to a URL using the SPA router
 */
export function navigateTo(href: string, options?: FarmNavigateOptions): Promise<void> {
  return getRouter().navigate(href, options);
}

/**
 * Prefetch a URL
 */
export function prefetch(href: string): Promise<void> {
  return getRouter().prefetch(href);
}

export function pushState(state: unknown, href?: string): void {
  getRouter().pushState(state, href);
}

export function replaceState(state: unknown, href?: string): void {
  getRouter().replaceState(state, href);
}

export function readPageState<TState = unknown>(): TState | null {
  if (typeof window === "undefined") return null;
  const state = window.history.state;
  if (!state || typeof state !== "object") return null;
  return ((state as Record<string, unknown>)[FARM_PAGE_STATE_KEY] as TState | undefined) ?? null;
}

function createHistoryState(
  path: string,
  pageState: unknown,
  currentState?: unknown,
  interceptFrom?: string | null,
) {
  const base =
    currentState && typeof currentState === "object" ? { ...(currentState as object) } : {};
  const nextState: Record<string, unknown> = {
    ...base,
    path,
    [FARM_PAGE_STATE_KEY]: pageState,
  };
  if (interceptFrom === null) {
    delete nextState[FARM_INTERCEPT_FROM_KEY];
  } else if (interceptFrom) {
    nextState[FARM_INTERCEPT_FROM_KEY] = interceptFrom;
  }
  return nextState;
}

function getPageDataCacheKey(path: string, interceptFrom?: string): string {
  return interceptFrom ? `${path}\nintercept:${interceptFrom}` : path;
}

function createNavigationLocation(url: URL): FarmNavigationLocation {
  return {
    href: url.href,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
}

function getScrollElementStorageKey(path: string, key: string): string {
  return `farm-scroll-${path}:${key}`;
}

export function getHashTargetElement(hash: string): Element | null {
  // The fragment is not a CSS selector: ids starting with a digit or
  // containing selector characters (#2-installation, #a.b) throw in
  // querySelector. Match by id (decoded first, then raw) and fall back to
  // anchor name, mirroring native fragment navigation.
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment) {
    return null;
  }

  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // Keep the raw fragment when the percent-encoding is malformed.
  }

  return (
    document.getElementById(decoded) ||
    document.getElementById(fragment) ||
    document.getElementsByName(decoded)[0] ||
    null
  );
}
