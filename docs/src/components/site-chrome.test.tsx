// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnnouncementBar } from "./site-chrome";

describe("release announcement", () => {
  it("links to the launch post instead of advertising the build's beta version", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementBar));
    expect(html).toContain('href="/blog/0.1.0"');
    expect(html).toContain("Farm.js v0.1.0 is released");
    expect(html).toContain("Read the announcement");
    expect(html).not.toContain("Open source");
    expect(html).not.toContain("beta");
  });

  it("gives the announcement action its own visibly underlined link", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementBar));
    const link = html.match(/<a\b[^>]*>Read the announcement<\/a>/)?.[0];

    expect(link).toBeDefined();
    expect(link).toContain('href="/blog/0.1.0"');
    expect(link).toMatch(/\bunderline\b/);
    expect(link).toContain("focus-visible:outline");
    expect(html.match(/<a\b/g)).toHaveLength(1);
  });
});
