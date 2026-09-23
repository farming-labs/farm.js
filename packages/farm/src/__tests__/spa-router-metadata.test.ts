/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

type PageMetadata = Record<string, unknown>;

/** Serve per-path metadata the way the page-data endpoint now does. */
function stubPageDataFetch(pages: Record<string, PageMetadata | undefined>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const path = new URL(String(input), window.location.origin).searchParams.get("path")!;
      const pathname = path.split("?")[0]!;
      return Promise.resolve(
        Response.json({
          props: {},
          modulePath: `${pathname}.tsx`,
          metadata: pages[pathname],
        }),
      );
    }),
  );
}

function createRouter() {
  const router = new SPARouter({ scrollRestoration: false });
  router.setNavigationHandler(async () => {});
  return router;
}

function headAttribute(selector: string, attribute: string): string | null {
  return document.head.querySelector(selector)?.getAttribute(attribute) ?? null;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  document.head.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SPA navigation metadata", () => {
  it("resolves a template title object instead of stringifying it", async () => {
    window.history.replaceState(null, "", "/start");
    stubPageDataFetch({
      "/docs": { title: { default: "Docs Home", template: "%s | Docs" } },
    });

    const router = createRouter();
    await router.navigate("/docs", { scroll: false });

    expect(document.title).toBe("Docs Home");
    expect(document.title).not.toContain("object");
    router.destroy();
  });

  it("replaces canonical, description, and Open Graph tags on navigation", async () => {
    window.history.replaceState(null, "", "/a");
    // The first page's head as the server rendered it: no managed markers.
    document.head.innerHTML = [
      '<meta name="description" content="Page A">',
      '<link rel="canonical" href="https://site.test/a">',
      '<meta property="og:title" content="A">',
      '<meta property="og:image" content="https://site.test/a.png">',
    ].join("");

    stubPageDataFetch({
      "/b": {
        description: "Page B",
        openGraph: { title: "B", type: "article" },
      },
    });

    const router = createRouter();
    await router.navigate("/b", { scroll: false });

    expect(headAttribute('meta[name="description"]', "content")).toBe("Page B");
    expect(headAttribute('meta[property="og:title"]', "content")).toBe("B");
    expect(headAttribute('meta[property="og:type"]', "content")).toBe("article");
    // A's image must not leak into B's card.
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull();
    // The canonical follows the new page.
    expect(headAttribute('link[rel="canonical"]', "href")).toBe("/b");
    // No duplicates: the server-rendered originals were replaced, not joined.
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    router.destroy();
  });

  it("removes managed tags the next page does not define", async () => {
    window.history.replaceState(null, "", "/a");
    document.head.innerHTML = [
      '<meta name="description" content="Page A">',
      '<meta name="robots" content="noindex">',
      '<meta name="twitter:card" content="summary">',
    ].join("");

    stubPageDataFetch({ "/plain": {} });

    const router = createRouter();
    await router.navigate("/plain", { scroll: false });

    // A full-page load of /plain renders none of these, so navigation must not
    // keep them either.
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
    expect(document.head.querySelector('meta[name="twitter:card"]')).toBeNull();
    router.destroy();
  });

  it("keeps the document favicon when the next page defines no icons", async () => {
    window.history.replaceState(null, "", "/a");
    document.head.innerHTML = '<link rel="icon" href="/favicon.ico">';

    stubPageDataFetch({
      "/b": { description: "B" },
      "/branded": { icons: "/brand.svg" },
    });

    const router = createRouter();

    // Icons have a document-level default, so absence means keep.
    await router.navigate("/b", { scroll: false });
    expect(headAttribute('link[rel="icon"]', "href")).toBe("/favicon.ico");

    // A page that defines icons replaces them.
    await router.navigate("/branded", { scroll: false });
    expect(headAttribute('link[rel="icon"]', "href")).toBe("/brand.svg");
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    router.destroy();
  });
});
