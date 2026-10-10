// @vitest-environment node

import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import React from "react";
import { renderToPipeableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  composeFarmFullDocument,
  extractFarmFullDocument,
  isFarmFullDocument,
  opensFarmFullDocument,
  removeFarmDocumentTitles,
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

// Evaluate the production template just as build generation does, including
// escaped regular expressions. Keep shared dev/production regressions together.
function productionExtractor(): typeof extractFarmFullDocument {
  const source = readFileSync(new URL("../nitro/universal-build.ts", import.meta.url), "utf8");
  const start = source.indexOf("function stripFarmDocumentWrappers(markup)");
  const end = source.indexOf("function ensureFarmDocumentHead(markup)", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const generated = new Function("return `" + source.slice(start, end) + "`;")();
  return new Function(generated + "; return extractFarmFullDocument;")();
}

describe.each([
  ["development", extractFarmFullDocument],
  ["production", productionExtractor()],
] as const)("%s full-document Unicode boundaries", (_runtime, extract) => {
  it.each(["İstanbul", "İİİİİİİİ", "🌱İ$&"])("preserves %s and its reveal tail", (text) => {
    const body = `<html><head></head><body><p>${text}</p>`;
    const tail = '<div hidden id="S:0">ready</div><script>reveal()</script>';
    expect(extract(`<div style="display:contents">${body}</body></html></div>${tail}`)).toBe(
      `${body}${tail}</body></html>`,
    );
  });

  it("preserves case-insensitive last-closing-tag and incomplete-document behavior", () => {
    expect(extract("<HTML><BODY>İstanbul</BODY></HtMl>")).toBe(
      "<HTML><BODY>İstanbul</BODY></HtMl>",
    );
    expect(extract("<html><body>İstanbul</body>")).toBeNull();
    expect(extract("<main>İstanbul</main>")).toBeNull();
    expect(extract("<html><body>İstanbul</html>tail</body></HTML>")).toBe(
      "<html><body>İstanbul</html>tail</body></HTML>",
    );
  });

  it("preserves a real React Suspense reveal after Unicode content", async () => {
    let release!: () => void;
    let ready = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    function Deferred() {
      if (!ready) throw gate;
      return React.createElement("p", { id: "unicode-reveal" }, "stream complete");
    }
    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    const completed = finished(destination);
    const tree = React.createElement(
      "div",
      { style: { display: "contents" } },
      React.createElement(
        "html",
        null,
        React.createElement("head"),
        React.createElement(
          "body",
          null,
          React.createElement("p", null, "İstanbul"),
          React.createElement(
            React.Suspense,
            { fallback: React.createElement("p", null, "loading") },
            React.createElement(Deferred),
          ),
        ),
      ),
    );
    const stream = renderToPipeableStream(tree, {
      onShellReady() {
        stream.pipe(destination);
        queueMicrotask(() => {
          ready = true;
          release();
        });
      },
      onError(error) {
        destination.destroy(error instanceof Error ? error : new Error(String(error)));
      },
    });
    try {
      await completed;
      const markup = Buffer.concat(chunks).toString("utf8");
      const end = markup.lastIndexOf("</html>") + 7;
      const tail = markup
        .slice(end)
        .replace(/^(?:\s*<\/div>)+/i, "")
        .trim();
      expect(tail).toContain('id="unicode-reveal"');
      const document = markup.slice(markup.indexOf("<html"), end);
      expect(extract(markup)).toBe(document.replace("</body>", () => `${tail}</body>`));
    } finally {
      stream.abort();
    }
  });
});

describe("full-document detection", () => {
  it("extracts the document from Farm's display:contents wrappers", () => {
    expect(extractFarmFullDocument(wrappedFullDocument)).toBe(
      '<html lang="en"><head><title>App</title></head><body><main>hello</main></body></html>',
    );
  });

  it("keeps React Suspense reveal payloads emitted after the document wrappers", () => {
    const reveal = '<div hidden id="S:0"><p>streamed</p></div><script>$RC("B:0","S:0")</script>';
    const markup =
      '<div style="display:contents"><html><head></head><body><template id="B:0"></template>' +
      "<p>loading</p></body></html></div>" +
      reveal;

    expect(extractFarmFullDocument(markup)).toBe(
      '<html><head></head><body><template id="B:0"></template><p>loading</p>' +
        `${reveal}</body></html>`,
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

  it("removes attributed and multiline title elements", () => {
    expect(
      removeFarmDocumentTitles(
        '<html><head><title data-source="layout">Layout\nTitle</title><meta name="x"></head></html>',
      ),
    ).toBe('<html><head><meta name="x"></head></html>');
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

  it("replaces Farm-managed document attributes without duplicating them", () => {
    const html = composeFarmFullDocument(
      '<html lang="en" dir="ltr" data-theme="light" class="app"><head></head><body></body></html>',
      {
        htmlAttributes: ' lang="ar" dir="rtl" data-theme="dark"',
        replaceHtmlAttributes: ["lang", "dir", "data-theme"],
        headAssets: "",
        bodyFooter: "",
      },
    );

    expect(html).toContain('<html class="app" lang="ar" dir="rtl" data-theme="dark">');
    expect(html.match(/\slang=/gi)).toHaveLength(1);
    expect(html.match(/\sdir=/gi)).toHaveLength(1);
    expect(html.match(/\sdata-theme=/gi)).toHaveLength(1);
  });
});
