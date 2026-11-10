/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { applyFarmMetadataToDocument } from "../client/metadata-reconciler";
import {
  mergeModuleViewport,
  renderMetadataHead,
  renderViewportHead,
  resolveFarmNotFoundMetadata,
} from "../metadata";
import { composeFarmFullDocument, ensureFarmDocumentMeta } from "../server/full-document";

afterEach(() => {
  document.head.innerHTML = "";
});

describe("viewport export", () => {
  it("renders the Next.js default when nothing sets a viewport", () => {
    expect(renderMetadataHead({}).viewport).toBe(
      '<meta name="viewport" content="width=device-width, initial-scale=1" data-farm-metadata>',
    );
  });

  it("merges layout and page exports over the default, page last", async () => {
    let metadata = await mergeModuleViewport(
      {},
      { viewport: { maximumScale: 1, themeColor: "#000" } },
      { params: {} },
    );
    metadata = await mergeModuleViewport(
      metadata,
      { generateViewport: async () => ({ userScalable: false, colorScheme: "dark light" }) },
      { params: {} },
    );

    expect(renderMetadataHead(metadata).viewport.split("\n  ")).toEqual([
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" data-farm-metadata>',
      '<meta name="theme-color" content="#000" data-farm-metadata>',
      '<meta name="color-scheme" content="dark light" data-farm-metadata>',
    ]);
  });

  it("renders a theme color per media query", () => {
    expect(
      renderViewportHead({
        themeColor: [
          { media: "(prefers-color-scheme: light)", color: "white" },
          { media: "(prefers-color-scheme: dark)", color: "black" },
        ],
      }),
    ).toContain(
      '<meta name="theme-color" content="black" media="(prefers-color-scheme: dark)" data-farm-metadata>',
    );
  });

  it("applies the layouts' viewport to the not-found page", async () => {
    const metadata = await resolveFarmNotFoundMetadata([{ viewport: { maximumScale: 1 } }], null);
    expect(renderMetadataHead(metadata).viewport).toContain("maximum-scale=1");
  });
});

describe("full-document head", () => {
  const viewport = renderViewportHead({ maximumScale: 1 });

  it("opens a layout's head with the charset, then the viewport", () => {
    const html = composeFarmFullDocument(
      '<html lang="en"><head><title>App</title></head><body>page</body></html>',
      { headAssets: '<link rel="stylesheet" href="/app.css">', bodyFooter: "", viewport },
    );

    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head.startsWith(`<head><meta charset="utf-8">${viewport}`)).toBe(true);
  });

  it("keeps each tag the layout writes itself and adds the rest", () => {
    const html = ensureFarmDocumentMeta(
      '<html><head><meta charSet="utf-8"/><meta name="viewport" content="width=500"/></head></html>',
      renderViewportHead({ themeColor: "#fff" }),
    );

    expect(html.match(/charset/gi)).toHaveLength(1);
    expect(html.match(/name="viewport"/g)).toHaveLength(1);
    expect(html).toContain('content="width=500"');
    expect(html).toContain('<meta name="theme-color" content="#fff" data-farm-metadata>');
  });

  it("does not take a viewport-fit tag for the viewport", () => {
    const html = ensureFarmDocumentMeta(
      '<html><head><meta charset="utf-8"><meta name="viewport-fit" content="cover"></head></html>',
      viewport,
    );
    expect(html).toContain(viewport);
  });
});

describe("viewport on client navigation", () => {
  it("replaces the viewport tags Farm rendered", () => {
    document.head.innerHTML =
      '<meta charset="utf-8">' + renderViewportHead({ maximumScale: 1, themeColor: "#000" });

    applyFarmMetadataToDocument({ viewport: { initialScale: 2 } }, "/next");

    const tags = Array.from(document.head.querySelectorAll("meta[name]"));
    expect(tags.map((tag) => [tag.getAttribute("name"), tag.getAttribute("content")])).toEqual([
      ["viewport", "width=device-width, initial-scale=2"],
    ]);
    // Where a page load renders it: right after the charset.
    expect(document.head.firstElementChild?.nextElementSibling?.getAttribute("name")).toBe(
      "viewport",
    );
  });

  it("leaves a viewport tag the app wrote into its own document", () => {
    document.head.innerHTML = '<meta charset="utf-8"><meta name="viewport" content="width=500">';

    applyFarmMetadataToDocument({ viewport: { maximumScale: 1 } }, "/next");

    const viewports = document.head.querySelectorAll('meta[name="viewport"]');
    expect(Array.from(viewports).map((tag) => tag.getAttribute("content"))).toEqual(["width=500"]);
  });
});
