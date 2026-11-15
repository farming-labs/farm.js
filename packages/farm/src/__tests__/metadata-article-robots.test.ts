/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { applyFarmMetadataToDocument } from "../client/metadata-reconciler";
import { mergeMetadata, renderMetadataHead } from "../metadata";

afterEach(() => {
  document.head.innerHTML = "";
});

const article = {
  publishedTime: new Date("2026-10-01T09:00:00Z"),
  modifiedTime: "2026-10-02T10:00:00Z",
  authors: ["https://farm.test/team/ada", "Grace"],
  section: "Engineering",
  tags: ["metadata", "seo"],
};

describe("open graph article fields", () => {
  it("renders article properties for article pages", () => {
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
  });

  it("renders no article properties for other types or missing values", () => {
    const website = renderMetadataHead({ openGraph: { title: "Farm", ...article } }).tags;
    expect(website).toContain('<meta property="og:type" content="website">');
    expect(website).not.toContain("article:");
    expect(renderMetadataHead({ openGraph: { type: "article" } }).tags).not.toContain("article:");
    // An invalid date is dropped rather than rendered as "Invalid Date".
    expect(
      renderMetadataHead({ openGraph: { type: "article", publishedTime: new Date("nope") } }).tags,
    ).not.toContain("article:published_time");
  });

  it("escapes article values", () => {
    const tags = renderMetadataHead({
      openGraph: { type: "article", section: '"><script>', tags: ["<img src=x>"] },
    }).tags;
    expect(tags).not.toContain("<script");
    expect(tags).not.toContain("<img");
    expect(tags).toContain('<meta property="article:section" content="&quot;&gt;&lt;script&gt;">');
  });

  it("merges with the layout's Open Graph block", () => {
    const layout = mergeMetadata(undefined, {
      openGraph: { siteName: "Farm", type: "article", section: "Docs" },
    });
    const page = mergeMetadata(layout, { openGraph: { publishedTime: "2026-10-01" } });
    const tags = renderMetadataHead(page).tags;

    expect(tags).toContain('<meta property="og:site_name" content="Farm">');
    expect(tags).toContain('<meta property="article:section" content="Docs">');
    expect(tags).toContain('<meta property="article:published_time" content="2026-10-01">');
  });
});

describe("robots directives", () => {
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
  });

  it("accepts a googlebot string and keeps the existing forms unchanged", () => {
    expect(renderMetadataHead({ robots: { googleBot: "nofollow" } }).tags).toBe(
      '\n  <meta name="googlebot" content="nofollow">',
    );
    expect(renderMetadataHead({ robots: "noindex" }).tags).toBe(
      '\n  <meta name="robots" content="noindex">',
    );
    expect(renderMetadataHead({ robots: { index: false, follow: true } }).tags).toBe(
      '\n  <meta name="robots" content="noindex, follow">',
    );
  });

  it("replaces googlebot and article tags on client navigation", () => {
    // The first page's head as the server rendered it.
    document.head.innerHTML = [
      '<meta name="googlebot" content="noindex">',
      '<meta property="article:published_time" content="2026-10-01">',
      '<meta property="article:tag" content="old">',
    ].join("");

    applyFarmMetadataToDocument(
      {
        robots: { googleBot: { "max-snippet": 50 } },
        openGraph: { type: "article", tags: ["fresh"] },
      },
      "/next",
    );

    const googlebot = document.head.querySelectorAll('meta[name="googlebot"]');
    expect(Array.from(googlebot).map((tag) => tag.getAttribute("content"))).toEqual([
      "max-snippet:50",
    ]);
    expect(document.head.querySelector('meta[property="article:published_time"]')).toBeNull();
    const articleTags = document.head.querySelectorAll('meta[property="article:tag"]');
    expect(Array.from(articleTags).map((tag) => tag.getAttribute("content"))).toEqual(["fresh"]);

    applyFarmMetadataToDocument({}, "/plain");
    expect(document.head.querySelector('meta[name="googlebot"]')).toBeNull();
    expect(document.head.querySelector('meta[property^="article:"]')).toBeNull();
  });
});
