/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Link } from "../client/link";

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
    it("internal click prevents default and calls router.navigate", () => {
      const el = render(createElement(Link, { href: "/dashboard" })) as HTMLAnchorElement;
      const e = new MouseEvent("click", { bubbles: true, button: 0, cancelable: true });
      act(() => {
        el.dispatchEvent(e);
      });
      expect(e.defaultPrevented).toBe(true);
      expect(navigate).toHaveBeenCalledWith("/dashboard", { replace: false, scroll: true });
    });

    it("replace and scroll false passed to navigate", () => {
      const el = render(
        createElement(Link, { href: "/settings", replace: true, scroll: false }),
      ) as HTMLAnchorElement;
      act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
      });
      expect(navigate).toHaveBeenCalledWith("/settings", { replace: true, scroll: false });
    });

    it("external href has correct attribute and is not intercepted", () => {
      const el = render(createElement(Link, { href: "https://example.com" })) as HTMLAnchorElement;
      expect(el.getAttribute("href")).toBe("https://example.com");
      const clickEvent = new MouseEvent("click", { bubbles: true, button: 0, cancelable: true });
      act(() => {
        el.dispatchEvent(clickEvent);
      });
      expect(navigate).not.toHaveBeenCalled();
      expect(clickEvent.defaultPrevented).toBe(false);
    });
  });

  describe("typed href", () => {
    it("renders with href and supports generic route type", () => {
      type AppRoutes = "/" | "/about" | "/blog/[slug]";
      const el = render(createElement(Link<AppRoutes>, { href: "/about" }));
      expect(el?.getAttribute("href")).toBe("/about");
    });
  });
});
