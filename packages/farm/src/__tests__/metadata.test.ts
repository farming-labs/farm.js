import { describe, expect, it } from "vitest";
import { renderMetadataHead } from "../metadata";

describe("metadata head rendering", () => {
  it("reports when favicon metadata emits a browser icon", () => {
    const rendered = renderMetadataHead({
      icons: {
        icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
      },
    });

    expect(rendered.hasFavicon).toBe(true);
    expect(rendered.tags).toContain(
      '<link rel="icon" href="/favicon.svg" sizes="any" type="image/svg+xml">',
    );
  });

  it("distinguishes configured titles from the framework fallback", () => {
    // The document assembly suppresses its fallback <title> when a renderer
    // (e.g. <svelte:head>) emits one; that decision keys off this flag.
    expect(renderMetadataHead({ title: "Dashboard" })).toMatchObject({
      title: "Dashboard",
      hasExplicitTitle: true,
    });
    expect(renderMetadataHead({})).toMatchObject({
      title: "Farm.js App",
      hasExplicitTitle: false,
    });
    expect(renderMetadataHead(undefined)).toMatchObject({
      hasExplicitTitle: false,
    });
  });

  it("keeps the fallback available when only an Apple touch icon is configured", () => {
    const rendered = renderMetadataHead({
      icons: {
        apple: "/apple-touch-icon.png",
      },
    });

    expect(rendered.hasFavicon).toBe(false);
    expect(rendered.tags).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  });
});
