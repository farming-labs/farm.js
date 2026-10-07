/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { applyFarmMetadataToDocument } from "../client/metadata-reconciler";
import { addMetadataMarkdownAlternate, mergeMetadata, renderMetadataHead } from "../metadata";

afterEach(() => {
  document.head.innerHTML = "";
});

describe("alternates.types", () => {
  it("renders typed alternates resolved against metadataBase", () => {
    const tags = renderMetadataHead({
      metadataBase: "https://farm.test",
      alternates: {
        types: {
          "application/rss+xml": [
            { url: "/feed.xml", title: "Farm blog" },
            { url: "https://cdn.farm.test/feed.xml" },
          ],
          "application/atom+xml": "/atom.xml",
        },
      },
    }).tags;

    expect(tags).toContain(
      '<link rel="alternate" href="https://farm.test/feed.xml" type="application/rss+xml" title="Farm blog">',
    );
    expect(tags).toContain(
      '<link rel="alternate" href="https://cdn.farm.test/feed.xml" type="application/rss+xml">',
    );
    expect(tags).toContain(
      '<link rel="alternate" href="https://farm.test/atom.xml" type="application/atom+xml">',
    );
  });

  it("escapes the type, URL, and title", () => {
    const tags = renderMetadataHead({
      alternates: {
        types: {
          'application/rss+xml"><script>': [{ url: '/feed"><script>', title: '<b>"Feed"</b>' }],
        },
      },
    }).tags;

    expect(tags).not.toContain("<script");
    expect(tags).toBe(
      '\n  <link rel="alternate" href="/feed&quot;&gt;&lt;script&gt;" type="application/rss+xml&quot;&gt;&lt;script&gt;" title="&lt;b&gt;&quot;Feed&quot;&lt;/b&gt;">',
    );
  });

  it("replaces as a whole across layouts and pages, like alternates.languages", () => {
    const layout = mergeMetadata(undefined, {
      alternates: { types: { "application/rss+xml": "/feed.xml" } },
    });
    expect(mergeMetadata(layout, { alternates: { canonical: "/post" } }).alternates).toEqual({
      canonical: "/post",
      types: { "application/rss+xml": "/feed.xml" },
    });
    expect(
      mergeMetadata(layout, { alternates: { types: { "application/atom+xml": "/atom.xml" } } })
        .alternates,
    ).toEqual({ types: { "application/atom+xml": "/atom.xml" } });
  });

  it("replaces typed alternates on client navigation", () => {
    document.head.innerHTML = [
      '<link rel="alternate" href="/a.md" type="text/markdown">',
      '<link rel="alternate" href="/feed.xml" type="application/rss+xml">',
    ].join("");

    applyFarmMetadataToDocument({ alternates: { types: { "text/markdown": "/b.md" } } }, "/b");

    const links = Array.from(document.head.querySelectorAll('link[rel="alternate"]'));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/b.md"]);
  });
});

describe("markdown alternate link", () => {
  it("advertises the page's Markdown mirror as a typed alternate", () => {
    const metadata = addMetadataMarkdownAlternate({ title: "About" }, "/about.md");
    expect(renderMetadataHead(metadata).tags).toContain(
      '<link rel="alternate" href="/about.md" type="text/markdown">',
    );
    // Like other metadata URLs, it is absolute when metadataBase is set.
    expect(
      renderMetadataHead(
        addMetadataMarkdownAlternate({ metadataBase: "https://farm.test" }, "/index.md"),
      ).tags,
    ).toContain('<link rel="alternate" href="https://farm.test/index.md" type="text/markdown">');
  });

  it("keeps an app-declared markdown alternate and other types", () => {
    const declared = addMetadataMarkdownAlternate(
      {
        alternates: {
          canonical: "/post",
          types: { "Text/Markdown": "/raw/post.md", "application/rss+xml": "/feed.xml" },
        },
      },
      "/post.md",
    );
    const tags = renderMetadataHead(declared).tags;
    expect(tags).toContain('<link rel="alternate" href="/raw/post.md" type="Text/Markdown">');
    expect(tags).not.toContain('href="/post.md"');

    const added = addMetadataMarkdownAlternate(
      { alternates: { types: { "application/rss+xml": "/feed.xml" } } },
      "/post.md",
    );
    expect(added.alternates?.types).toEqual({
      "application/rss+xml": "/feed.xml",
      "text/markdown": "/post.md",
    });
  });

  it("adds nothing without a mirror and keeps request-derived paths same-origin", () => {
    expect(addMetadataMarkdownAlternate({ title: "A" }, null)).toEqual({ title: "A" });
    expect(renderMetadataHead(addMetadataMarkdownAlternate({}, "//evil.test.md")).tags).toContain(
      '<link rel="alternate" href="/evil.test.md" type="text/markdown">',
    );
    expect(renderMetadataHead(addMetadataMarkdownAlternate({}, "/\\evil.test.md")).tags).toContain(
      '<link rel="alternate" href="/evil.test.md" type="text/markdown">',
    );
  });
});
