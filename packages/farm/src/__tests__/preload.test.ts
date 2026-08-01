// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  manageFarmHtmlPreloads,
  manageFarmLinkHeaderPreloads,
  reportFarmPreloadWarnings,
  resolveFarmPerformanceConfig,
} from "../preload";

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
      '<link rel="preload" as="image" href="/hero.webp" fetchPriority="high">',
      '<link rel="preload" as="image" href="/below-fold.webp">',
      '<link rel="modulepreload" href="/farm-client.js">',
    ].join("\n");

    const result = manageFarmHtmlPreloads(html, config);

    expect(result.value).toContain("/hero.webp");
    expect(result.value).not.toContain("/logo.webp");
    expect(result.value).not.toContain("/below-fold.webp");
    expect(result.value).toContain('rel="modulepreload"');
    expect(result.warnings).toEqual([
      { kind: "image", count: 3, budget: 1, removed: 2 },
    ]);
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
    expect(result.warnings).toEqual([
      { kind: "font", count: 3, budget: 2, removed: 1 },
    ]);
  });

  it("supports warning-only mode without changing the document", () => {
    const config = resolveFarmPerformanceConfig({ preload: { mode: "warn", maxImages: 1 } })
      .preload;
    const html =
      '<link rel="preload" as="image" href="/one.webp"><link rel="preload" as="image" href="/two.webp">';

    expect(manageFarmHtmlPreloads(html, config)).toEqual({
      value: html,
      warnings: [{ kind: "image", count: 2, budget: 1, removed: 0 }],
    });
  });

  it("reports actionable preload budget guidance", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportFarmPreloadWarnings(
      [{ kind: "image", count: 4, budget: 1, removed: 3 }],
      "route /catalog",
    );

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("route /catalog emitted 4 image preload hints");
    expect(warn.mock.calls[0]?.[0]).toContain("LCP image");
  });
});
