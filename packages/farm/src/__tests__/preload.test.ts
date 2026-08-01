// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearReportedFarmPreloadWarnings,
  manageFarmDocumentPreloads,
  manageFarmHtmlPreloads,
  manageFarmLinkHeaderPreloads,
  reportFarmPreloadWarnings,
  resolveFarmPerformanceConfig,
} from "../preload";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("smart preload manager", () => {
  it("defaults to one image and two font preloads in enforce mode", () => {
    expect(resolveFarmPerformanceConfig(undefined)).toEqual({
      preload: { mode: "enforce", maxImages: 1, maxFonts: 2 },
    });
  });

  it("keeps the high-priority LCP image and removes lower-priority image hints", () => {
    const config = resolveFarmPerformanceConfig(undefined).preload;
    const html = [
      '<link rel="preload" as="image" href="/logo.webp">',
      '<link rel="preload" as="image" href="/hero.webp" fetchPriority="High">',
      '<link rel="preload" as="image" href="/below-fold.webp">',
      '<link rel="modulepreload" href="/farm-client.js">',
    ].join("\n");

    const result = manageFarmHtmlPreloads(html, config);

    expect(result.value).toContain("/hero.webp");
    expect(result.value).not.toContain("/logo.webp");
    expect(result.value).not.toContain("/below-fold.webp");
    expect(result.value).toContain('rel="modulepreload"');
    expect(result.warnings).toEqual([{ kind: "image", count: 3, budget: 1, removed: 2 }]);
  });

  it("ignores link-looking text in comments and raw-text elements", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 1 } }).preload;
    const html = [
      '<script>const example = `<link rel="preload" as="image" href="/script.webp">`;</script>',
      '<!-- <link rel="preload" as="image" href="/comment.webp"> -->',
      '<template><link rel="preload" as="image" href="/template.webp"></template>',
      '<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">',
      '<link rel="preload" as="image" href="/below.webp" data-note="1 > 0">',
    ].join("\n");

    const result = manageFarmHtmlPreloads(html, config);

    expect(result.value).toContain("/script.webp");
    expect(result.value).toContain("/comment.webp");
    expect(result.value).toContain("/template.webp");
    expect(result.value).toContain("/hero.webp");
    expect(result.value).not.toContain("/below.webp");
    expect(result.warnings).toEqual([{ kind: "image", count: 2, budget: 1, removed: 1 }]);
  });

  it("only rewrites real HTML link elements outside inert and quoted content", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxImages: 1 } }).preload;
    const html = [
      `<div data-example='<link rel="preload" as="image" href="/attribute.webp">'>demo</div>`,
      '<link-card rel="preload" as="image" href="/custom.webp"></link-card>',
      '<title><link rel="preload" as="image" href="/title.webp"></title>',
      '<noscript><link rel="preload" as="image" href="/noscript.webp"></noscript>',
      '<script>const closing = "</scriptx>"; <link rel="preload" as="image" href="/script.webp"></script>',
      '<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">',
      '<link rel="preload" as="image" href="/below.webp">',
    ].join("\n");

    const result = manageFarmHtmlPreloads(html, config);

    expect(result.value).toContain("/attribute.webp");
    expect(result.value).toContain("/custom.webp");
    expect(result.value).toContain("/title.webp");
    expect(result.value).toContain("/noscript.webp");
    expect(result.value).toContain("/script.webp");
    expect(result.value).toContain("/hero.webp");
    expect(result.value).not.toContain("/below.webp");
    expect(result.warnings).toEqual([{ kind: "image", count: 2, budget: 1, removed: 1 }]);
  });

  it("caps font Link headers while preserving non-preload relations", () => {
    const config = resolveFarmPerformanceConfig(undefined).preload;
    const header = [
      "</fonts/body.woff2>; rel=preload; as=font; crossorigin",
      "</fonts/mono.woff2>; rel=preload; as=font; crossorigin",
      "</fonts/display.woff2>; rel=preload; as=font; crossorigin",
      "<https://api.example.test>; rel=preconnect",
    ].join(", ");

    const result = manageFarmLinkHeaderPreloads(header, config);

    expect(result.value).toContain("/fonts/body.woff2");
    expect(result.value).toContain("/fonts/mono.woff2");
    expect(result.value).not.toContain("/fonts/display.woff2");
    expect(result.value).toContain("rel=preconnect");
    expect(result.warnings).toEqual([{ kind: "font", count: 3, budget: 2, removed: 1 }]);
  });

  it("splits Link values with apostrophes in URIs", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxFonts: 1 } }).preload;
    const header = [
      "</fonts/designer's-body.woff2>; rel=preload; as=font",
      "</fonts/mono.woff2>; rel=preload; as=font",
      "<https://api.example.test>; rel=preconnect",
    ].join(", ");

    const result = manageFarmLinkHeaderPreloads(header, config);

    expect(result.value).toContain("designer's-body.woff2");
    expect(result.value).not.toContain("/fonts/mono.woff2");
    expect(result.value).toContain("rel=preconnect");
  });

  it("parses quoted parameters and relation token lists after the URI", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxFonts: 1 } }).preload;
    const header = [
      '</fonts/hero.woff2>; rel="preload alternate"; as="font"; fetchpriority="high"; title="two\\\\"',
      '</fonts/body.woff2>; rel = "preload" ; as = "font"',
      '<https://example.test/?rel=preload&as=font>; rel="next"',
    ].join(", ");

    const result = manageFarmLinkHeaderPreloads(header, config);

    expect(result.value).toContain("hero.woff2");
    expect(result.value).not.toContain("body.woff2");
    expect(result.value).toContain("rel=preload&as=font");
    expect(result.warnings).toEqual([{ kind: "font", count: 2, budget: 1, removed: 1 }]);
  });

  it("shares one budget across HTML and response Link hints", () => {
    const config = resolveFarmPerformanceConfig({ preload: { maxFonts: 2 } }).preload;
    const html = [
      '<link rel="preload" as="font" href="/fonts/body.woff2">',
      '<link rel="preload" as="font" href="/fonts/mono.woff2">',
    ].join("");
    const header = "</fonts/display.woff2>; rel=preload; as=font";

    const result = manageFarmDocumentPreloads(html, header, config);

    expect(result.html).toContain("body.woff2");
    expect(result.html).toContain("mono.woff2");
    expect(result.linkHeader).toBe("");
    expect(result.warnings).toEqual([{ kind: "font", count: 3, budget: 2, removed: 1 }]);
  });

  it("supports warning-only mode without changing the document", () => {
    const config = resolveFarmPerformanceConfig({
      preload: { mode: "warn", maxImages: 1 },
    }).preload;
    const html =
      '<link rel="preload" as="image" href="/one.webp"><link rel="preload" as="image" href="/two.webp">';

    expect(manageFarmHtmlPreloads(html, config)).toEqual({
      value: html,
      warnings: [{ kind: "image", count: 2, budget: 1, removed: 0 }],
    });
  });

  it("reports actionable preload budget guidance", () => {
    clearReportedFarmPreloadWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportFarmPreloadWarnings(
      [{ kind: "image", count: 4, budget: 1, removed: 3 }],
      "route /catalog",
    );

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("route /catalog emitted 4 image preload hints");
    expect(warn.mock.calls[0]?.[0]).toContain("LCP image");

    clearReportedFarmPreloadWarnings();
    reportFarmPreloadWarnings(
      [{ kind: "image", count: 4, budget: 1, removed: 3 }],
      "route /catalog",
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
