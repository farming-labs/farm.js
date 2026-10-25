// @vitest-environment jsdom

import { Link } from "@farm.js/core/client";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();

function renderLink(props: Record<string, unknown>): HTMLAnchorElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    render(h(Link as never, { prefetch: "none", ...props }, "go"), container);
  });
  return container.querySelector("a")!;
}

function click(element: HTMLAnchorElement): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, button: 0, cancelable: true });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

describe("Farm Link on preact/compat", () => {
  beforeEach(() => {
    (window as any).__FARM_SPA_ROUTER__ = {
      navigate,
      prefetch: vi.fn().mockResolvedValue(undefined),
      observeForPrefetch: vi.fn(),
      unobserveForPrefetch: vi.fn(),
    };
    navigate.mockClear();
  });

  afterEach(() => {
    delete (window as any).__FARM_SPA_ROUTER__;
    document.body.innerHTML = "";
  });

  it.each(["javascript:alert(1)", "JavaScript:alert(document.domain)"])(
    "renders %j without a live href and refuses to follow it",
    (href) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const link = renderLink({ href });

      // Preact renders javascript: hrefs verbatim, unlike React 19.
      expect(link.hasAttribute("href")).toBe(false);
      expect(document.body.innerHTML).not.toMatch(/javascript:/i);
      const event = click(link);
      expect(event.defaultPrevented).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        "[Farm.js] Blocked navigation to a javascript: URL as a security precaution.",
      );
      error.mockRestore();
    },
  );

  it("keeps internal and external hrefs working", () => {
    const internal = renderLink({ href: "/about" });
    expect(internal.getAttribute("href")).toBe("/about");
    expect(click(internal).defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/about", {
      replace: false,
      scroll: true,
      viewTransition: false,
    });

    // jsdom cannot follow the external link, so the app handler stops it.
    const onClick = vi.fn((event: Event) => event.preventDefault());
    const external = renderLink({ href: "https://example.com/", onClick });
    expect(external.getAttribute("href")).toBe("https://example.com/");
    click(external);
    expect(onClick).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
