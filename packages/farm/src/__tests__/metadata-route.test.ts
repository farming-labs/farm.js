import { describe, expect, it } from "vitest";
import { createFarmMetadataRouteResponse } from "../metadata-route";

describe("application metadata route responses", () => {
  it("serializes sitemap entries and escapes XML values", async () => {
    const response = createFarmMetadataRouteResponse(
      "sitemap",
      [
        {
          url: "https://farm.test/products?a=1&b=2",
          lastModified: new Date("2026-08-16T12:00:00.000Z"),
          changeFrequency: "daily",
          priority: 0.8,
          alternates: {
            languages: {
              en: "https://farm.test/en/products",
              am: "https://farm.test/am/products",
            },
          },
        },
      ],
      { revalidate: 600 },
    );

    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=600, stale-while-revalidate=300",
    );
    expect(await response.text()).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://farm.test/products?a=1&amp;b=2</loc>
    <lastmod>2026-08-16T12:00:00.000Z</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
    <xhtml:link rel="alternate" hreflang="en" href="https://farm.test/en/products" />
    <xhtml:link rel="alternate" hreflang="am" href="https://farm.test/am/products" />
  </url>
</urlset>
`);
  });

  it("serializes robots rules, sitemaps, and host", async () => {
    const response = createFarmMetadataRouteResponse("robots", {
      rules: [
        { userAgent: "*", allow: "/", disallow: ["/admin/", "/preview/"] },
        { userAgent: ["FarmBot", "SearchBot"], crawlDelay: 2 },
      ],
      sitemap: ["https://farm.test/sitemap.xml", "https://farm.test/docs/sitemap.xml"],
      host: "https://farm.test",
    });

    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe(`User-agent: *
Allow: /
Disallow: /admin/
Disallow: /preview/

User-agent: FarmBot
User-agent: SearchBot
Crawl-delay: 2

Sitemap: https://farm.test/sitemap.xml
Sitemap: https://farm.test/docs/sitemap.xml
Host: https://farm.test
`);
  });

  it("serializes manifests and automatically strips the body for HEAD", async () => {
    const response = createFarmMetadataRouteResponse(
      "manifest",
      {
        name: "Farm Store",
        short_name: "Store",
        start_url: "/",
        display: "standalone",
      },
      {},
      { method: "HEAD" },
    );

    expect(response.headers.get("content-type")).toBe("application/manifest+json; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("");
  });

  it("preserves custom Responses and rejects unsupported methods", async () => {
    const custom = new Response("custom feed", {
      status: 202,
      headers: { "x-custom": "yes" },
    });
    expect(createFarmMetadataRouteResponse("sitemap", custom)).toBe(custom);

    const response = createFarmMetadataRouteResponse("robots", {}, {}, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("reports invalid convention values with focused errors", () => {
    expect(() => createFarmMetadataRouteResponse("sitemap", {})).toThrow(
      "sitemap.ts must return an array",
    );
    expect(() => createFarmMetadataRouteResponse("robots", { rules: [] })).toThrow(
      "at least one rule",
    );
    expect(() => createFarmMetadataRouteResponse("manifest", [])).toThrow(
      "manifest.ts must return a manifest object",
    );
  });
});
