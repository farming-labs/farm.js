import { describe, expect, it } from "vitest";
import { restoreDynamicImports } from "../../scripts/restore-cjs-dynamic-imports";

describe("restoreDynamicImports", () => {
  it("turns sucrase's converted dynamic imports back into import()", () => {
    const converted = [
      'const vite = await Promise.resolve().then(() => _interopRequireWildcard(require("vite")));',
      "const config = await Promise.resolve().then(() => _interopRequireWildcard2(require(`${pathToFileURL(file).href}?t=${Date.now()}`)));",
    ].join("\n");

    expect(restoreDynamicImports(converted)).toBe(
      [
        'const vite = await import("vite");',
        "const config = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);",
      ].join("\n"),
    );
  });

  it("keeps nested calls, parentheses inside strings, and nested template literals intact", () => {
    const converted =
      'load(Promise.resolve().then(() => _interopRequireWildcard(require(resolve(dir, ")", `a${`b${c("(")}`}`)))));';

    expect(restoreDynamicImports(converted)).toBe(
      'load(import(resolve(dir, ")", `a${`b${c("(")}`}`)));',
    );
  });

  it("leaves code without converted imports unchanged", () => {
    const code = 'const fs = require("node:fs");\nconst later = () => import("./chunk.cjs");';
    expect(restoreDynamicImports(code)).toBe(code);
  });

  it("refuses a shape it does not recognize instead of guessing", () => {
    expect(() =>
      restoreDynamicImports(
        "Promise.resolve().then(() => _interopRequireWildcard(require(x)) + 1);",
      ),
    ).toThrow("Unrecognized converted dynamic import");
  });
});
