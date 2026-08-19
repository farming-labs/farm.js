// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  composeFarmFullDocument,
  extractFarmFullDocument,
  isFarmFullDocument,
  opensFarmFullDocument,
} from "../server/full-document";

// How a full-document root layout renders through the dev pipeline: the layout's
// own <html> document, wrapped in Farm's display:contents boundary/stream divs.
const wrappedFullDocument =
  '<div style="display:contents">' +
  '<div data-farm-layout-boundary="true" data-farm-layout-pattern="/" style="display:contents">' +
  '<html lang="en"><head><title>App</title></head><body><main>hello</main></body></html>' +
  "</div></div>";

const fragmentMarkup =
  '<div data-farm-layout-boundary="true" data-farm-layout-pattern="/" style="display:contents">' +
  '<main class="page">hello</main></div>';

describe("full-document detection", () => {
  it("extracts the document from Farm's display:contents wrappers", () => {
    expect(extractFarmFullDocument(wrappedFullDocument)).toBe(
      '<html lang="en"><head><title>App</title></head><body><main>hello</main></body></html>',
    );
  });

  it("treats a fragment layout as not-a-document", () => {
    expect(extractFarmFullDocument(fragmentMarkup)).toBeNull();
    expect(isFarmFullDocument(fragmentMarkup)).toBe(false);
  });

  it("recognises a raw <!DOCTYPE> document", () => {
    expect(isFarmFullDocument("<!DOCTYPE html><html><body>x</body></html>")).toBe(true);
  });

  it("opensFarmFullDocument sees a streamed prefix before </html> arrives", () => {
    const prefix = '<div style="display:contents"><html lang="en"><head><title>A';
    expect(opensFarmFullDocument(prefix)).toBe(true);
    expect(extractFarmFullDocument(prefix)).toBeNull(); // no closing tag yet
    expect(opensFarmFullDocument(fragmentMarkup)).toBe(false);
  });
});

describe("full-document composition", () => {
  it("produces exactly one html/head/body with Farm assets merged in", () => {
    const document = extractFarmFullDocument(wrappedFullDocument)!;
    const html = composeFarmFullDocument(document, {
      htmlAttributes: ' data-theme="dark"',
      headAssets: '<link rel="stylesheet" href="/globals.css" />',
      bodyFooter: '<script type="module" src="/@farm/client.js"></script>',
    });

    expect(html.match(/<html[\s>]/gi)).toHaveLength(1);
    expect(html.match(/<head[\s>]/gi)).toHaveLength(1);
    expect(html.match(/<body[\s>]/gi)).toHaveLength(1);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('<link rel="stylesheet" href="/globals.css" />');
    expect(html).toContain('id="root"');
    // Head asset lands inside <head>, footer inside <body>.
    expect(html.indexOf("/globals.css")).toBeLessThan(html.indexOf("</head>"));
    expect(html.indexOf("/@farm/client.js")).toBeLessThan(html.indexOf("</body>"));
  });

  it("inserts injected markup literally even with $-replacement sequences", () => {
    const document = "<html><head></head><body>$&amp; $` $' $$</body></html>";
    const html = composeFarmFullDocument(document, {
      headAssets: "<meta name=x>",
      bodyFooter: "<script>1</script>",
    });
    // The $-sequences in the document survive untouched (no expansion).
    expect(html).toContain("$&amp; $` $' $$");
    expect(html).toContain("<script>1</script>");
  });
});
