// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseSync, types as t } from "@babel/core";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const map = "setRows(rows => mapUpdate(rows, (value, apply) => apply(value)));";
const filter = "setRows(rows => { return filterRows(rows); });";
const reorder = "setRows(rows => reorderRows(rows));";
const reorderHelpers = [
  "mapUpdate",
  "queuedMap",
  "mapReorder",
  "reorderRows",
  "sortRows",
  "structuralReorder",
  "structuralSort",
];
const cases = [
  {
    name: "rewriteQueuedKeyedArrayReorderMapHints",
    helpers: reorderHelpers,
    statements: reorder + map,
  },
  {
    name: "rewriteQueuedKeyedArrayMappedStructuralHints",
    helpers: ["mapUpdate", "queuedMap", "mappedStructural", "filterRows", "sliceRows"],
    statements: map + filter,
  },
  {
    name: "rewriteQueuedKeyedArrayStructuralMapHints",
    helpers: [
      "mapUpdate",
      "mapPipeline",
      "appendRows",
      "mappedAppend",
      "appendMap",
      "filterRows",
      "sliceRows",
      "mappedStructural",
    ],
    statements: filter + "setRows(rows => appendRows(rows, item));" + map,
  },
  {
    name: "rewriteQueuedKeyedArrayStructuralPrependMapHints",
    helpers: [
      "mapUpdate",
      "mapPipeline",
      "prependRows",
      "mappedPrepend",
      "prependMap",
      "filterRows",
      "sliceRows",
      "mappedStructural",
    ],
    statements: filter + "setRows(rows => prependRows(rows, item));" + map,
  },
  {
    name: "rewriteQueuedKeyedArrayRollingWindowMapHints",
    helpers: [
      "mapUpdate",
      "mapPipeline",
      "queuedMap",
      "rollingMap",
      "mappedRolling",
      "rollingRows",
      "appendRows",
      "mappedAppend",
      "appendMap",
      "mappedStructural",
    ],
    statements: map + "setRows(rows => { return rollingRows(rows, retained, item); });",
  },
  {
    name: "rewriteQueuedKeyedArrayStructuralReorderHints",
    helpers: [
      "filterRows",
      "sliceRows",
      "mapPipeline",
      "queuedMap",
      "mappedStructural",
      "mapReorder",
      "reorderRows",
      "sortRows",
      "structuralReorder",
      "structuralSort",
    ],
    statements: filter + reorder,
  },
  {
    name: "rewriteQueuedKeyedArrayMapReorderHints",
    helpers: reorderHelpers,
    statements: map + reorder,
  },
] as const;
type Case = (typeof cases)[number];
type Result = { root: t.JSXElement; stateIndices?: Set<number> } & Record<string, unknown>;

// Exercise the actual private passes without production exports or instrumentation.
const source = readFileSync(new URL("../compiler.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const passes = new Function(
  "require",
  "exports",
  `${outputText}; return {${cases.map(({ name }) => name).join(",")}};`,
)(createRequire(import.meta.url), {}) as Record<Case["name"], (...args: unknown[]) => Result>;

function run(testCase: Case, root: t.JSXElement, allowed: boolean): Result {
  return passes[testCase.name](
    root,
    new Map([["setRows", { index: 0 }]]),
    ...testCase.helpers.map((name) => t.identifier(name)),
    allowed,
  );
}

function root(statements = ""): t.JSXElement {
  const file = parseSync(`<main onClick={() => { ${statements} }}><span>unchanged</span></main>`, {
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

function counts(result: Result): number[] {
  return Object.entries(result)
    .filter(([key]) => /count$/i.test(key))
    .map(([, value]) => value as number);
}

function expectOwnedTree(output: t.JSXElement, input: t.JSXElement): void {
  const inputNodes = new Set<t.Node>();
  t.traverseFast(input, (node) => {
    inputNodes.add(node);
  });
  t.traverseFast(output, (node) => {
    expect(inputNodes.has(node)).toBe(false);
  });
}

describe.each(cases)("disabled queued hint pass: $name", (testCase) => {
  it.each([false, true])("borrows an untouched tree with matching syntax: %s", (matching) => {
    const input = root(matching ? testCase.statements : "");
    const before = JSON.stringify(input);
    freeze(input);
    const first = run(testCase, input, false);
    const second = run(testCase, input, false);
    expect(first.root).toBe(input);
    expect(second.root).toBe(input);
    expect(counts(first).length).toBeGreaterThan(0);
    expect(counts(first).every((count) => count === 0)).toBe(true);
    if (first.stateIndices) {
      expect(first.stateIndices.size).toBe(0);
      expect(first.stateIndices).not.toBe(second.stateIndices);
      first.stateIndices.add(7);
      expect(second.stateIndices?.size).toBe(0);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it("still owns every node when enabled but no rewrite is found", () => {
    const input = root();
    const before = JSON.stringify(input);
    freeze(input);
    const result = run(testCase, input, true);
    expectOwnedTree(result.root, input);
    expect(result.root).toEqual(t.cloneNode(input, true));
    expect(counts(result).every((count) => count === 0)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("can rewrite a borrowed disabled result without mutating its input", () => {
    const input = root(testCase.statements);
    const before = JSON.stringify(input);
    freeze(input);
    const borrowed = run(testCase, input, false);
    const result = run(testCase, borrowed.root, true);
    expectOwnedTree(result.root, input);
    expect(counts(result).some((count) => count > 0)).toBe(true);
    expect(result.root).not.toEqual(t.cloneNode(input, true));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("queued map/reorder pass composition", () => {
  it.each([false, true])(
    "preserves the first result when the chained passes are enabled: %s",
    (allowed) => {
      const mapReorder = cases.find(
        ({ name }) => name === "rewriteQueuedKeyedArrayMapReorderHints",
      )!;
      const reorderMap = cases[0];
      const input = root(map + reorder + map);
      const before = JSON.stringify(input);
      freeze(input);
      const first = run(mapReorder, input, allowed);
      const firstBefore = JSON.stringify(first.root);
      freeze(first.root);
      const second = run(reorderMap, first.root, allowed);
      if (allowed) {
        expect(first.mapCount).toBe(1);
        expect(first.mapReorderCount).toBe(1);
        expect(second.mapCount).toBe(1);
        expectOwnedTree(second.root, first.root);
      } else {
        expect(first.root).toBe(input);
        expect(second.root).toBe(input);
        expect([...counts(first), ...counts(second)].every((count) => count === 0)).toBe(true);
      }
      expect(JSON.stringify(input)).toBe(before);
      expect(JSON.stringify(first.root)).toBe(firstBefore);
    },
  );
});
