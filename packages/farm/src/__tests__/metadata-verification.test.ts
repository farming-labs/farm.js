/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { applyFarmMetadataToDocument } from "../client/metadata-reconciler";
import { mergeMetadata, renderMetadataHead } from "../metadata";

afterEach(() => {
  document.head.innerHTML = "";
});

describe("metadata verification", () => {
  it("renders search console verification tokens", () => {
    const tags = renderMetadataHead({
      verification: {
        google: ["google-token-1", "google-token-2"],
        bing: "bing-token",
        yandex: "yandex-token",
        other: { "facebook-domain-verification": "fb-token", me: ["a@farm.test", "/about"] },
      },
    }).tags;

    expect(tags).toContain('<meta name="google-site-verification" content="google-token-1">');
    expect(tags).toContain('<meta name="google-site-verification" content="google-token-2">');
    expect(tags).toContain('<meta name="msvalidate.01" content="bing-token">');
    expect(tags).toContain('<meta name="yandex-verification" content="yandex-token">');
    // App-named tags carry the marker client navigation sweeps by.
    expect(tags).toContain(
      '<meta name="facebook-domain-verification" content="fb-token" data-farm-metadata>',
    );
    expect(tags).toContain('<meta name="me" content="a@farm.test" data-farm-metadata>');
    expect(tags).toContain('<meta name="me" content="/about" data-farm-metadata>');
  });

  it("escapes tokens and custom names", () => {
    const tags = renderMetadataHead({
      verification: {
        google: '"><script>alert(1)</script>',
        other: { 'x"><img src=x>': "<b>" },
      },
    }).tags;

    expect(tags).not.toContain("<script");
    expect(tags).not.toContain("<img");
    expect(tags).toContain(
      '<meta name="google-site-verification" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">',
    );
    expect(tags).toContain(
      '<meta name="x&quot;&gt;&lt;img src=x&gt;" content="&lt;b&gt;" data-farm-metadata>',
    );
  });

  it("renders nothing when unset or empty", () => {
    expect(renderMetadataHead({ title: "Farm" }).tags).toBe("");
    expect(renderMetadataHead({ verification: { google: "", other: { "": "x" } } }).tags).toBe("");
  });

  it("merges one level deep across layouts and pages", () => {
    const layout = mergeMetadata(undefined, {
      verification: { google: "site-token", other: { me: "/about" } },
    });
    const page = mergeMetadata(layout, { verification: { bing: "bing-token" } });

    // Same as openGraph and alternates: the page adds keys and replaces repeated ones.
    expect(page.verification).toEqual({
      google: "site-token",
      bing: "bing-token",
      other: { me: "/about" },
    });
  });

  it("replaces verification tags on client navigation", () => {
    // The first page's head as the server rendered it.
    document.head.innerHTML = [
      '<meta name="viewport" content="width=device-width">',
      '<meta name="google-site-verification" content="old-token">',
      '<meta name="facebook-domain-verification" content="fb" data-farm-metadata>',
    ].join("");

    applyFarmMetadataToDocument({ verification: { google: "new-token" } }, "/next");

    const google = document.head.querySelectorAll('meta[name="google-site-verification"]');
    expect(Array.from(google).map((tag) => tag.getAttribute("content"))).toEqual(["new-token"]);
    // The previous page's custom name is gone though the next page has no such name.
    expect(document.head.querySelector('meta[name="facebook-domain-verification"]')).toBeNull();
    // Document tags the metadata system does not own stay.
    expect(document.head.querySelector('meta[name="viewport"]')).not.toBeNull();

    applyFarmMetadataToDocument({}, "/plain");
    expect(document.head.querySelector('meta[name="google-site-verification"]')).toBeNull();
    expect(document.head.querySelector('meta[name="viewport"]')).not.toBeNull();
  });
});
