import { describe, expect, it, vi } from "vitest";
import {
  isRouteExcluded,
  matchRoutePattern,
  prefersReducedMotion,
  supportsViewTransitions,
} from "./policy.js";

describe("supportsViewTransitions", () => {
  it("is true only when startViewTransition is a function", () => {
    expect(supportsViewTransitions({ startViewTransition: () => {} })).toBe(true);
    expect(supportsViewTransitions({})).toBe(false);
    expect(supportsViewTransitions({ startViewTransition: "yes" })).toBe(false);
    expect(supportsViewTransitions(null)).toBe(false);
    expect(supportsViewTransitions(undefined)).toBe(false);
  });
});

describe("prefersReducedMotion", () => {
  it("reads the media query", () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes("reduce") }));
    expect(prefersReducedMotion({ matchMedia })).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it("treats a missing or throwing matchMedia as no preference", () => {
    expect(prefersReducedMotion({})).toBe(false);
    expect(prefersReducedMotion(null)).toBe(false);
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error("no media");
        },
      }),
    ).toBe(false);
  });
});

describe("matchRoutePattern", () => {
  it("matches literal paths, ignoring a trailing slash", () => {
    expect(matchRoutePattern("/checkout", "/checkout")).toBe(true);
    expect(matchRoutePattern("/checkout", "/checkout/")).toBe(true);
    expect(matchRoutePattern("/checkout", "/checkout/pay")).toBe(false);
    expect(matchRoutePattern("/", "/")).toBe(true);
    expect(matchRoutePattern("/", "/other")).toBe(false);
  });

  it("matches :param as exactly one segment", () => {
    expect(matchRoutePattern("/admin/:section", "/admin/users")).toBe(true);
    expect(matchRoutePattern("/admin/:section", "/admin")).toBe(false);
    expect(matchRoutePattern("/admin/:section", "/admin/users/42")).toBe(false);
  });

  it("matches a trailing * as the rest of the path", () => {
    expect(matchRoutePattern("/print/*", "/print")).toBe(true);
    expect(matchRoutePattern("/print/*", "/print/invoice/42")).toBe(true);
    expect(matchRoutePattern("/print/*", "/printing")).toBe(false);
    expect(matchRoutePattern("/*", "/anything/at/all")).toBe(true);
  });
});

describe("isRouteExcluded", () => {
  it("is true when any pattern matches", () => {
    const patterns = ["/checkout", "/admin/:section", "/print/*"];
    expect(isRouteExcluded(patterns, "/checkout")).toBe(true);
    expect(isRouteExcluded(patterns, "/admin/users")).toBe(true);
    expect(isRouteExcluded(patterns, "/print/invoice")).toBe(true);
    expect(isRouteExcluded(patterns, "/products")).toBe(false);
    expect(isRouteExcluded([], "/checkout")).toBe(false);
  });
});
