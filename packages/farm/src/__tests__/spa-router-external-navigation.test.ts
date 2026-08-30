/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFarmExternalNavigationURL, SPARouter } from "../client/spa-router";

describe("external SPA router URLs", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("distinguishes cross-origin and non-HTTP URLs from same-origin routes", () => {
    expect(
      isFarmExternalNavigationURL(new URL("https://example.com/reports"), window.location.origin),
    ).toBe(true);
    expect(
      isFarmExternalNavigationURL(new URL("mailto:team@example.com"), window.location.origin),
    ).toBe(true);
    expect(
      isFarmExternalNavigationURL(
        new URL("/reports", window.location.origin),
        window.location.origin,
      ),
    ).toBe(false);
  });

  it("does not prefetch cross-origin URLs through the local page-data endpoint", async () => {
    const router = new SPARouter({ scrollRestoration: false });

    await router.prefetch("https://example.com/reports");

    expect(fetch).not.toHaveBeenCalled();
    router.destroy();
  });
});
