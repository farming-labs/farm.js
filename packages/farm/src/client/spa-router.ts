"use client";

import { readDeferredDataResponse } from "../deferred";
import {
  createFarmDeploymentMismatchError,
  createFarmDeploymentRequestHeaders,
  isFarmDeploymentMismatchResponse,
} from "../deployment";

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
  canonicalPath?: string;
  isClientComponent?: boolean;
  shouldHydrate?: boolean;
  metadata?: {
    title?: string;
    description?: string;
  };
  layoutModules?: string[];
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
const IDLE_NAVIGATION_STATE: FarmNavigationState = {
  state: "idle",
  pending: false,
  from: null,
  to: null,
  action: null,
  startedAt: null,
};

// Global router instance
let routerInstance: SPARouter | null = null;

export class SPARouter {
  private cache: Map<string, CacheEntry> = new Map();
  private prefetchingUrls: Set<string> = new Set();
  private observers: Map<Element, IntersectionObserver> = new Map();
  private blockers: Set<FarmNavigationBlocker> = new Set();
  private navigationListeners: Set<FarmNavigationListener> = new Set();
  private navigationState: FarmNavigationState = IDLE_NAVIGATION_STATE;
  private scrollElements: Map<string, HTMLElement> = new Map();
  private options: Required<Omit<RouterOptions, "deploymentId">> &
    Pick<RouterOptions, "deploymentId">;
  private onNavigate?: (data: PageData) => Promise<void>;

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
      window.addEventListener("popstate", this.handlePopState.bind(this));

      // Save scroll position before unload
      window.addEventListener("beforeunload", (event) => {
        if (this.blockers.size > 0) {
          event.preventDefault();
          event.returnValue = "";
        }
        this.saveScrollPosition(window.location.pathname);
      });
    }
  }

  /**
   * Set the navigation handler that updates React
   */
  setNavigationHandler(handler: (data: PageData) => Promise<void>) {
    this.onNavigate = handler;
  }

  /**
   * Navigate to a new URL
   */
  async navigate(href: string, options: FarmNavigateOptions = {}): Promise<void> {
    const { replace = false, scroll = true, state, viewTransition = false } = options;

    // Parse the URL
    const url = new URL(href, window.location.origin);
    const pathname = url.pathname;
    const search = url.search;
    const fullPath = pathname + search;

    if (this.options.shouldUseDocumentNavigation(pathname)) {
      if (replace) window.location.replace(url.toString());
      else window.location.assign(url.toString());
      return;
    }

    // Same page navigation - just update hash/scroll
    if (pathname === window.location.pathname && search === window.location.search) {
      if (url.hash) {
        window.location.hash = url.hash;
      }
      return;
    }

    const from = window.location.pathname + window.location.search;
    if (
      await this.shouldBlockNavigation({ from, to: fullPath, action: replace ? "replace" : "push" })
    ) {
      return;
    }

    // Save current scroll position
    if (this.options.scrollRestoration) {
      this.saveScrollPosition(window.location.pathname);
    }

    this.startNavigation({
      from,
      to: createNavigationLocation(url),
      action: replace ? "replace" : "push",
    });

    try {
      // Fetch page data (from cache or server)
      const pageData = await this.fetchPageData(fullPath);

      if (pageData.isClientComponent === false) {
        this.finishNavigation();
        window.location.assign(pageData.canonicalPath || fullPath);
        return;
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

      this.finishNavigation();
    } catch (error) {
      this.finishNavigation();
      console.error("[Farm.js] Navigation error:", error);
      // Fall back to full page navigation
      window.location.href = href;
    }
  }

  /**
   * Prefetch a URL
   */
  async prefetch(href: string): Promise<void> {
    const url = new URL(href, window.location.origin);
    const fullPath = url.pathname + url.search;

    // Skip if already prefetching or cached
    if (this.prefetchingUrls.has(fullPath)) return;
    if (this.isCached(fullPath)) return;

    this.prefetchingUrls.add(fullPath);

    try {
      await this.fetchPageData(fullPath, false);
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
    this.restoreScrollElement(window.location.pathname, key, element);
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
    const historyState = createHistoryState(historyPath, options.state);
    if (options.replace) {
      window.history.replaceState(historyState, "", historyPath);
    } else {
      window.history.pushState(historyState, "", historyPath);
    }

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

    if (this.onNavigate) {
      await this.onNavigate(options.pageData);
    }

    if (options.scroll) {
      if (options.url.hash) {
        const element = document.querySelector(options.url.hash);
        if (element) {
          element.scrollIntoView();
        }
      } else {
        window.scrollTo(0, 0);
      }
    } else if (this.options.scrollRestoration) {
      this.restoreScrollPosition(options.pathname);
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

    const transition = startViewTransition(() => callback());
    const updateDone = transition?.updateCallbackDone || transition?.ready;
    if (updateDone && typeof updateDone.then === "function") {
      await updateDone;
    }
    transition?.finished?.catch?.(() => undefined);
  }

  /**
   * Fetch page data from cache or server
   */
  private async fetchPageData(path: string, recover = true): Promise<PageData> {
    // Check cache first
    const cached = this.cache.get(path);
    if (cached && Date.now() - cached.timestamp < this.options.cacheMaxAge) {
      return cached.data;
    }

    // Fetch from server
    const response = await fetch(`/__farm/page-data?path=${encodeURIComponent(path)}`, {
      headers: createFarmDeploymentRequestHeaders(this.options.deploymentId, {
        Accept: "application/x-farm-deferred+json, application/json",
        "X-Farm-SPA": "1",
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
    this.cache.set(path, {
      data,
      timestamp: Date.now(),
    });

    return data;
  }

  /**
   * Handle browser back/forward navigation
   */
  private async handlePopState(_event: PopStateEvent): Promise<void> {
    if (document.documentElement.dataset.farmDocsRuntime === "true") return;

    const path = window.location.pathname + window.location.search;

    if (
      await this.shouldBlockNavigation({
        from: event.state?.path || path,
        to: path,
        action: "pop",
      })
    ) {
      return;
    }

    this.startNavigation({
      from: event.state?.path || path,
      to: createNavigationLocation(new URL(window.location.href)),
      action: "pop",
    });

    try {
      const pageData = await this.fetchPageData(path);

      // Update document title
      if (pageData.metadata?.title) {
        document.title = pageData.metadata.title;
      }

      // Call the navigation handler to update React
      if (this.onNavigate) {
        await this.onNavigate(pageData);
      }

      // Restore scroll position
      if (this.options.scrollRestoration) {
        this.restoreScrollPosition(window.location.pathname);
      }

      this.finishNavigation();
    } catch (error) {
      this.finishNavigation();
      console.error("[Farm.js] Popstate navigation error:", error);
      // Reload the page as fallback
      window.location.reload();
    }
  }

  /**
   * Check if URL is cached
   */
  private isCached(path: string): boolean {
    const cached = this.cache.get(path);
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
    const nextState = createHistoryState(
      new URL(url).pathname + new URL(url).search,
      state,
      window.history.state,
    );

    if (action === "replace") {
      window.history.replaceState(nextState, "", url);
    } else {
      window.history.pushState(nextState, "", url);
    }

    window.dispatchEvent(new PopStateEvent("popstate", { state: nextState }));
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
export function getRouter(): SPARouter {
  if (typeof window === "undefined") {
    // Return a no-op router for SSR
    return new SPARouter();
  }

  const installedRouter = (window as any).__FARM_SPA_ROUTER__ as SPARouter | undefined;
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

function createHistoryState(path: string, pageState: unknown, currentState?: unknown) {
  const base =
    currentState && typeof currentState === "object" ? { ...(currentState as object) } : {};
  return {
    ...base,
    path,
    [FARM_PAGE_STATE_KEY]: pageState,
  };
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
