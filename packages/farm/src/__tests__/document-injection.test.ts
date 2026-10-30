// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderViewportHead } from "../metadata";
import {
  ensureFarmDocumentHead,
  ensureFarmDocumentMeta,
  ensureFarmDocumentRoot,
  extractFarmFullDocument,
} from "../server/full-document";

const universalBuildSource = fs.readFileSync(
  path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
  "utf-8",
);

// The production handler is emitted from a template literal, so the snippet is
// extracted from the source and un-escaped (\\ -> \, \` -> `, \$ -> $) before
// being executed the way the emitted bundle runs it: the shared full-document
// composer, then the buffered response's footer injection.
function extractEmittedFullDocumentInjection(): string {
  const composeStart = universalBuildSource.indexOf(
    "const composeFarmFullDocument = function(markup) {",
  );
  const composeEnd = universalBuildSource.indexOf("\n        };\n", composeStart);
  const injectStart = universalBuildSource.indexOf(
    "fullHtml = composeFarmFullDocument(extractFarmFullDocument(html) || html)",
  );
  const injectEnd = universalBuildSource.indexOf("\n            );\n", injectStart);
  expect(composeStart).toBeGreaterThan(-1);
  expect(composeEnd).toBeGreaterThan(composeStart);
  expect(injectStart).toBeGreaterThan(composeEnd);
  expect(injectEnd).toBeGreaterThan(injectStart);
  const emitted =
    universalBuildSource.slice(composeStart, composeEnd + "\n        };".length) +
    "\n" +
    universalBuildSource.slice(injectStart, injectEnd + "\n            );".length);
  return emitted.replace(/\\([\\`$])/g, "$1");
}

function serializeFarmInlineValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function renderFarmClientBootstrapScript(
  _canonicalPath?: string,
  selectedRouteSlots?: unknown[],
  pageProps?: Record<string, unknown>,
): string {
  return (
    '<script id="__farm_route_slots_data__" type="application/json">' +
    serializeFarmInlineValue(selectedRouteSlots || []) +
    "</script><script>window.__FARM_PROPS__=" +
    serializeFarmInlineValue(pageProps || {}) +
    ";</script>"
  );
}

function renderFarmClientEntryScript(): string {
  return '<script type="module" src="/__farm_client_js_src__"></script>';
}

const MODULE_PRELOAD_TAGS =
  '\n  <link rel="modulepreload" href="/chunks/react-h1.js" fetchpriority="low">';

function createInjector(viewportTags = renderViewportHead(undefined)) {
  const inject = new Function(
    "html",
    "title",
    "metaTags",
    "rendererHead",
    "rendererHasTitle",
    "renderedMetadata",
    "pageProps",
    "routeSlotPayload",
    "clientPageProps",
    "renderFarmClientBootstrapScript",
    "renderFarmRendererHydrationScript",
    "ensureFarmDocumentMeta",
    "viewportTags",
    "renderFarmClientEntryScript",
    "renderFarmClientModulePreloads",
    "route",
    "extractFarmFullDocument",
    "ensureFarmDocumentHead",
    "ensureFarmDocumentRoot",
    "addFarmFallbackIcon",
    "hasFavicon",
    "let fullHtml;\n" + extractEmittedFullDocumentInjection() + "\nreturn fullHtml;",
  );
  return ((...args: unknown[]) =>
    inject(
      ...args,
      ensureFarmDocumentMeta,
      viewportTags,
      renderFarmClientEntryScript,
      () => MODULE_PRELOAD_TAGS,
      { clientModule: undefined },
      extractFarmFullDocument,
      ensureFarmDocumentHead,
      ensureFarmDocumentRoot,
      (markup: string) => markup,
      true,
    )) as (
    html: string,
    title: string,
    metaTags: string,
    rendererHead: string,
    rendererHasTitle: boolean,
    renderedMetadata: { hasExplicitTitle: boolean },
    pageProps: Record<string, unknown>,
    routeSlotPayload: unknown[],
    clientPageProps: Record<string, unknown>,
    bootstrap: typeof renderFarmClientBootstrapScript,
    hydration: () => string,
  ) => string;
}

describe("generated full-document injection", () => {
  it("keeps $-sequences in page props literal when injecting the bootstrap script", () => {
    const inject = createInjector();

    const clientPageProps = { note: "totals: $$ then $& then $' then $`" };
    const fullHtml = inject(
      "<html><head><title>App</title></head><body><main>page</main></body></html>",
      "Farm.js App",
      "",
      "",
      false,
      { hasExplicitTitle: false },
      { __farmCanonicalPath: "/notes" },
      [],
      clientPageProps,
      renderFarmClientBootstrapScript,
      () => "",
    );

    // A string replacement would expand $& into </body> and $' into the rest of
    // the document, corrupting window.__FARM_PROPS__ and duplicating markup.
    expect(fullHtml).toContain(serializeFarmInlineValue(clientPageProps));
    expect(fullHtml.match(/<\/body>/gi)).toHaveLength(1);
    expect(fullHtml.match(/<\/html>/gi)).toHaveLength(1);
  });

  it("injects renderer-emitted head markup literally into the document head", () => {
    const inject = createInjector();

    // Svelte-style head payload with hydration markers and hostile
    // $-sequences; a string replacement would expand them into markup.
    const rendererHead = "<!--farm-head--><title>Docs $& $' page</title>";
    const fullHtml = inject(
      '<html><head><meta charset="utf-8"></head><body><main>page</main></body></html>',
      "Farm.js App",
      "",
      rendererHead,
      true,
      { hasExplicitTitle: false },
      { __farmCanonicalPath: "/docs" },
      [],
      {},
      renderFarmClientBootstrapScript,
      () => "",
    );

    const headEnd = fullHtml.indexOf("</head>");
    expect(fullHtml.indexOf(rendererHead)).toBeGreaterThan(-1);
    expect(fullHtml.indexOf(rendererHead)).toBeLessThan(headEnd);
    expect(fullHtml.split(rendererHead)).toHaveLength(2);
  });

  it("lets explicit metadata replace layout and renderer titles", () => {
    const inject = createInjector();
    const fullHtml = inject(
      '<html><head><title data-source="layout">Layout</title></head><body></body></html>',
      "Product details",
      "",
      "<title>Renderer title</title><meta name=renderer>",
      true,
      { hasExplicitTitle: true },
      {},
      [],
      {},
      renderFarmClientBootstrapScript,
      () => "",
    );

    expect(fullHtml.match(/<title[\s>]/gi)).toHaveLength(1);
    expect(fullHtml).toContain("<title>Product details</title>");
    expect(fullHtml).not.toContain("Layout</title>");
    expect(fullHtml).not.toContain("Renderer title</title>");
    expect(fullHtml).toContain("<meta name=renderer>");
  });

  it("lets a renderer title replace a compatibility-layout title", () => {
    const inject = createInjector();
    const fullHtml = inject(
      "<html><head><title>Layout title</title></head><body></body></html>",
      "Farm.js App",
      "",
      "<title>Renderer title</title>",
      true,
      { hasExplicitTitle: false },
      {},
      [],
      {},
      renderFarmClientBootstrapScript,
      () => "",
    );

    expect(fullHtml.match(/<title[\s>]/gi)).toHaveLength(1);
    expect(fullHtml).toContain("<title>Renderer title</title>");
    expect(fullHtml).not.toContain("Layout title</title>");
  });

  it("never passes dynamic markup as a string replacement in the generated document pipeline", () => {
    // String replacements interpret $&, $', $` and $$ in the replacement text,
    // so every dynamically built replacement must go through a function.
    const stringReplacementWithDynamicMarkup =
      /\.replace\(\s*\/[^\n]*\/i,\s*(?:'[^']*'\s*\+\s*)?(?:renderFarmClientBootstrapScript|renderFarmRendererHydrationScript)\(/g;
    expect(universalBuildSource.match(stringReplacementWithDynamicMarkup)).toBeNull();
    expect(universalBuildSource).not.toContain("'<head$1>' + runtimeMarkup");
    expect(universalBuildSource).not.toContain(
      `"<body" + bodyMatch[1] + ">" + rootMarkup + "</body>",`,
    );
    expect(universalBuildSource).toContain(
      `() => '<html lang="en"' + farmThemeDocument.attributes + '>'`,
    );
  });

  it("opens a layout's document head with the charset and the route's viewport", () => {
    const viewport = renderViewportHead({ maximumScale: 1, themeColor: "#fff" });
    const fullHtml = createInjector(viewport)(
      "<html><head><title>App</title></head><body><main>page</main></body></html>",
      "Farm.js App",
      "",
      "",
      false,
      { hasExplicitTitle: false },
      {},
      [],
      {},
      renderFarmClientBootstrapScript,
      () => "",
    );

    const head = fullHtml.slice(fullHtml.indexOf("<head>"), fullHtml.indexOf("</head>"));
    expect(head.startsWith('<head><meta charset="utf-8">')).toBe(true);
    expect(head).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" data-farm-metadata>',
    );
    expect(head).toContain('<meta name="theme-color" content="#fff" data-farm-metadata>');
    // The client entry's module preloads follow the stylesheet in the layout's own head.
    expect(head).toContain(
      '<link rel="stylesheet" href="/__farm_client_css_href__">' + MODULE_PRELOAD_TAGS,
    );
  });

  it("keeps the charset and viewport a layout's document writes itself", () => {
    const fullHtml = createInjector()(
      '<html><head><meta charSet="utf-8"/><meta name="viewport" content="width=500"/></head>' +
        "<body><main>page</main></body></html>",
      "Farm.js App",
      "",
      "",
      false,
      { hasExplicitTitle: false },
      {},
      [],
      {},
      renderFarmClientBootstrapScript,
      () => "",
    );

    expect(fullHtml.match(/<meta\b[^>]*charset/gi)).toHaveLength(1);
    expect(fullHtml.match(/name="viewport"/g)).toHaveLength(1);
    expect(fullHtml).toContain('content="width=500"');
  });
});
