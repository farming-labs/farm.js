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
      "import { _runWithCurrentRequest, searchParamsToObject } from '@farm.js/core/internal/production-runtime';",
    );
    expect(entrySource).toContain("const searchParams = searchParamsToObject(url.searchParams);");
    expect(entrySource).toContain(
      "const errSearchParams = searchParamsToObject(url.searchParams);",
    );
    expect(entrySource).not.toContain("Object.fromEntries(url.searchParams)");
  });

  it("keeps repeated values in the legacy development fallback", () => {
    expect(fallbackSource).toContain("const { searchParamsToObject } = require_(");
    expect(fallbackSource).toContain('"@farm.js/core/internal/production-runtime"');
    expect(fallbackSource).toContain("const searchParams = searchParamsToObject(");
    expect(fallbackSource).not.toContain(
      'Object.fromEntries(new URLSearchParams(url.split("?")[1] || ""))',
    );
  });
});
