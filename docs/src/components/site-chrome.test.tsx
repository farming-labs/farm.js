// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnnouncementBar, SiteFooter } from "./site-chrome";

describe("release announcement", () => {
  it("links to the 0.2 preview post instead of advertising the build's beta version", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementBar));
    expect(html).toContain('href="/blog/0.2"');
    expect(html).toContain("Farm.js 0.2 preview is out");
    expect(html).toContain("Read the preview");
    expect(html).not.toContain("Open source");
    expect(html).not.toContain("beta");
  });

  it("gives the announcement action its own visibly underlined link", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementBar));
    const link = html.match(/<a\b[^>]*>Read the preview<\/a>/)?.[0];

    expect(link).toBeDefined();
    expect(link).toContain('href="/blog/0.2"');
    expect(link).toMatch(/\bunderline\b/);
    expect(link).toContain("focus-visible:outline");
    expect(html.match(/<a\b/g)).toHaveLength(1);
  });
});

describe("site footer", () => {
  it("links to the design page beside the source", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter));
    const link = html.match(/<a\b[^>]*href="\/design"[^>]*>[\s\S]*?<\/a>/)?.[0];

    expect(link).toBeDefined();
    expect(link).toContain("Design");
  });

  it("links to the privacy notice and the terms", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter));

    expect(html).toMatch(/<a\b[^>]*href="\/privacy"[^>]*>Privacy<\/a>/);
    expect(html).toMatch(/<a\b[^>]*href="\/terms"[^>]*>Terms<\/a>/);
  });
});
