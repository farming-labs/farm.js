import { describe, expect, it } from "vitest";
import { mergeMetadata, renderMetadataHead } from "../metadata";

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
