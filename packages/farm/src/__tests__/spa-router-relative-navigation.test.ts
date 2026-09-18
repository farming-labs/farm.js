/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

/** Record the `path` each navigation asks the server for. */
function stubPageDataFetch(requested: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const path = new URL(String(input), window.location.origin).searchParams.get("path")!;
      requested.push(path);
      return Promise.resolve(
        Response.json({ props: {}, metadata: { title: path }, modulePath: `${path}.tsx` }),
      );
    }),
  );
}

describe("SPA router relative navigation", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves a query-only target against the current page", async () => {
    window.history.replaceState(null, "", "/products/list");
    const requested: string[] = [];
    stubPageDataFetch(requested);

    const router = new SPARouter({ scrollRestoration: false });
    router.setNavigationHandler(async () => {});

    await router.navigate("?tab=2", { scroll: false });

    // Basing on the origin asked the server for "/?tab=2" and navigated off the page.
    expect(requested).toEqual(["/products/list?tab=2"]);
    expect(window.location.pathname).toBe("/products/list");
    expect(window.location.search).toBe("?tab=2");
    router.destroy();
  });

  it("resolves a bare segment against the current directory", async () => {
    window.history.replaceState(null, "", "/products/list");
    const requested: string[] = [];
    stubPageDataFetch(requested);

    const router = new SPARouter({ scrollRestoration: false });
    router.setNavigationHandler(async () => {});

    await router.navigate("details", { scroll: false });

    expect(requested).toEqual(["/products/details"]);
    expect(window.location.pathname).toBe("/products/details");
    router.destroy();
  });

  it("keeps absolute targets working", async () => {
    window.history.replaceState(null, "", "/products/list");
    const requested: string[] = [];
    stubPageDataFetch(requested);

    const router = new SPARouter({ scrollRestoration: false });
    router.setNavigationHandler(async () => {});

    await router.navigate("/dashboard", { scroll: false });

    expect(requested).toEqual(["/dashboard"]);
    expect(window.location.pathname).toBe("/dashboard");
    router.destroy();
  });
});
