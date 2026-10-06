import { describe, expect, it } from "vitest";
import { addMetadataMarkdownAlternate, mergeMetadata, renderMetadataHead } from "../metadata";

describe("metadata head rendering", () => {
  it("reports when favicon metadata emits a browser icon", () => {
    const rendered = renderMetadataHead({
      icons: {
        icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
      },
    });

    expect(rendered.hasFavicon).toBe(true);
    expect(rendered.tags).toContain(
      '<link rel="icon" href="/favicon.svg" sizes="any" type="image/svg+xml">',
    );
  });

  it("distinguishes configured titles from the framework fallback", () => {
    // The document assembly suppresses its fallback <title> when a renderer
    // (e.g. <svelte:head>) emits one; that decision keys off this flag.
    expect(renderMetadataHead({ title: "Dashboard" })).toMatchObject({
      title: "Dashboard",
      hasExplicitTitle: true,
    });
    expect(renderMetadataHead({})).toMatchObject({
      title: "Farm.js App",
      hasExplicitTitle: false,
    });
    expect(renderMetadataHead(undefined)).toMatchObject({
      hasExplicitTitle: false,
    });
  });

  it("applies parent title templates to child metadata", () => {
    const root = mergeMetadata(undefined, {
      title: { default: "Acme", template: "%s | Acme" },
    });
    const section = mergeMetadata(root, {
      title: { default: "Docs", template: "%s — Docs" },
    });
    const page = mergeMetadata(section, { title: "Getting started" });

    expect(renderMetadataHead(root).title).toBe("Acme");
    expect(renderMetadataHead(section).title).toBe("Docs | Acme");
    expect(renderMetadataHead(page).title).toBe("Getting started — Docs");
  });

  it("keeps the fallback available when only an Apple touch icon is configured", () => {
    const rendered = renderMetadataHead({
      icons: {
        apple: "/apple-touch-icon.png",
      },
    });

    expect(rendered.hasFavicon).toBe(false);
    expect(rendered.tags).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  });

  it("defaults a canonical link to the request path when the route sets none", () => {
    expect(renderMetadataHead({}, { pathname: "/about" }).tags).toContain(
      '<link rel="canonical" href="/about">',
    );
    // With a metadataBase configured the canonical is absolute.
    expect(
      renderMetadataHead({ metadataBase: "https://farm.test" }, { pathname: "/about" }).tags,
    ).toContain('<link rel="canonical" href="https://farm.test/about">');
    // No pathname and no explicit canonical means no canonical link.
    expect(renderMetadataHead({}).tags).not.toContain('rel="canonical"');
  });

  it("keeps the defaulted canonical same-origin for authority-introducing paths", () => {
    // A request path like `//evil.com` or `/\evil.com` must not become a
    // cross-origin canonical (SEO canonical poisoning). It is collapsed to a
    // same-origin path.
    const base = { metadataBase: "https://farm.test" };
    expect(renderMetadataHead(base, { pathname: "//evil.com/phish" }).tags).toContain(
      '<link rel="canonical" href="https://farm.test/evil.com/phish">',
    );
    expect(renderMetadataHead(base, { pathname: "/\\evil.com" }).tags).toContain(
      '<link rel="canonical" href="https://farm.test/evil.com">',
    );
    // Never an off-origin authority.
    expect(renderMetadataHead(base, { pathname: "//evil.com/phish" }).tags).not.toContain(
      "https://evil.com",
    );
    // Without a base the default stays a rooted path, never protocol-relative.
    expect(renderMetadataHead({}, { pathname: "//evil.com/phish" }).tags).toContain(
      '<link rel="canonical" href="/evil.com/phish">',
    );
  });

  it("keeps an explicit canonical over the request-path default", () => {
    const tags = renderMetadataHead(
      { alternates: { canonical: "https://farm.test/canonical" } },
      { pathname: "/about" },
    ).tags;
    expect(tags).toContain('<link rel="canonical" href="https://farm.test/canonical">');
    expect(tags).not.toContain('href="/about"');
  });

  it("defaults og:type to website when Open Graph data omits it", () => {
    expect(renderMetadataHead({ openGraph: { title: "Farm" } }).tags).toContain(
      '<meta property="og:type" content="website">',
    );
    // An explicit type is preserved.
    expect(renderMetadataHead({ openGraph: { title: "Farm", type: "article" } }).tags).toContain(
      '<meta property="og:type" content="article">',
    );
    // No Open Graph block means no og:type is invented.
    expect(renderMetadataHead({}).tags).not.toContain("og:type");
  });

  it("emits JSON-LD when agent jsonLd is enabled", () => {
    const tags = renderMetadataHead(
      {
        metadataBase: "https://farm.test",
        description: "A full-stack framework",
        openGraph: { siteName: "Farm.js" },
      },
      { jsonLd: true },
    ).tags;

    expect(tags).toContain('<script type="application/ld+json">');
    const json = tags.match(/application\/ld\+json">(.*?)<\/script>/s)?.[1] ?? "";
    const data = JSON.parse(json);
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Farm.js",
      url: "https://farm.test",
      description: "A full-stack framework",
    });
  });

  it("customizes JSON-LD type and fields, escaping the closing tag", () => {
    const tags = renderMetadataHead(
      { metadataBase: "https://farm.test" },
      {
        jsonLd: {
          type: "SoftwareApplication",
          name: "Farm</script><script>alert(1)",
          sameAs: ["https://github.com/farming-labs/farm.js"],
        },
      },
    ).tags;

    const json = tags.match(/application\/ld\+json">(.*?)<\/script>/s)?.[1] ?? "";
    // The literal closing tag must be escaped so it cannot break out.
    expect(json).not.toContain("</script>");
    expect(json).toContain("\\u003c/script>");
    const data = JSON.parse(json);
    expect(data["@type"]).toBe("SoftwareApplication");
    expect(data.sameAs).toEqual(["https://github.com/farming-labs/farm.js"]);
  });

  it("emits no JSON-LD when disabled", () => {
    expect(renderMetadataHead({ metadataBase: "https://farm.test" }).tags).not.toContain("ld+json");
    expect(
      renderMetadataHead({ metadataBase: "https://farm.test" }, { jsonLd: false }).tags,
    ).not.toContain("ld+json");
  });
});

describe("search and social metadata fields", () => {
  it("renders search console verification tokens", () => {
    const tags = renderMetadataHead({
      verification: {
        google: ["google-token-1", "google-token-2"],
        bing: "bing-token",
        yandex: "yandex-token",
        other: { "facebook-domain-verification": "fb-token", me: ["a@farm.test", "/about"] },
      },
    }).tags;

    expect(tags).toContain('<meta name="google-site-verification" content="google-token-1">');
    expect(tags).toContain('<meta name="google-site-verification" content="google-token-2">');
    expect(tags).toContain('<meta name="msvalidate.01" content="bing-token">');
    expect(tags).toContain('<meta name="yandex-verification" content="yandex-token">');
    // App-named tags carry the marker client navigation sweeps by.
    expect(tags).toContain(
      '<meta name="facebook-domain-verification" content="fb-token" data-farm-metadata>',
    );
    expect(tags).toContain('<meta name="me" content="a@farm.test" data-farm-metadata>');
    expect(tags).toContain('<meta name="me" content="/about" data-farm-metadata>');
  });

  it("renders arbitrary meta tags from other", () => {
    const tags = renderMetadataHead({
      other: {
        "apple-itunes-app": "app-id=123",
        rating: 5,
        "custom-list": ["one", 2],
        empty: "",
      },
    }).tags;

    expect(tags).toContain(
      '<meta name="apple-itunes-app" content="app-id=123" data-farm-metadata>',
    );
    expect(tags).toContain('<meta name="rating" content="5" data-farm-metadata>');
    expect(tags).toContain('<meta name="custom-list" content="one" data-farm-metadata>');
    expect(tags).toContain('<meta name="custom-list" content="2" data-farm-metadata>');
    expect(tags).not.toContain('name="empty"');
  });

  it("escapes names and values the app controls", () => {
    const tags = renderMetadataHead({
      other: { 'x"><script>alert(1)</script>': '"><img src=x onerror=alert(1)>' },
      verification: { google: '"><script>' },
      alternates: {
        types: {
          'application/rss+xml"><script>': [{ url: '/feed"><script>', title: '<b>"Feed"</b>' }],
        },
      },
      openGraph: { type: "article", tags: ['"><script>'] },
    }).tags;

    expect(tags).not.toContain("<script");
    expect(tags).not.toContain("<img");
    expect(tags).toContain(
      '<meta name="x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" content="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;" data-farm-metadata>',
    );
    expect(tags).toContain(
      '<link rel="alternate" href="/feed&quot;&gt;&lt;script&gt;" type="application/rss+xml&quot;&gt;&lt;script&gt;" title="&lt;b&gt;&quot;Feed&quot;&lt;/b&gt;">',
    );
  });

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

  it("renders Open Graph article fields only for article pages", () => {
    const article = {
      publishedTime: new Date("2026-10-01T09:00:00Z"),
      modifiedTime: "2026-10-02T10:00:00Z",
      authors: ["https://farm.test/team/ada", "Grace"],
      section: "Engineering",
      tags: ["metadata", "seo"],
    };
    const tags = renderMetadataHead({ openGraph: { type: "article", ...article } }).tags;

    expect(tags).toContain(
      '<meta property="article:published_time" content="2026-10-01T09:00:00.000Z">',
    );
    expect(tags).toContain(
      '<meta property="article:modified_time" content="2026-10-02T10:00:00Z">',
    );
    expect(tags).toContain('<meta property="article:author" content="https://farm.test/team/ada">');
    expect(tags).toContain('<meta property="article:author" content="Grace">');
    expect(tags).toContain('<meta property="article:section" content="Engineering">');
    expect(tags).toContain('<meta property="article:tag" content="metadata">');
    expect(tags).toContain('<meta property="article:tag" content="seo">');

    // A website keeps its Open Graph tags but gets no article properties.
    const website = renderMetadataHead({ openGraph: { title: "Farm", ...article } }).tags;
    expect(website).toContain('<meta property="og:type" content="website">');
    expect(website).not.toContain("article:");
    // An invalid date is dropped rather than rendered as "Invalid Date".
    expect(
      renderMetadataHead({ openGraph: { type: "article", publishedTime: new Date("nope") } }).tags,
    ).not.toContain("article:published_time");
  });

  it("renders extended robots and googlebot directives", () => {
    const tags = renderMetadataHead({
      robots: {
        index: true,
        follow: false,
        noarchive: true,
        nosnippet: false,
        noimageindex: true,
        "max-snippet": -1,
        "max-image-preview": "large",
        "max-video-preview": 30,
        unavailable_after: "2027-01-01",
        googleBot: {
          index: false,
          nosnippet: true,
          "max-image-preview": "none",
        },
      },
    }).tags;

    expect(tags).toContain(
      '<meta name="robots" content="index, nofollow, noarchive, noimageindex, max-snippet:-1, max-image-preview:large, max-video-preview:30, unavailable_after:2027-01-01">',
    );
    expect(tags).toContain(
      '<meta name="googlebot" content="noindex, nosnippet, max-image-preview:none">',
    );
    expect(renderMetadataHead({ robots: { googleBot: "nofollow" } }).tags).toBe(
      '\n  <meta name="googlebot" content="nofollow">',
    );
    // The existing string and index/follow forms are unchanged.
    expect(renderMetadataHead({ robots: "noindex" }).tags).toBe(
      '\n  <meta name="robots" content="noindex">',
    );
    expect(renderMetadataHead({ robots: { index: false } }).tags).toBe(
      '\n  <meta name="robots" content="noindex">',
    );
  });

  it("emits nothing for the new fields when the app does not set them", () => {
    const tags = renderMetadataHead({ title: "Farm", openGraph: { type: "article" } }).tags;
    expect(tags).not.toContain("verification");
    expect(tags).not.toContain("data-farm-metadata");
    expect(tags).not.toContain("article:");
    expect(tags).not.toContain("googlebot");
    expect(tags).not.toContain('rel="alternate"');
  });

  it("merges the new fields across layouts and pages like the existing nested fields", () => {
    const layout = mergeMetadata(undefined, {
      verification: { google: "site-token", other: { me: "/about" } },
      other: { "apple-itunes-app": "app-id=1", "format-detection": "telephone=no" },
      alternates: { types: { "application/rss+xml": "/feed.xml" } },
      openGraph: { siteName: "Farm", type: "article", section: "Docs" },
    });
    const page = mergeMetadata(layout, {
      verification: { bing: "bing-token" },
      other: { "apple-itunes-app": "app-id=2" },
      alternates: { canonical: "/post" },
      openGraph: { publishedTime: "2026-10-01" },
    });

    // One level deep with page keys winning, the same as openGraph and alternates.
    expect(page.verification).toEqual({
      google: "site-token",
      bing: "bing-token",
      other: { me: "/about" },
    });
    expect(page.other).toEqual({
      "apple-itunes-app": "app-id=2",
      "format-detection": "telephone=no",
    });
    expect(page.alternates).toEqual({
      canonical: "/post",
      types: { "application/rss+xml": "/feed.xml" },
    });
    const tags = renderMetadataHead(page).tags;
    expect(tags).toContain('<meta property="article:section" content="Docs">');
    expect(tags).toContain('<meta property="article:published_time" content="2026-10-01">');
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
    expect(tags).toContain('<link rel="alternate" href="/feed.xml" type="application/rss+xml">');

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
