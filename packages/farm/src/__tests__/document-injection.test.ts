// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const universalBuildSource = fs.readFileSync(
  path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
  "utf-8",
);

// The production handler is emitted from a template literal, so the snippet is
// extracted from the source and un-escaped (\\ -> \, \` -> `, \$ -> $) before
// being executed the way the emitted bundle runs it.
function extractEmittedFullDocumentInjection(): string {
  const start = universalBuildSource.indexOf("fullHtml = html\n            // Inject CSS link");
  const end = universalBuildSource.indexOf("// Add DOCTYPE if not present", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const emitted = universalBuildSource.slice(start, end).replace(/\\([\\`$])/g, "$1");
  return emitted.slice(0, emitted.lastIndexOf(";") + 1);
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

function createInjector() {
  return new Function(
    "html",
    "title",
    "metaTags",
    "rendererHead",
    "pageProps",
    "routeSlotPayload",
    "clientPageProps",
    "renderFarmClientBootstrapScript",
    "renderFarmRendererHydrationScript",
    "let fullHtml;\n" + extractEmittedFullDocumentInjection() + "\nreturn fullHtml;",
  ) as (
    html: string,
    title: string,
    metaTags: string,
    rendererHead: string,
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
});
