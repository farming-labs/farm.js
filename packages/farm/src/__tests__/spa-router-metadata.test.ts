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

  it("replaces verification, custom meta, robots, article, and typed alternate tags", async () => {
    window.history.replaceState(null, "", "/post");
    // The first page's head as the server rendered it from renderMetadataHead.
    document.head.innerHTML = [
      '<meta name="viewport" content="width=device-width">',
      '<meta name="googlebot" content="noindex">',
      '<meta name="google-site-verification" content="old-token">',
      '<meta name="facebook-domain-verification" content="fb" data-farm-metadata>',
      '<meta name="apple-itunes-app" content="app-id=1" data-farm-metadata>',
      '<meta property="article:published_time" content="2026-10-01">',
      '<meta property="article:tag" content="old">',
      '<link rel="alternate" href="/post.md" type="text/markdown">',
      '<link rel="alternate" href="/feed.xml" type="application/rss+xml">',
    ].join("");

    stubPageDataFetch({
      "/next": {
        verification: { google: "new-token" },
        other: { "apple-itunes-app": "app-id=2" },
        robots: { index: true, googleBot: { "max-snippet": 50 } },
        openGraph: { type: "article", tags: ["fresh"] },
        alternates: { types: { "text/markdown": "/next.md" } },
      },
      "/plain": {},
    });

    const router = createRouter();
    await router.navigate("/next", { scroll: false });

    expect(headAttribute('meta[name="google-site-verification"]', "content")).toBe("new-token");
    expect(document.head.querySelectorAll('meta[name="google-site-verification"]')).toHaveLength(1);
    expect(headAttribute('meta[name="apple-itunes-app"]', "content")).toBe("app-id=2");
    expect(document.head.querySelectorAll('meta[name="apple-itunes-app"]')).toHaveLength(1);
    // The previous page's app-named tag is gone even though the next page has no such name.
    expect(document.head.querySelector('meta[name="facebook-domain-verification"]')).toBeNull();
    expect(headAttribute('meta[name="googlebot"]', "content")).toBe("max-snippet:50");
    expect(document.head.querySelector('meta[property="article:published_time"]')).toBeNull();
    expect(
      Array.from(document.head.querySelectorAll('meta[property="article:tag"]')).map((tag) =>
        tag.getAttribute("content"),
      ),
    ).toEqual(["fresh"]);
    expect(headAttribute('link[rel="alternate"][type="text/markdown"]', "href")).toBe("/next.md");
    expect(document.head.querySelector('link[type="application/rss+xml"]')).toBeNull();
    // Document-level tags the metadata system does not own are kept.
    expect(headAttribute('meta[name="viewport"]', "content")).toBe("width=device-width");

    // Navigating on to a page without these fields removes the managed tags.
    await router.navigate("/plain", { scroll: false });
    expect(document.head.querySelector('meta[name="google-site-verification"]')).toBeNull();
    expect(document.head.querySelector('meta[name="apple-itunes-app"]')).toBeNull();
    expect(document.head.querySelector('meta[name="googlebot"]')).toBeNull();
    expect(document.head.querySelector('meta[property^="article:"]')).toBeNull();
    expect(document.head.querySelector('link[rel="alternate"]')).toBeNull();
    expect(headAttribute('meta[name="viewport"]', "content")).toBe("width=device-width");
    router.destroy();
  });
});
