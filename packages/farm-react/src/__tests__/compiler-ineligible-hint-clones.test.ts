// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseSync, types as t } from "@babel/core";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Load the private passes without a production export or hot-path instrumentation.
const names = [
  "rewriteKeyedMapUpdateHints",
  "rewriteKeyedArrayAppendHints",
  "rewriteKeyedArrayPrependHints",
  "rewriteKeyedArrayRollingWindowHints",
  "rewriteKeyedArrayPositionHints",
  "rewriteKeyedArrayReorderPipelineHints",
  "rewriteKeyedArrayReorderHints",
  "rewriteKeyedArraySortHints",
  "rewriteKeyedArraySliceHints",
  "rewriteKeyedArrayFilterHints",
  "rewriteKeyedCollectionUpdateHints",
] as const;
type HintResult = { root: t.JSXElement; stateIndices?: Set<number> } & Record<string, unknown>;
const source = readFileSync(new URL("../compiler.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const passes = new Function("require", "exports", `${outputText}; return {${names.join(",")}};`)(
  createRequire(import.meta.url),
  {},
) as Record<(typeof names)[number], (...args: unknown[]) => HintResult>;

function root(): t.JSXElement {
  const file = parseSync("<main><span>unchanged</span></main>", {
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ["jsx"] },
  });
  const statement = file?.program.body[0];
  if (!t.isExpressionStatement(statement) || !t.isJSXElement(statement.expression)) {
    throw new Error("Expected JSX root");
  }
  return statement.expression;
}

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

function counters(result: HintResult): number[] {
  return Object.entries(result)
    .filter(([key]) => /count$/i.test(key))
    .map(([, value]) => value as number);
}

describe.each(names)("ineligible hint pass: %s", (name) => {
  it("borrows the untouched input only when eligibility is already empty", () => {
    const input = root();
    const before = JSON.stringify(input);
    freeze(input);
    const eligibility = name === "rewriteKeyedCollectionUpdateHints" ? new Map() : new Set();
    const first = passes[name](input, eligibility);
    const second = passes[name](input, eligibility);
    expect(first.root).toBe(input);
    expect(second.root).toBe(input);
    expect(counters(first).length).toBeGreaterThan(0);
    expect(counters(first).every((count) => count === 0)).toBe(true);
    if (first.stateIndices) {
      expect(first.stateIndices.size).toBe(0);
      expect(first.stateIndices).not.toBe(second.stateIndices);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it("still owns a separate tree when entering a potentially mutating pass", () => {
    const input = root();
    const before = JSON.stringify(input);
    freeze(input);
    const result =
      name === "rewriteKeyedCollectionUpdateHints"
        ? passes[name](input, new Map([[0, "set"]]), [])
        : passes[name](input, new Set([0]), new Map());
    expect(result.root).not.toBe(input);
    expect(result.root).toEqual(t.cloneNode(input, true));
    expect(counters(result).every((count) => count === 0)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });
});
