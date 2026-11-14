/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  createFarmMetadataHeadReconciler,
  reconcileFarmDocumentHead,
} from "../client/document-head";

afterEach(() => {
  document.head.innerHTML = "";
});

describe("reconcileFarmDocumentHead", () => {
  it("replaces route metadata and removes tags absent from the next document", () => {
    document.head.innerHTML = `
      <title>Old page</title>
      <meta name="viewport" content="width=320">
      <meta name="description" content="Old description">
      <meta name="twitter:card" content="summary">
      <meta property="og:title" content="Old page">
      <meta itemprop="dateModified" content="2026-08-01">
      <link rel="canonical" href="https://example.test/old">
      <link rel="prev" href="https://example.test/page/1">
      <link rel="help" href="https://example.test/old-help">
      <link rel="stylesheet" href="/app.css">
    `;
    const nextDocument = new DOMParser().parseFromString(
      `<!doctype html><html><head>
        <title>New page</title>
        <meta name="viewport" content="width=device-width">
        <meta name="description" content="New description">
        <meta property="og:title" content="New page">
        <meta itemprop="dateModified" content="2026-09-03">
        <link rel="canonical" href="https://example.test/new">
        <link rel="alternate icon" hreflang="fr" href="https://example.test/fr/new">
        <link rel="next" href="https://example.test/page/3">
        <link rel="search" href="/opensearch.xml" type="application/opensearchdescription+xml">
      </head><body></body></html>`,
      "text/html",
    );

    reconcileFarmDocumentHead(nextDocument);

    expect(document.title).toBe("New page");
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe(
      "width=device-width",
    );
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "New description",
    );
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(
      "New page",
    );
    expect(document.querySelector('meta[itemprop="dateModified"]')?.getAttribute("content")).toBe(
      "2026-09-03",
    );
    expect(document.querySelector('meta[name="twitter:card"]')).toBeNull();
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://example.test/new",
    );
    expect(document.querySelector('link[rel~="alternate"]')?.getAttribute("hreflang")).toBe("fr");
    expect(document.querySelector('link[rel~="icon"]')?.getAttribute("href")).toBe(
      "https://example.test/fr/new",
    );
    expect(document.querySelector('link[rel="prev"]')).toBeNull();
    expect(document.querySelector('link[rel="help"]')).toBeNull();
    expect(document.querySelector('link[rel="next"]')?.getAttribute("href")).toBe(
      "https://example.test/page/3",
    );
    expect(document.querySelector('link[rel="search"]')?.getAttribute("href")).toBe(
      "/opensearch.xml",
    );
    expect(document.querySelector('link[rel="stylesheet"]')?.getAttribute("href")).toBe("/app.css");
  });
});

describe("createFarmMetadataHeadReconciler", () => {
  it("swaps only the metadata tags Farm injected, leaving other head nodes in place", () => {
    const initialMarkup =
      '<title>Home</title><meta name="description" content="Home page">' +
      '<link rel="canonical" href="/">' +
      '<link rel="alternate" hreflang="fr" href="https://example.test/fr">';
    // React's own nodes come first (a page's <meta> hoisted by React, the charset); the server
    // injects the route's markup at the end of <head>, followed by the stylesheet.
    document.head.innerHTML =
      '<meta charset="utf-8"><meta name="description" content="Home page" id="react-owned">' +
      '<meta name="theme-color" content="#000">' +
      initialMarkup +
      '<link rel="stylesheet" href="/app.css">';
    const reactOwned = Array.from(
      document.head.querySelectorAll('meta[name="theme-color"], #react-owned, meta[charset]'),
    );

    const apply = createFarmMetadataHeadReconciler(initialMarkup);
    apply(
      '<title>About</title><meta name="description" content="About page">' +
        '<link rel="canonical" href="/about">' +
        '<link rel="alternate" hreflang="fr" href="https://example.test/fr/about">' +
        '<meta name="robots" content="noindex">',
    );

    for (const node of reactOwned) expect(node.isConnected).toBe(true);
    const farmDescriptions = Array.from(
      document.head.querySelectorAll('meta[name="description"]:not(#react-owned)'),
    );
    expect(farmDescriptions.map((node) => node.getAttribute("content"))).toEqual(["About page"]);
    expect(
      Array.from(document.head.querySelectorAll('link[rel="canonical"]'), (node) =>
        node.getAttribute("href"),
      ),
    ).toEqual(["/about"]);
    expect(
      Array.from(document.head.querySelectorAll("link[hreflang]"), (node) =>
        node.getAttribute("href"),
      ),
    ).toEqual(["https://example.test/fr/about"]);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
    // The title is the router's; the stylesheet is not metadata.
    expect(document.head.querySelectorAll("title")).toHaveLength(1);
    expect(document.title).toBe("Home");
    expect(document.querySelector('link[rel="stylesheet"]')?.getAttribute("href")).toBe("/app.css");

    // The next navigation replaces the tags the last one inserted, and an empty head removes them.
    apply('<meta name="description" content="Contact page">');
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
    expect(
      Array.from(
        document.head.querySelectorAll('meta[name="description"]:not(#react-owned)'),
        (node) => node.getAttribute("content"),
      ),
    ).toEqual(["Contact page"]);
    apply("");
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.getElementById("react-owned")?.isConnected).toBe(true);
  });
});
