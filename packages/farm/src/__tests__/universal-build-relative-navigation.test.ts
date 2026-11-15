// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Exercise the expressions actually emitted for both production renderers,
// including the public shallow-history helpers, rather than a copied resolver.
const source = readFileSync(new URL("../nitro/universal-build.ts", import.meta.url), "utf8");
const expressions = [...source.matchAll(/const url = (new URL\(href[^;]+);/g)];

describe("production document-relative URLs", () => {
  it("covers navigation, prefetch and shallow history in the generated clients", () => {
    expect(expressions).toHaveLength(6);
  });

  it.each(expressions.map(([statement, expression], index) => ({ statement, expression, index })))(
    "resolves generated call site $index against the current document",
    ({ expression }) => {
      const resolve = new Function("href", "window", `return ${expression};`);
      const location = new URL("https://example.test/base/users/123?tab=profile#old");
      for (const href of [
        "?tab=settings",
        "456",
        "./456",
        "../about",
        "#details",
        "/about",
        "https://other.test/path",
        "mailto:help@example.test",
      ]) {
        expect(resolve(href, { location }).href).toBe(new URL(href, location.href).href);
      }
    },
  );
});
