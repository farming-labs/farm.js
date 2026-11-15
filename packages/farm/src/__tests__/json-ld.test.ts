import { describe, expect, it } from "vitest";
import * as jsonLd from "../json-ld";
import { renderMetadataHead } from "../metadata";
import type { Metadata } from "../types";

describe("json-ld helpers", () => {
  it("builds an article with people, a publisher, and ISO dates", () => {
    expect(
      jsonLd.article({
        type: "BlogPosting",
        headline: "Shipping metadata",
        url: "https://farm.test/blog/metadata",
        image: ["https://farm.test/og.png"],
        datePublished: new Date("2026-10-01T09:00:00Z"),
        dateModified: "2026-10-02",
        author: ["Ada", { name: "Farm", url: "https://farm.test", type: "Organization" }],
        publisher: { name: "Farm", logo: "https://farm.test/logo.png" },
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "Shipping metadata",
      url: "https://farm.test/blog/metadata",
      image: ["https://farm.test/og.png"],
      datePublished: "2026-10-01T09:00:00.000Z",
      dateModified: "2026-10-02",
      author: [
        { "@type": "Person", name: "Ada" },
        { "@type": "Organization", name: "Farm", url: "https://farm.test" },
      ],
      publisher: { "@type": "Organization", name: "Farm", logo: "https://farm.test/logo.png" },
    });
  });

  it("omits fields the caller left unset", () => {
    expect(jsonLd.article({ headline: "Hello", author: "Ada", image: [] })).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Hello",
      author: { "@type": "Person", name: "Ada" },
    });
    // An invalid date is dropped rather than serialized as null.
    expect(
      jsonLd.article({ headline: "Hello", datePublished: new Date("nope") }),
    ).not.toHaveProperty("datePublished");
  });

  it("numbers breadcrumb positions from one", () => {
    expect(
      jsonLd.breadcrumbList([
        { name: "Home", url: "https://farm.test" },
        { name: "Docs", url: "https://farm.test/docs" },
        { name: "Metadata" },
      ]),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://farm.test" },
        { "@type": "ListItem", position: 2, name: "Docs", item: "https://farm.test/docs" },
        { "@type": "ListItem", position: 3, name: "Metadata" },
      ],
    });
  });

  it("builds an FAQ page", () => {
    expect(jsonLd.faqPage([{ question: "Is it typed?", answer: "Yes." }])).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Is it typed?",
          acceptedAnswer: { "@type": "Answer", text: "Yes." },
        },
      ],
    });
  });

  it("builds a product with a brand, offers, and a rating", () => {
    expect(
      jsonLd.product({
        name: "Farm Hoodie",
        sku: "HOOD-1",
        brand: "Farm",
        offers: { price: 49, priceCurrency: "USD", availability: "InStock" },
        aggregateRating: { ratingValue: 4.8, reviewCount: 12 },
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Farm Hoodie",
      sku: "HOOD-1",
      brand: { "@type": "Brand", name: "Farm" },
      offers: {
        "@type": "Offer",
        price: 49,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
      aggregateRating: { "@type": "AggregateRating", ratingValue: 4.8, reviewCount: 12 },
    });
  });

  it("builds a software application and keeps a free price", () => {
    expect(
      jsonLd.softwareApplication({
        name: "Farm.js",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS, Linux, Windows",
        offers: [{ price: 0, priceCurrency: "USD" }],
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Farm.js",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Linux, Windows",
      offers: [{ "@type": "Offer", price: 0, priceCurrency: "USD" }],
    });
  });

  it("renders through metadata.jsonLd with values escaped", () => {
    const metadata: Metadata = {
      jsonLd: [
        jsonLd.article({ headline: "</script><script>alert(1)</script>" }),
        jsonLd.breadcrumbList([{ name: "Docs", url: "https://farm.test/docs" }]),
      ],
    };
    const tags = renderMetadataHead(metadata).tags;
    const scripts = [
      ...tags.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/g),
    ];

    expect(tags).not.toContain("<script>alert(1)");
    expect(scripts.map(([, json]) => JSON.parse(json!)["@type"])).toEqual([
      "Article",
      "BreadcrumbList",
    ]);
    expect(JSON.parse(scripts[0]![1]!).headline).toBe("</script><script>alert(1)</script>");
  });

  it("returns plain JSON-serializable objects that can be extended", () => {
    const value = { ...jsonLd.faqPage([]), inLanguage: "en" };
    expect(JSON.parse(JSON.stringify(value))).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: "en",
    });
  });
});
