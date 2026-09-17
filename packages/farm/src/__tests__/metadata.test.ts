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
});
