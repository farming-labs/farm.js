// @vitest-environment node

import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import React from "react";
import { renderToPipeableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  classifyFarmDocumentPrefix,
  composeFarmFullDocument,
  ensureFarmDocumentHead,
  ensureFarmDocumentRoot,
  extractFarmFullDocument,
  hasFarmDocumentIcon,
  HOISTED_HEAD_ELEMENT,
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
  const generated = new Function(
    "HOISTED_HEAD_ELEMENT",
    "return `" + source.slice(start, end) + "`;",
  )(HOISTED_HEAD_ELEMENT);
  return new Function(generated + "; return extractFarmFullDocument;")();
}

// Render a full-document root layout inside Farm's boundary wrapper with real React output.
async function renderLayout(head: React.ReactNode): Promise<string> {
  const tree = React.createElement(
    "div",
    { "data-farm-layout-boundary": "true", style: { display: "contents" } },
    React.createElement(
      "html",
      { lang: "en" },
      React.createElement("head", null, head),
      React.createElement("body", null, React.createElement("main", null, "hello")),
    ),
  );
  const chunks: Buffer[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  const completed = finished(destination);
  const stream = renderToPipeableStream(tree, {
    onAllReady() {
      stream.pipe(destination);
    },
    onError(error) {
      destination.destroy(error instanceof Error ? error : new Error(String(error)));
    },
  });
  await completed;
  return Buffer.concat(chunks).toString("utf8");
}

function productionEnsureHead(): typeof ensureFarmDocumentHead {
  const source = readFileSync(new URL("../nitro/universal-build.ts", import.meta.url), "utf8");
  const start = source.indexOf("function ensureFarmDocumentHead(markup)");
  const end = source.indexOf("function createFarmErrorDocument(html, title)", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const generated = new Function("return `" + source.slice(start, end) + "`;")();
  return new Function(generated + "; return ensureFarmDocumentHead;")();
}

function productionEnsureRoot(): typeof ensureFarmDocumentRoot {
  const source = readFileSync(new URL("../nitro/universal-build.ts", import.meta.url), "utf8");
  const start = source.indexOf("function ensureFarmDocumentRoot(markup)");
  const end = source.indexOf("function createFarmErrorDocument(html, title)", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const generated = new Function("return `" + source.slice(start, end) + "`;")();
  return new Function(generated + "; return ensureFarmDocumentRoot;")();
}

function productionHasIcon(): typeof hasFarmDocumentIcon {
  const source = readFileSync(new URL("../nitro/universal-build.ts", import.meta.url), "utf8");
  const start = source.indexOf("function hasFarmDocumentIcon(markup)");
  const end = source.indexOf("function addFarmFallbackIcon(markup, hasFavicon)", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const generated = new Function("return `" + source.slice(start, end) + "`;")();
  return new Function(generated + "; return hasFarmDocumentIcon;")();
}

describe.each([
  ["development", hasFarmDocumentIcon],
  ["production", productionHasIcon()],
] as const)("%s document icon detection", (_runtime, hasIcon) => {
  it.each([
    '<link rel="icon" href="/favicon.svg">',
    "<link href='/x.ico' rel='shortcut icon'>",
    '<LINK REL="icon" HREF="data:,">',
    "<link rel=icon href=/a.png>",
  ])("finds %s", (link) => {
    expect(hasIcon(`<html><head>${link}</head><body></body></html>`)).toBe(true);
  });

  it.each([
    '<link rel="apple-touch-icon" href="/a.png">',
    '<link rel="stylesheet" href="/icon.css">',
    "<html><head></head><body></body></html>",
  ])("ignores %s", (markup) => {
    expect(hasIcon(markup)).toBe(false);
  });
});

describe.each([
  ["development", ensureFarmDocumentRoot],
  ["production", productionEnsureRoot()],
] as const)("%s document root", (_runtime, ensureRoot) => {
  it("wraps the body's content in #root, keeping body attributes", () => {
    expect(
      ensureRoot('<html><head></head><body class="app"><nav>n</nav><main>m</main></body></html>'),
    ).toBe(
      '<html><head></head><body class="app"><div id="root"><nav>n</nav><main>m</main></div></body></html>',
    );
  });

  it("wraps the body even when page content has id=root", () => {
    const document =
      '<html><head></head><body><nav>n</nav><main><h3 id="root"><a href="#root">Root</a></h3></main></body></html>';
    const wrapped = ensureRoot(document);
    expect(wrapped).toContain('<body><div id="root"><nav>n</nav>');
    expect(wrapped).toContain('<h3 id="root">');
    expect(wrapped.endsWith("</main></div></body></html>")).toBe(true);
  });

  it("leaves a document that already has #root unchanged", () => {
    const document = '<html><head></head><body><div id="root"><main>m</main></div></body></html>';
    expect(ensureRoot(document)).toBe(document);
  });

  it("keeps $-sequences in the content literal", () => {
    expect(ensureRoot("<html><body>$&amp; $' $$</body></html>")).toBe(
      '<html><body><div id="root">$&amp; $\' $$</div></body></html>',
    );
  });
});

describe.each([
  ["development", ensureFarmDocumentHead],
  ["production", productionEnsureHead()],
] as const)("%s document head", (_runtime, ensureHead) => {
  it("adds an empty head right after <html> when the document has none", () => {
    expect(ensureHead('<html lang="en"><body><main>hi</main></body></html>')).toBe(
      '<html lang="en"><head></head><body><main>hi</main></body></html>',
    );
  });

  it("does not mistake <header> for a head", () => {
    expect(ensureHead("<HTML><body><header>nav</header></body></HTML>")).toBe(
      "<html><head></head><body><header>nav</header></body></HTML>",
    );
  });

  it("leaves documents that already have a head unchanged", () => {
    for (const document of [
      "<html><head></head><body></body></html>",
      '<html><HEAD data-x="1"><title>t</title></HEAD><body></body></html>',
    ]) {
      expect(ensureHead(document)).toBe(document);
    }
  });
});

describe.each([
  ["development", extractFarmFullDocument],
  ["production", productionExtractor()],
] as const)("%s full-document wrapper styles", (_runtime, extract) => {
  it("extracts the document from wrappers Preact serializes with a trailing semicolon", () => {
    const document = '<html lang="en"><head></head><body><main>hello</main></body></html>';
    expect(
      extract(
        '<div data-farm-layout-boundary="true" data-farm-layout-pattern="/" ' +
          `style="display:contents;">${document}</div>`,
      ),
    ).toBe(document);
  });
});

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

  it("finds a wrapped document behind the head elements React hoists ahead of it", async () => {
    // A create-app style root layout: its own document, with charset and viewport metas.
    const tree = React.createElement(
      "div",
      { "data-farm-layout-boundary": "true", style: { display: "contents" } },
      React.createElement(
        "html",
        { lang: "en" },
        React.createElement(
          "head",
          null,
          React.createElement("meta", { charSet: "utf-8" }),
          React.createElement("meta", { name: "viewport", content: "width=device-width" }),
          React.createElement("script", { dangerouslySetInnerHTML: { __html: "boot()" } }),
        ),
        React.createElement("body", null, React.createElement("main", null, "hello")),
      ),
    );
    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    const completed = finished(destination);
    const stream = renderToPipeableStream(tree, {
      onAllReady() {
        stream.pipe(destination);
      },
      onError(error) {
        destination.destroy(error instanceof Error ? error : new Error(String(error)));
      },
    });
    await completed;
    const markup = Buffer.concat(chunks).toString("utf8");

    // React writes the metas before Farm's wrapper, not inside the layout's <head>.
    expect(markup.indexOf("<meta")).toBeLessThan(markup.indexOf("<div"));
    expect(extract(markup)).toBe(
      '<html lang="en"><head><meta charSet="utf-8"/>' +
        '<meta name="viewport" content="width=device-width"/><script>boot()</script></head>' +
        "<body><main>hello</main></body></html>",
    );
  });

  it.each([
    [
      "an async script",
      React.createElement("script", { async: true, src: "https://analytics.example/a.js" }),
      '<script async="" src="https://analytics.example/a.js"></script>',
    ],
    [
      "a precedence style",
      React.createElement(
        "style",
        { href: "theme", precedence: "default" },
        "body{color:red}main>p{margin:0}",
      ),
      '<style data-precedence="default" data-href="theme">body{color:red}main>p{margin:0}</style>',
    ],
    [
      "a charset meta and title",
      [
        React.createElement("meta", { key: "c", charSet: "utf-8" }),
        React.createElement("title", { key: "t" }, "App"),
      ],
      '<meta charSet="utf-8"/><title>App</title>',
    ],
  ])(
    "finds a wrapped document behind %s React hoists ahead of it",
    async (_name, head, hoisted) => {
      const markup = await renderLayout(head);
      // React writes the element before Farm's wrapper, not inside the layout's <head>.
      expect(markup.startsWith(hoisted)).toBe(true);
      expect(extract(markup)).toBe(
        `<html lang="en"><head>${hoisted}</head><body><main>hello</main></body></html>`,
      );
    },
  );

  it("returns hoisted elements to a document that renders no <head>", () => {
    expect(
      extract(
        '<link rel="preload" as="image" href="/a.png"/><div style="display:contents">' +
          "<html><body>x</body></html></div>",
      ),
    ).toBe(
      '<html><head><link rel="preload" as="image" href="/a.png"/></head><body>x</body></html>',
    );
  });

  it("does not take a fragment layout that starts with head elements for a document", () => {
    expect(
      extract('<meta charSet="utf-8"/><div style="display:contents"><main>x</main></div>'),
    ).toBeNull();
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

  it("waits past a first chunk that holds only wrappers and hoisted head elements", () => {
    const hoisted = '<meta charSet="utf-8"/><meta name="viewport" content="width=device-width"/>';
    expect(classifyFarmDocumentPrefix(hoisted)).toBe("pending");
    expect(classifyFarmDocumentPrefix(`${hoisted}<div style="display:contents">`)).toBe("pending");
    expect(
      classifyFarmDocumentPrefix(`${hoisted}<div style="display:contents"><html lang="en">`),
    ).toBe("document");
    expect(classifyFarmDocumentPrefix(`${hoisted}${fragmentMarkup}`)).toBe("fragment");
  });

  it("classifies a layout whose async scripts and precedence styles React hoisted", async () => {
    const markup = await renderLayout([
      React.createElement("meta", { key: "c", charSet: "utf-8" }),
      React.createElement("title", { key: "t" }, "App"),
      React.createElement("script", { key: "s", async: true, src: "/analytics.js" }),
      React.createElement("style", { key: "p", href: "theme", precedence: "high" }, "a{}"),
    ]);
    const hoisted = markup.slice(0, markup.indexOf("<div"));
    expect(hoisted).toContain("<script async");
    expect(hoisted).toContain("data-precedence");
    expect(classifyFarmDocumentPrefix(hoisted)).toBe("pending");
    expect(classifyFarmDocumentPrefix(markup)).toBe("document");
    expect(opensFarmFullDocument(markup)).toBe(true);
  });

  it("still treats an inline script or unhoisted style ahead of a layout as a fragment", () => {
    expect(classifyFarmDocumentPrefix(`<script>boot()</script>${fragmentMarkup}`)).toBe("fragment");
    expect(classifyFarmDocumentPrefix(`<style>a{}</style>${fragmentMarkup}`)).toBe("fragment");
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

  it("keeps Farm's head assets when the layout renders no <head>", () => {
    // <head> is optional; without one the client props and runtime were dropped
    // and the page never hydrated in development.
    const html = composeFarmFullDocument(
      '<html lang="en"><body><header>nav</header><main>hi</main></body></html>',
      {
        headAssets: "<script>window.__FARM_PROPS__ = {};</script>",
        bodyFooter: '<script type="module" src="/@farm/client.js"></script>',
      },
    );

    expect(html.match(/<head[\s>]/gi)).toHaveLength(1);
    expect(html.indexOf("<head>")).toBeLessThan(html.indexOf("window.__FARM_PROPS__"));
    expect(html.indexOf("window.__FARM_PROPS__")).toBeLessThan(html.indexOf("</head>"));
    expect(html.indexOf("</head>")).toBeLessThan(html.indexOf("<body"));
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<header>nav</header>");
  });

  it("adds a fallback icon only when the document links none", () => {
    const bare = composeFarmFullDocument("<html><head></head><body></body></html>", {
      headAssets: "",
      bodyFooter: "",
      fallbackIcon: true,
    });
    expect(bare).toContain('<link rel="icon" href="data:,">');

    const withIcon = composeFarmFullDocument(
      '<html><head><link rel="icon" href="/favicon.svg"></head><body></body></html>',
      { headAssets: "", bodyFooter: "", fallbackIcon: true },
    );
    expect(withIcon).not.toContain("data:,");

    const notRequested = composeFarmFullDocument("<html><head></head><body></body></html>", {
      headAssets: "",
      bodyFooter: "",
    });
    expect(notRequested).not.toContain("data:,");
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
