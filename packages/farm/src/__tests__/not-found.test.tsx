import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_NOT_FOUND_STYLES, DefaultNotFoundPage } from "../components/not-found";

describe("DefaultNotFoundPage", () => {
  it("renders an accessible recovery path and safely includes the requested route", () => {
    const html = renderToStaticMarkup(
      <DefaultNotFoundPage pathname={'/missing/<script>alert("x")</script>'} />,
    );

    expect(html).toContain('aria-labelledby="farm-default-not-found-title"');
    expect(html).toContain('id="farm-default-not-found-title"');
    expect(html).toContain("Page not found");
    expect(html).toContain("Requested route");
    expect(html).toContain("/missing/&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain('href="/"');
    expect(html).toContain("Return home");
    expect(html).not.toContain("#22c55e");
    expect(html).not.toContain("onmouseover");
  });

  it("supports system, class, and data-attribute theme preferences", () => {
    expect(DEFAULT_NOT_FOUND_STYLES).toContain("@media (prefers-color-scheme: dark)");
    expect(DEFAULT_NOT_FOUND_STYLES).toContain(".dark .farm-default-not-found");
    expect(DEFAULT_NOT_FOUND_STYLES).toContain('[data-theme="dark"]');
    expect(DEFAULT_NOT_FOUND_STYLES).toContain('[data-theme="light"]');
    expect(DEFAULT_NOT_FOUND_STYLES).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("omits the route row when no pathname is available", () => {
    const html = renderToStaticMarkup(<DefaultNotFoundPage />);

    expect(html).not.toContain("Requested route");
    expect(html).toContain("Page not found");
  });
});
