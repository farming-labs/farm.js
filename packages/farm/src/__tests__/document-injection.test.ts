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

describe("generated full-document injection", () => {
  it("keeps $-sequences in page props literal when injecting the bootstrap script", () => {
    const inject = new Function(
      "html",
      "title",
      "metaTags",
      "pageProps",
      "routeSlotPayload",
      "clientPageProps",
      "renderFarmClientBootstrapScript",
      "renderFarmRendererHydrationScript",
      "let fullHtml;\n" + extractEmittedFullDocumentInjection() + "\nreturn fullHtml;",
    );

    const clientPageProps = { note: "totals: $$ then $& then $' then $`" };
    const fullHtml = inject(
      "<html><head><title>App</title></head><body><main>page</main></body></html>",
      "Farm.js App",
      "",
      { __farmCanonicalPath: "/notes" },
      [],
      clientPageProps,
      renderFarmClientBootstrapScript,
      () => "",
    ) as string;

    // A string replacement would expand $& into </body> and $' into the rest of
    // the document, corrupting window.__FARM_PROPS__ and duplicating markup.
    expect(fullHtml).toContain(serializeFarmInlineValue(clientPageProps));
    expect(fullHtml.match(/<\/body>/gi)).toHaveLength(1);
    expect(fullHtml.match(/<\/html>/gi)).toHaveLength(1);
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
