// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMarkdownMirrorResponse, htmlToMarkdown, resolveMarkdownConfig } from "../markdown";
import { createFarmMarkdownETag } from "../markdown-view";

const convert = (html: string) => htmlToMarkdown(html, { includeMetadata: false });

describe("Markdown layout row assembly", () => {
  it.each([".md", ""])(
    "preserves the row body and validators through %s negotiation",
    async (suffix) => {
      const labels = Array.from({ length: 1_000 }, (_, index) => `Item ${index}`);
      const html = `<main><div>${labels.map((label) => `<span>${label}</span>`).join("")}</div></main>`;
      const expected = `${labels.join(" ")}\n`;
      const url = `https://farm.test/rows${suffix}?lang=en&lang=fr`;
      const config = resolveMarkdownConfig({ includeMetadata: false });
      const respond = (method: string, etag?: string) =>
        createMarkdownMirrorResponse({
          request: new Request(url, {
            method,
            headers: { accept: "text/markdown", ...(etag ? { "if-none-match": etag } : {}) },
          }),
          config,
          renderPage: () => new Response(html, { headers: { "content-type": "text/html" } }),
        });
      const response = await respond("GET");
      expect(response?.status).toBe(200);
      expect(await response!.text()).toBe(expected);
      const etag = createFarmMarkdownETag(expected);
      expect(response!.headers.get("etag")).toBe(etag);
      for (const method of ["GET", "HEAD"]) {
        const cached = await respond(method, etag);
        expect(cached?.status).toBe(304);
        expect(await cached!.text()).toBe("");
      }
      const head = await respond("HEAD");
      expect(head?.status).toBe(200);
      expect(head!.headers.get("etag")).toBe(etag);
      expect(await head!.text()).toBe("");
    },
  );

  it.each([100, 1_000])("slices only linear text for %i adjacent items", (count) => {
    const labels = Array.from({ length: count }, (_, index) => `Item ${index}`);
    const html = `<main><div>${labels.map((label) => `<span>${label}</span>`).join("")}</div></main>`;
    const nativeSlice = String.prototype.slice;
    let slicedLength = 0;
    const spy = vi.spyOn(String.prototype, "slice").mockImplementation(function (
      this: string,
      ...args
    ) {
      const value = Reflect.apply(nativeSlice, this, args);
      slicedLength += value.length;
      return value;
    });
    let markdown: string;
    try {
      markdown = convert(html);
    } finally {
      spy.mockRestore();
    }
    expect(markdown).toBe(`${labels.join(" ")}\n`);
    // Count work, not time or engine-dependent memory allocation. Rebuilding
    // the whole row for each separator exceeds this linear bound.
    expect(slicedLength).toBeLessThanOrEqual(html.length * 3);
  });

  it.each([
    "div",
    "nav",
    "section",
    "header",
    "footer",
    "aside",
    "article",
    "figure",
    "figcaption",
    "dt",
    "dd",
  ])("preserves separated items in %s containers", (tag) => {
    expect(
      convert(
        `<main><${tag}><span>Alpha</span><span>Beta</span><span>Gamma</span></${tag}></main>`,
      ),
    ).toBe("Alpha Beta Gamma\n");
  });

  it.each([
    ["<div><span>Alpha</span></div>", "Alpha\n"],
    ["<div><span>a</span><span>b</span><span>c</span></div>", "abc\n"],
    ["<div>ex<span>am</span><span>ple</span></div>", "example\n"],
    ["<div><span>Alpha</span> <span>Beta</span><span>Gamma</span></div>", "Alpha Beta Gamma\n"],
    ["<div><span>Alpha</span>\n<span>Beta</span><span>Gamma</span></div>", "Alpha\nBeta Gamma\n"],
    ["<div><span><span>Nested</span></span><span>Tail</span></div>", "Nested Tail\n"],
    ["<div><span>Alpha</span><input><span>Beta</span></div>", "Alpha Beta\n"],
    ["<div><span>Alpha</span><span></span><span>Beta</span></div>", "Alpha Beta\n"],
    ["<div><span>Q&amp;A</span><span>&#x1F33E;</span><span>Café</span></div>", "Q&A 🌾 Café\n"],
    ["<div><span>Alpha</span><span hidden>Secret</span><span>Beta</span></div>", "Alpha Beta\n"],
    [
      '<div><span>Alpha</span><span hidden="until-found">Reveal</span><span>Beta</span></div>',
      "Alpha Reveal Beta\n",
    ],
    [
      "<div><div><span>Alpha</span><span>Beta</span></div><div><span>Gamma</span><span>Delta</span></div></div>",
      "Alpha Beta\n\nGamma Delta\n",
    ],
    [
      "<pre><code>&lt;div&gt;&lt;span&gt;Alpha&lt;/span&gt;&lt;span&gt;Beta&lt;/span&gt;&lt;/div&gt;</code></pre>",
      "```\n<div><span>Alpha</span><span>Beta</span></div>\n```\n",
    ],
    ["<blockquote><div><span>Alpha</span><span>Beta</span></div></blockquote>", "> Alpha Beta\n"],
  ])("preserves conversion for %s", (html, expected) => {
    expect(convert(`<main>${html}</main>`)).toBe(expected);
  });
});
