import type { MetadataRoute } from "@farm.js/core";
import { launchPost } from "./blog";
import { SITE_URL } from "./site";

/**
 * Sitemap for the pages outside /docs. The docs engine serves /sitemap.xml with
 * the docs pages, so these pages get a second sitemap that robots.ts lists.
 */
export const SITE_SITEMAP_PATH = "/sitemap-site.xml";

const posts = [launchPost];

export function getSiteSitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/` },
    { url: `${SITE_URL}/agents` },
    { url: `${SITE_URL}/agents/check` },
    { url: `${SITE_URL}/blog` },
    ...posts.map((post) => ({ url: `${SITE_URL}${post.href}`, lastModified: post.dateTime })),
  ];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatLastModified(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function createSiteSitemapResponse(): Response {
  const entries = getSiteSitemap().map((entry) =>
    [
      "  <url>",
      `    <loc>${escapeXml(entry.url)}</loc>`,
      ...(entry.lastModified
        ? [`    <lastmod>${escapeXml(formatLastModified(entry.lastModified))}</lastmod>`]
        : []),
      "  </url>",
    ].join("\n"),
  );
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
