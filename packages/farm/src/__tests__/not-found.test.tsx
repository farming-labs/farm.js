import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_NOT_FOUND_STYLES, DefaultNotFoundPage } from "../components/not-found";

describe("DefaultNotFoundPage", () => {
  it("renders only the error code and home recovery action", () => {
    const html = renderToStaticMarkup(
      <DefaultNotFoundPage pathname={'/missing/<script>alert("x")</script>'} />,
    );

    expect(html).toContain('aria-labelledby="farm-default-not-found-title"');
    expect(html).toContain('id="farm-default-not-found-title"');
    expect(html).toContain(">404</h1>");
    expect(html).toContain('href="/"');
    expect(html).toContain("Go home");
    expect(html).not.toContain("Requested route");
    expect(html).not.toContain("Page not found");
    expect(html).not.toContain("/missing/");
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

  it("keeps the minimal markup when no pathname is available", () => {
    const html = renderToStaticMarkup(<DefaultNotFoundPage />);

    expect(html).not.toContain("Requested route");
    expect(html).toContain(">404</h1>");
    expect(html).toContain("Go home");
  });
});
