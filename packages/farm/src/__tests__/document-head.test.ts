/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { reconcileFarmDocumentHead } from "../client/document-head";

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
