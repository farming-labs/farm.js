/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { reconcileFarmDocumentHead } from "../client/document-head";
import { applyFarmMetadataToDocument } from "../client/metadata-reconciler";
import { mergeMetadata, renderMetadataHead } from "../metadata";

afterEach(() => {
  document.head.innerHTML = "";
});

function jsonLdScripts(html: string): Array<{ marked: boolean; data: any }> {
  return [...html.matchAll(/<script type="application\/ld\+json"([^>]*)>(.*?)<\/script>/gs)].map(
    ([, attributes, json]) => ({
      marked: attributes!.includes("data-farm-metadata"),
      data: JSON.parse(json!),
    }),
  );
}

function headJsonLd(): Array<{ marked: boolean; type: string }> {
  return Array.from(document.head.querySelectorAll('script[type="application/ld+json"]')).map(
    (script) => ({
      marked: script.hasAttribute("data-farm-metadata"),
      type: JSON.parse(script.textContent || "{}")["@type"],
    }),
  );
}

const article = { "@context": "https://schema.org", "@type": "Article", headline: "Hello" };
const breadcrumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList" };

describe("metadata.jsonLd", () => {
  it("renders one marked script per object", () => {
    const tags = renderMetadataHead({ jsonLd: [article, breadcrumbs] }).tags;
    expect(jsonLdScripts(tags)).toEqual([
      { marked: true, data: article },
      { marked: true, data: breadcrumbs },
    ]);
    expect(jsonLdScripts(renderMetadataHead({ jsonLd: article }).tags)).toEqual([
      { marked: true, data: article },
    ]);
  });

  it("renders alongside the site-level agent JSON-LD, which stays unmarked", () => {
    const tags = renderMetadataHead(
      { metadataBase: "https://farm.test", jsonLd: article },
      { jsonLd: { name: "Farm" } },
    ).tags;
    expect(jsonLdScripts(tags).map(({ marked, data }) => [marked, data["@type"]])).toEqual([
      [false, "Organization"],
      [true, "Article"],
    ]);
  });

  it("escapes values so they cannot close the script", () => {
    const tags = renderMetadataHead({
      jsonLd: { ...article, headline: "</script><script>alert(1)</script><!--" },
    }).tags;

    expect(tags).not.toContain("</script><script>");
    expect(tags).not.toContain("<!--");
    expect(tags).toContain("\\u003c/script>");
    expect(jsonLdScripts(tags)[0]!.data.headline).toBe("</script><script>alert(1)</script><!--");
  });

  it("skips entries that are not objects and renders nothing when unset", () => {
    const tags = renderMetadataHead({ jsonLd: [null, "x", [article], article] as any }).tags;
    expect(jsonLdScripts(tags)).toEqual([{ marked: true, data: article }]);
    expect(renderMetadataHead({ title: "Farm" }).tags).not.toContain("ld+json");
    expect(renderMetadataHead({ jsonLd: [] }).tags).not.toContain("ld+json");
  });

  it("combines layout and page entries, layouts first", () => {
    const root = mergeMetadata(undefined, { jsonLd: { "@type": "WebSite" } });
    const section = mergeMetadata(root, { title: "Docs" });
    const generated = mergeMetadata(section, { jsonLd: [breadcrumbs] });
    const page = mergeMetadata(generated, { jsonLd: article });

    expect(section.jsonLd).toEqual({ "@type": "WebSite" });
    expect(page.jsonLd).toEqual([{ "@type": "WebSite" }, breadcrumbs, article]);
    expect(jsonLdScripts(renderMetadataHead(page).tags).map(({ data }) => data["@type"])).toEqual([
      "WebSite",
      "BreadcrumbList",
      "Article",
    ]);
  });
});

describe("JSON-LD on client navigation", () => {
  const firstPageHead = () =>
    [
      // Site identity from agent.jsonLd and a script the app wrote itself: no marker.
      '<script type="application/ld+json">{"@type":"Organization"}</script>',
      '<script type="application/ld+json" id="app-owned">{"@type":"Event"}</script>',
      '<script type="application/ld+json" data-farm-metadata>{"@type":"Article"}</script>',
    ].join("");

  it("swaps page JSON-LD from page-data metadata and keeps unmarked scripts", () => {
    document.head.innerHTML = firstPageHead();

    applyFarmMetadataToDocument({ jsonLd: [breadcrumbs, { "@type": "FAQPage" }] }, "/faq");
    expect(headJsonLd()).toEqual([
      { marked: false, type: "Organization" },
      { marked: false, type: "Event" },
      { marked: true, type: "BreadcrumbList" },
      { marked: true, type: "FAQPage" },
    ]);

    applyFarmMetadataToDocument({}, "/plain");
    expect(headJsonLd()).toEqual([
      { marked: false, type: "Organization" },
      { marked: false, type: "Event" },
    ]);
  });

  it("swaps page JSON-LD from the next HTML document and keeps unmarked scripts", () => {
    document.head.innerHTML = firstPageHead();
    const next = new DOMParser().parseFromString(
      [
        "<!doctype html><html><head><title>FAQ</title>",
        '<script type="application/ld+json">{"@type":"Organization"}</script>',
        '<script type="application/ld+json" data-farm-metadata>{"@type":"FAQPage"}</script>',
        "</head><body></body></html>",
      ].join(""),
      "text/html",
    );

    reconcileFarmDocumentHead(next);
    expect(headJsonLd()).toEqual([
      { marked: false, type: "Organization" },
      { marked: false, type: "Event" },
      { marked: true, type: "FAQPage" },
    ]);
  });
});
