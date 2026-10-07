// @vitest-environment node
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import robots from "../app/robots";
import { launchPost } from "./blog";
import { SITE_URL } from "./site";
import { createSiteSitemapResponse, getSiteSitemap } from "./site-sitemap";

const appDir = fileURLToPath(new URL("../app/", import.meta.url));

// Public static pages outside /docs, which the docs engine's sitemap covers.
// Dynamic routes and the signed-in telemetry dashboard have no place in a sitemap.
function sitePagePaths(): string[] {
  return readdirSync(appDir, { recursive: true, encoding: "utf8" })
    .map((file) => file.split(/[\\/]/))
    .filter((segments) => /^page\.(tsx|md|mdx)$/.test(segments.at(-1)!))
    .map((segments) => `/${segments.slice(0, -1).join("/")}`)
    .filter(
      (path) =>
        !/^\/(docs|api|telemetry)(\/|$)/.test(path) && !path.includes("[") && !path.includes("@"),
    );
}

describe("site sitemap", () => {
  it("lists every public page outside the docs", () => {
    const listed = getSiteSitemap().map((entry) => entry.url);
    const expected = [...new Set(sitePagePaths())].map((path) => `${SITE_URL}${path}`);
    expect(expected).toContain(`${SITE_URL}/`);
    expect(expected).toContain(`${SITE_URL}${launchPost.href}`);
    expect([...listed].sort()).toEqual(expected.sort());
  });

  it("serves absolute URLs as sitemap XML", async () => {
    const response = createSiteSitemapResponse();
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const body = await response.text();
    expect(body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset /);
    expect(body).toContain(
      `<loc>${SITE_URL}${launchPost.href}</loc>\n    <lastmod>${launchPost.dateTime}</lastmod>`,
    );
    for (const [, loc] of body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      expect(loc.startsWith(`${SITE_URL}/`)).toBe(true);
    }
  });

  it("is listed in robots.txt next to the docs sitemap", () => {
    expect(robots().sitemap).toEqual([`${SITE_URL}/sitemap.xml`, `${SITE_URL}/sitemap-site.xml`]);
  });
});
