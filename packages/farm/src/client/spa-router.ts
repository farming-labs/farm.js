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
}

interface CacheEntry {
  data: PageData;
  timestamp: number;
}

// Global router instance
let routerInstance: SPARouter | null = null;

export class SPARouter {
  private cache: Map<string, CacheEntry> = new Map();
  private prefetchingUrls: Set<string> = new Set();
  private observers: Map<Element, IntersectionObserver> = new Map();
  private options: Required<RouterOptions>;
  private onNavigate?: (data: PageData) => Promise<void>;

  constructor(options: RouterOptions = {}) {
    this.options = {
      prefetchTimeout: options.prefetchTimeout ?? 100,
      cacheMaxAge: options.cacheMaxAge ?? 30000, // 30 seconds
    };

    if (typeof window !== "undefined") {
      // Listen for popstate (back/forward navigation)
      window.addEventListener("popstate", this.handlePopState.bind(this));

      // Save scroll position before unload
      window.addEventListener("beforeunload", () => {
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
    options: { replace?: boolean; scroll?: boolean } = {},
  ): Promise<void> {
    const { replace = false, scroll = true } = options;

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

    // Save current scroll position
    this.saveScrollPosition(window.location.pathname);

    try {
      // Fetch page data (from cache or server)
      const pageData = await this.fetchPageData(fullPath);

      // Update browser history
      if (replace) {
        window.history.replaceState({ path: fullPath }, "", fullPath);
      } else {
        window.history.pushState({ path: fullPath }, "", fullPath);
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
      } else {
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
  private async handlePopState(_event: PopStateEvent): Promise<void> {
    if (document.documentElement.dataset.farmDocsRuntime === "true") return;

    const path = window.location.pathname + window.location.search;

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
      this.restoreScrollPosition(window.location.pathname);
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

  /**
   * Save scroll position for a path
   */
  private saveScrollPosition(path: string): void {
    try {
      sessionStorage.setItem(
        `farm-scroll-${path}`,
        JSON.stringify({ x: window.scrollX, y: window.scrollY }),
      );
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
  options?: { replace?: boolean; scroll?: boolean },
): Promise<void> {
  return getRouter().navigate(href, options);
}

/**
 * Prefetch a URL
 */
export function prefetch(href: string): Promise<void> {
  return getRouter().prefetch(href);
}
