"use client";

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
  metadata?: {
    title?: string;
    description?: string;
  };
  layoutModules?: string[];
}

interface RouterOptions {
  prefetchTimeout?: number;
  cacheMaxAge?: number;
  scrollRestoration?: boolean;
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

export interface FarmNavigateOptions {
  replace?: boolean;
  scroll?: boolean;
  state?: unknown;
}

const FARM_PAGE_STATE_KEY = "__farmPageState";

// Global router instance
let routerInstance: SPARouter | null = null;

export class SPARouter {
  private cache: Map<string, CacheEntry> = new Map();
  private prefetchingUrls: Set<string> = new Set();
  private observers: Map<Element, IntersectionObserver> = new Map();
  private blockers: Set<FarmNavigationBlocker> = new Set();
  private scrollElements: Map<string, HTMLElement> = new Map();
  private options: Required<RouterOptions>;
  private onNavigate?: (data: PageData) => Promise<void>;

  constructor(options: RouterOptions = {}) {
    this.options = {
      prefetchTimeout: options.prefetchTimeout ?? 100,
      cacheMaxAge: options.cacheMaxAge ?? 30000, // 30 seconds
      scrollRestoration: options.scrollRestoration ?? true,
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
  async navigate(
    href: string,
    options: FarmNavigateOptions = {},
  ): Promise<void> {
    const { replace = false, scroll = true, state } = options;

    // Parse the URL
    const url = new URL(href, window.location.origin);
    const pathname = url.pathname;
    const search = url.search;
    const fullPath = pathname + search;

    // Same page navigation - just update hash/scroll
    if (pathname === window.location.pathname && search === window.location.search) {
      if (url.hash) {
        window.location.hash = url.hash;
      }
      return;
    }

    const from = window.location.pathname + window.location.search;
    if (await this.shouldBlockNavigation({ from, to: fullPath, action: replace ? "replace" : "push" })) {
      return;
    }

    // Save current scroll position
    if (this.options.scrollRestoration) {
      this.saveScrollPosition(window.location.pathname);
    }

    try {
      // Fetch page data (from cache or server)
      const pageData = await this.fetchPageData(fullPath);

      // Update browser history
      const historyState = createHistoryState(fullPath, state);
      if (replace) {
        window.history.replaceState(historyState, "", fullPath);
      } else {
        window.history.pushState(historyState, "", fullPath);
      }

      // Update document title
      if (pageData.metadata?.title) {
        document.title = pageData.metadata.title;
      }

      // Update meta description
      if (pageData.metadata?.description) {
        let metaDesc = document.querySelector('meta[name="description"]');
        if (!metaDesc) {
          metaDesc = document.createElement("meta");
          metaDesc.setAttribute("name", "description");
          document.head.appendChild(metaDesc);
        }
        metaDesc.setAttribute("content", pageData.metadata.description);
      }

      // Call the navigation handler to update React
      if (this.onNavigate) {
        await this.onNavigate(pageData);
      }

      // Handle scroll
      if (scroll) {
        if (url.hash) {
          // Scroll to hash
          const element = document.querySelector(url.hash);
          if (element) {
            element.scrollIntoView();
          }
        } else {
          // Scroll to top
          window.scrollTo(0, 0);
        }
      } else if (this.options.scrollRestoration) {
        // Restore previous scroll position if available
        this.restoreScrollPosition(pathname);
      }
    } catch (error) {
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
      await this.fetchPageData(fullPath);
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

  /**
   * Fetch page data from cache or server
   */
  private async fetchPageData(path: string): Promise<PageData> {
    // Check cache first
    const cached = this.cache.get(path);
    if (cached && Date.now() - cached.timestamp < this.options.cacheMaxAge) {
      return cached.data;
    }

    // Fetch from server
    const response = await fetch(`/__farm/page-data?path=${encodeURIComponent(path)}`, {
      headers: {
        Accept: "application/json",
        "X-Farm-SPA": "1",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page data: ${response.status}`);
    }

    const data: PageData = await response.json();

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
  private async handlePopState(event: PopStateEvent): Promise<void> {
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
    } catch (error) {
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

/**
 * Get or create the global router instance
 */
export function getRouter(): SPARouter {
  if (typeof window === "undefined") {
    // Return a no-op router for SSR
    return new SPARouter();
  }

  if (!routerInstance) {
    routerInstance = new SPARouter();
  }

  return routerInstance;
}

/**
 * Navigate to a URL using the SPA router
 */
export function navigateTo(
  href: string,
  options?: FarmNavigateOptions,
): Promise<void> {
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
  const base = currentState && typeof currentState === "object" ? { ...(currentState as object) } : {};
  return {
    ...base,
    path,
    [FARM_PAGE_STATE_KEY]: pageState,
  };
}

function getScrollElementStorageKey(path: string, key: string): string {
  return `farm-scroll-${path}:${key}`;
}
