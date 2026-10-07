/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { applyFarmMetadataToDocument } from "../client/metadata-reconciler";
import { mergeMetadata, renderMetadataHead } from "../metadata";

afterEach(() => {
  document.head.innerHTML = "";
});

describe("metadata.other", () => {
  it("renders a meta tag per key and per array value", () => {
    const tags = renderMetadataHead({
      other: {
        "apple-itunes-app": "app-id=123",
        rating: 5,
        "custom-list": ["one", 2],
        empty: "",
      },
    }).tags;

    expect(tags).toContain(
      '<meta name="apple-itunes-app" content="app-id=123" data-farm-metadata>',
    );
    expect(tags).toContain('<meta name="rating" content="5" data-farm-metadata>');
    expect(tags).toContain('<meta name="custom-list" content="one" data-farm-metadata>');
    expect(tags).toContain('<meta name="custom-list" content="2" data-farm-metadata>');
    expect(tags).not.toContain('name="empty"');
  });

  it("escapes names and values", () => {
    const tags = renderMetadataHead({
      other: { 'x"><script>alert(1)</script>': '"><img src=x onerror=alert(1)>' },
    }).tags;

    expect(tags).not.toContain("<script");
    expect(tags).not.toContain("<img");
    expect(tags).toBe(
      '\n  <meta name="x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" content="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;" data-farm-metadata>',
    );
  });

  it("renders nothing when unset", () => {
    expect(renderMetadataHead({ title: "Farm", description: "d" }).tags).not.toContain(
      "data-farm-metadata",
    );
  });

  it("merges one level deep across layouts and pages", () => {
    const layout = mergeMetadata(undefined, {
      other: { "apple-itunes-app": "app-id=1", "format-detection": "telephone=no" },
    });
    const page = mergeMetadata(layout, { other: { "apple-itunes-app": "app-id=2" } });

    expect(page.other).toEqual({
      "apple-itunes-app": "app-id=2",
      "format-detection": "telephone=no",
    });
  });

  it("replaces custom tags on client navigation", () => {
    // The first page's head as the server rendered it.
    document.head.innerHTML = [
      '<meta name="viewport" content="width=device-width">',
      '<meta name="apple-itunes-app" content="app-id=1" data-farm-metadata>',
      '<meta name="pinterest" content="nopin" data-farm-metadata>',
    ].join("");

    applyFarmMetadataToDocument({ other: { "apple-itunes-app": "app-id=2" } }, "/next");

    const app = document.head.querySelectorAll('meta[name="apple-itunes-app"]');
    expect(Array.from(app).map((tag) => tag.getAttribute("content"))).toEqual(["app-id=2"]);
    // A name only the previous page used is removed too.
    expect(document.head.querySelector('meta[name="pinterest"]')).toBeNull();
    // Document tags the metadata system does not own stay.
    expect(document.head.querySelector('meta[name="viewport"]')).not.toBeNull();

    applyFarmMetadataToDocument({}, "/plain");
    expect(document.head.querySelector('meta[name="apple-itunes-app"]')).toBeNull();
    expect(document.head.querySelector('meta[name="viewport"]')).not.toBeNull();
  });
});
