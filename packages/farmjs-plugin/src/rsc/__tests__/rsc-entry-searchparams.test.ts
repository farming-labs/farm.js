import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entrySource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../entries/rsc.ts"),
  "utf8",
);
const fallbackSource = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.ts"),
  "utf8",
);

describe("RSC entry search params", () => {
  it("builds searchParams with the shared array-aware helper", () => {
    // Object.fromEntries keeps only the last value of a repeated key, so
    // ?tag=a&tag=b reached RSC pages as { tag: "b" } while every other
    // environment delivers { tag: ["a", "b"] }.
    expect(entrySource).toContain(
      "import { _runWithAPIRequestRuntime, _runWithCurrentRequest, searchParamsToObject } from '@farm.js/core/internal/production-runtime';",
    );
    expect(entrySource).toContain("const searchParams = searchParamsToObject(url.searchParams);");
    expect(entrySource).toContain(
      "const errSearchParams = searchParamsToObject(url.searchParams);",
    );
    expect(entrySource).not.toContain("Object.fromEntries(url.searchParams)");
  });

  it("has no legacy development renderer that could flatten repeated values", () => {
    // A failed RSC render used to fall back to a page-guessing SSR renderer.
    // It now answers with the error page, so every page goes through the entry.
    expect(fallbackSource).not.toContain("fall back to legacy SSR");
    expect(fallbackSource).toContain(
      "res.end(createRscDevErrorDocument(rscError, method, pathname))",
    );
    expect(fallbackSource).not.toContain(
      'Object.fromEntries(new URLSearchParams(url.split("?")[1] || ""))',
    );
  });
});
