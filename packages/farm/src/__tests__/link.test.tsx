/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { expectTypeOf } from "vitest";
import { createRoot } from "react-dom/client";
import { Link, type ExternalHref, type LinkProps, type RouteHref } from "../client/link";
import { setFarmTrailingSlashPreference } from "../trailing-slash";
import { setFarmBasePath } from "../base-path";
import { FarmProvider } from "../provider";

const prefetch = vi.fn().mockResolvedValue(undefined);
const navigate = vi.fn();
const observeForPrefetch = vi.fn();
const unobserveForPrefetch = vi.fn();

function createMockRouter() {
  return {
    prefetch,
    navigate,
    observeForPrefetch,
    unobserveForPrefetch,
  };
}

describe("Link", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any).window = globalThis;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (window as any).__FARM_SPA_ROUTER__ = createMockRouter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container?.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    delete (window as any).__FARM_SPA_ROUTER__;
    delete (window as any).__FARM_MANIFEST__;
    setFarmTrailingSlashPreference(false);
    setFarmBasePath("/");
  });

  function render(ui: React.ReactElement) {
    root = createRoot(container);
    act(() => {
      root.render(ui);
    });
    return container.querySelector("a");
  }

  describe("prefetch behavior", () => {
    it("prefetch=none does not observe or prefetch on mount", () => {
      const el = render(createElement(Link, { href: "/about", prefetch: "none" }));
      expect(el).toBeTruthy();
      expect(observeForPrefetch).not.toHaveBeenCalled();
      expect(prefetch).not.toHaveBeenCalled();
    });

    it("prefetch=render calls prefetch on mount", () => {
      render(createElement(Link, { href: "/about", prefetch: "render" }));
      expect(prefetch).toHaveBeenCalledWith("/about");
      expect(observeForPrefetch).not.toHaveBeenCalled();
    });

    it("prefetches the resolved href for route patterns with params", () => {
      render(
        createElement(Link<"/products/[id]">, {
          href: "/products/[id]",
          params: { id: "farm shoes" },
          query: { tab: "reviews" },
          hash: "details",
          prefetch: "render",
        }),
      );

      expect(prefetch).toHaveBeenCalledWith("/products/farm%20shoes?tab=reviews#details");
    });

    it("prefetch=viewport calls observeForPrefetch", () => {
      const el = render(createElement(Link, { href: "/about", prefetch: "viewport" }));
      expect(observeForPrefetch).toHaveBeenCalledWith(el);
      expect(prefetch).not.toHaveBeenCalled();
    });

    it("prefetch=intent schedules prefetch on mouseEnter after delay", async () => {
      vi.useFakeTimers();
      const el = render(
        createElement(Link, { href: "/about", prefetch: "intent", prefetchDelay: 50 }),
      ) as HTMLAnchorElement;
      expect(prefetch).not.toHaveBeenCalled();
      act(() => {
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      });
      expect(prefetch).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(prefetch).toHaveBeenCalledWith("/about");
      vi.useRealTimers();
    });

    it("prefetch=intent cancels prefetch on mouseLeave before delay", () => {
      vi.useFakeTimers();
      const el = render(
        createElement(Link, { href: "/about", prefetch: "intent", prefetchDelay: 100 }),
      ) as HTMLAnchorElement;
      act(() => {
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        vi.advanceTimersByTime(50);
        el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
        vi.advanceTimersByTime(100);
      });
      expect(prefetch).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("prefetch=intent triggers on touchstart", () => {
      vi.useFakeTimers();
      const el = render(
        createElement(Link, { href: "/blog", prefetch: "intent", prefetchDelay: 10 }),
      ) as HTMLAnchorElement;
      act(() => {
        el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
        vi.advanceTimersByTime(10);
      });
      expect(prefetch).toHaveBeenCalledWith("/blog");
      vi.useRealTimers();
    });

    it("prefetch=intent triggers on focus for keyboard navigation", () => {
      vi.useFakeTimers();
      const el = render(
        createElement(Link, { href: "/docs", prefetch: "intent", prefetchDelay: 10 }),
      ) as HTMLAnchorElement;
      act(() => {
        el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        vi.advanceTimersByTime(10);
      });
      expect(prefetch).toHaveBeenCalledWith("/docs");
      vi.useRealTimers();
    });

    it("prefetch=intent cancels pending prefetch on blur", () => {
      vi.useFakeTimers();
      const el = render(
        createElement(Link, { href: "/docs", prefetch: "intent", prefetchDelay: 100 }),
      ) as HTMLAnchorElement;
      act(() => {
        el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        vi.advanceTimersByTime(50);
        el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        vi.advanceTimersByTime(100);
      });
      expect(prefetch).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("prefetch=true enables both intent and viewport", () => {
      const el = render(createElement(Link, { href: "/", prefetch: true }));
      expect(observeForPrefetch).toHaveBeenCalledWith(el);
      expect(prefetch).not.toHaveBeenCalled();
    });

    it("does not prefetch external href", () => {
      render(createElement(Link, { href: "https://example.com", prefetch: "render" }));
      expect(prefetch).not.toHaveBeenCalled();
    });
  });

  describe("navigation", () => {
    it("prefixes internal links with the configured app base path", () => {
      setFarmBasePath("/console");
      const el = render(createElement(Link, { href: "/dashboard", prefetch: "render" }));

      expect(el?.getAttribute("href")).toBe("/console/dashboard");
      expect(prefetch).toHaveBeenCalledWith("/console/dashboard");
    });

    it("normalizes and uses an explicit FarmProvider base path", () => {
      const el = render(
        createElement(
          FarmProvider,
          { config: { basePath: "workspace/" } as any },
          createElement(Link, { href: "/settings" }),
        ),
      );

      expect(el?.getAttribute("href")).toBe("/workspace/settings");
    });

    it("does not prefix an already-prefixed FarmProvider link twice", () => {
      const el = render(
        createElement(
          FarmProvider,
          { config: { basePath: "/workspace" } as any },
          createElement(Link, { href: "/workspace/settings" }),
        ),
      );

      expect(el?.getAttribute("href")).toBe("/workspace/settings");
    });

    it("treats a root FarmProvider base path as unprefixed", () => {
      const el = render(
        createElement(
          FarmProvider,
          { config: { basePath: "/" } as any },
          createElement(Link, { href: "/about" }),
        ),
      );

      expect(el?.getAttribute("href")).toBe("/about");
    });

    it("recognizes an already-prefixed base path before a query or hash", () => {
      setFarmBasePath("/console");
      const queryLink = render(createElement(Link, { href: "/console?tab=activity" }));
      expect(queryLink?.getAttribute("href")).toBe("/console?tab=activity");

      act(() => root.unmount());
      const hashLink = render(createElement(Link, { href: "/console#activity" }));
      expect(hashLink?.getAttribute("href")).toBe("/console#activity");
    });

    it("inherits the app trailing-slash preference", () => {
      setFarmTrailingSlashPreference(true);
      const el = render(
        createElement(Link, { href: "/about?tab=team", hash: "people" }),
      ) as HTMLAnchorElement;

      expect(el.getAttribute("href")).toBe("/about/?tab=team#people");
    });

    it("lets the link override the app trailing-slash preference", () => {
      setFarmTrailingSlashPreference(true);
      const el = render(
        createElement(Link, { href: "/about", trailingSlash: false }),
      ) as HTMLAnchorElement;

      expect(el.getAttribute("href")).toBe("/about");
    });

    it("internal click prevents default and calls router.navigate", () => {
      const el = render(createElement(Link, { href: "/dashboard" })) as HTMLAnchorElement;
      const e = new MouseEvent("click", { bubbles: true, button: 0, cancelable: true });
      act(() => {
        el.dispatchEvent(e);
      });
      expect(e.defaultPrevented).toBe(true);
      expect(navigate).toHaveBeenCalledWith("/dashboard", {
        replace: false,
        scroll: true,
        viewTransition: false,
      });
    });

    it("leaves internal download links to the browser", () => {
      const el = render(
        createElement(Link, { href: "/reports/latest.csv", download: "report.csv" }),
      ) as HTMLAnchorElement;
      const event = new MouseEvent("click", {
        bubbles: true,
        button: 0,
        cancelable: true,
      });
      let farmPreventedDefault: boolean | undefined;
      container.addEventListener(
        "click",
        (nativeEvent) => {
          farmPreventedDefault = nativeEvent.defaultPrevented;
          nativeEvent.preventDefault();
        },
        { once: true },
      );

      act(() => {
        el.dispatchEvent(event);
      });

      expect(el.getAttribute("download")).toBe("report.csv");
      expect(farmPreventedDefault).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    });

    it("replace and scroll false passed to navigate", () => {
      const el = render(
        createElement(Link, { href: "/settings", replace: true, scroll: false }),
      ) as HTMLAnchorElement;
      act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
      });
      expect(navigate).toHaveBeenCalledWith("/settings", {
        replace: true,
        scroll: false,
        viewTransition: false,
      });
    });

    it("passes viewTransition to navigate", () => {
      const el = render(
        createElement(Link, { href: "/gallery", viewTransition: true }),
      ) as HTMLAnchorElement;
      act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
      });
      expect(navigate).toHaveBeenCalledWith("/gallery", {
        replace: false,
        scroll: true,
        viewTransition: true,
      });
      expect(el.getAttribute("data-view-transition")).toBe("true");
      expect(el.hasAttribute("data-farm-link")).toBe(true);
    });

    it("renders and navigates with resolved route params, query, and hash", () => {
      const el = render(
        createElement(Link<"/products/[id]">, {
          href: "/products/[id]?from=list",
          params: { id: 123 },
          query: { tab: "info" },
          hash: "reviews",
        }),
      ) as HTMLAnchorElement;

      expect(el.getAttribute("href")).toBe("/products/123?from=list&tab=info#reviews");

      act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
      });

      expect(navigate).toHaveBeenCalledWith("/products/123?from=list&tab=info#reviews", {
        replace: false,
        scroll: true,
        viewTransition: false,
      });
    });

    it("preserves target route search params from the current URL", () => {
      window.history.replaceState(null, "", "/products?locale=am&tab=info");
      (window as any).__FARM_MANIFEST__ = {
        routes: {
          "/products/[id]": {
            pattern: "/products/[id]",
            search: { preserve: ["locale"] },
            segments: [
              { segment: "products", isDynamic: false },
              { segment: "id", isDynamic: true },
            ],
          },
        },
      };

      const el = render(
        createElement(Link<"/products/[id]">, {
          href: "/products/[id]",
          params: { id: 123 },
          query: { tab: "reviews" },
        }),
      ) as HTMLAnchorElement;

      expect(el.getAttribute("href")).toBe("/products/123?tab=reviews&locale=am");
    });

    it("does not overwrite search params already provided by the link", () => {
      window.history.replaceState(null, "", "/products?locale=am");
      (window as any).__FARM_MANIFEST__ = {
        routes: {
          "/products/[id]": {
            pattern: "/products/[id]",
            search: { preserve: ["locale"] },
            segments: [
              { segment: "products", isDynamic: false },
              { segment: "id", isDynamic: true },
            ],
          },
        },
      };

      const el = render(
        createElement(Link<"/products/[id]">, {
          href: "/products/[id]?locale=en",
          params: { id: 123 },
        }),
      ) as HTMLAnchorElement;

      expect(el.getAttribute("href")).toBe("/products/123?locale=en");
    });

    it("external href has correct attribute and is not intercepted", () => {
      const onClick = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
      });
      const el = render(
        createElement(Link, { href: "https://example.com", onClick }),
      ) as HTMLAnchorElement;
      expect(el.getAttribute("href")).toBe("https://example.com");
      const clickEvent = new MouseEvent("click", { bubbles: true, button: 0, cancelable: true });
      act(() => {
        el.dispatchEvent(clickEvent);
      });
      expect(onClick).toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it("preserves mailto hrefs without prefetching them", () => {
      const el = render(
        createElement(Link, {
          href: "mailto:team@example.com?subject=Farm",
          prefetch: "render",
        }),
      ) as HTMLAnchorElement;

      expect(el.getAttribute("href")).toBe("mailto:team@example.com?subject=Farm");
      expect(prefetch).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it("leaves native URI schemes to the browser", () => {
      const el = render(
        createElement(Link, { href: "tel:+15551234567", prefetch: "render" }),
      ) as HTMLAnchorElement;
      const event = new MouseEvent("click", { bubbles: true, button: 0, cancelable: true });
      let farmPreventedDefault: boolean | undefined;
      container.addEventListener(
        "click",
        (nativeEvent) => {
          farmPreventedDefault = nativeEvent.defaultPrevented;
          nativeEvent.preventDefault();
        },
        { once: true },
      );

      act(() => {
        el.dispatchEvent(event);
      });

      expect(el.getAttribute("href")).toBe("tel:+15551234567");
      expect(farmPreventedDefault).toBe(false);
      expect(prefetch).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it("leaves custom URI schemes to the browser", () => {
      const el = render(
        createElement(Link, { href: "customapp:open/settings", prefetch: "render" }),
      ) as HTMLAnchorElement;
      const event = new MouseEvent("click", { bubbles: true, button: 0, cancelable: true });
      let farmPreventedDefault: boolean | undefined;
      container.addEventListener(
        "click",
        (nativeEvent) => {
          farmPreventedDefault = nativeEvent.defaultPrevented;
          nativeEvent.preventDefault();
        },
        { once: true },
      );

      act(() => {
        el.dispatchEvent(event);
      });

      expect(el.getAttribute("href")).toBe("customapp:open/settings");
      expect(farmPreventedDefault).toBe(false);
      expect(prefetch).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("typed href", () => {
    it("renders with href and supports generic route type", () => {
      type AppRoutes = "/" | "/about" | "/blog/[slug]";
      const el = render(createElement(Link<AppRoutes>, { href: "/about" }));
      expect(el?.getAttribute("href")).toBe("/about");
    });

    it("accepts route patterns with inferred params", () => {
      type AppRoutes = "/" | "/products/[id]" | "/docs/[[...slug]]";

      expectTypeOf<LinkProps<"/products/[id]">["params"]>().toEqualTypeOf<
        { id: string | number | boolean | readonly (string | number | boolean)[] } | undefined
      >();

      expectTypeOf<LinkProps<"/docs/[[...slug]]">["params"]>().toEqualTypeOf<
        | {
            slug?: string | number | boolean | readonly (string | number | boolean)[] | null;
          }
        | undefined
      >();

      render(
        createElement(Link<AppRoutes>, {
          href: "/products/[id]",
          params: { id: "sku-123" },
        }),
      );
    });

    it("accepts route hrefs with query strings and hashes", () => {
      type AppRoutes = "/" | "/docs/query" | `/users/${string}`;

      expectTypeOf<LinkProps<AppRoutes>["href"]>().toEqualTypeOf<
        | "/"
        | `/?${string}`
        | `/#${string}`
        | `/?${string}#${string}`
        | "/docs/query"
        | `/docs/query?${string}`
        | `/docs/query#${string}`
        | `/docs/query?${string}#${string}`
        | `/users/${string}`
        | `/users/${string}?${string}`
        | `/users/${string}#${string}`
        | `/users/${string}?${string}#${string}`
        | `//${string}`
        | ExternalHref
      >();

      expectTypeOf<"/search?q=a:b">().not.toMatchTypeOf<ExternalHref>();
      expectTypeOf<"/users/:id">().not.toMatchTypeOf<ExternalHref>();
      expectTypeOf<"/about#sec:1">().not.toMatchTypeOf<ExternalHref>();
      expectTypeOf<"tel:+15551234567">().toMatchTypeOf<ExternalHref>();
      expectTypeOf<"vscode://file/app.ts">().toMatchTypeOf<ExternalHref>();
      expectTypeOf<"customapp:open/settings">().toMatchTypeOf<
        ExternalHref<"customapp:open/settings">
      >();
      expectTypeOf<"1custom:value">().not.toMatchTypeOf<ExternalHref<"1custom:value">>();
      expectTypeOf<"custom app:value">().not.toMatchTypeOf<ExternalHref<"custom app:value">>();
      expectTypeOf<"not a scheme:value">().not.toMatchTypeOf<ExternalHref>();

      const customSchemeProps = {
        href: "customapp:open/settings",
      } satisfies LinkProps<"/about", "customapp:open/settings">;
      expect(customSchemeProps.href).toBe("customapp:open/settings");
    });

    it("accepts a union variable of routes whose params are already resolved", () => {
      type AppRoutes = "/" | "/about" | `/users/${string}`;
      const href: RouteHref<AppRoutes> = Math.random() > 0.5 ? "/about" : "/users/42";

      const el = render(createElement(Link<AppRoutes>, { href }));
      expect(el?.getAttribute("href")).toBe(href);
    });
  });
});
