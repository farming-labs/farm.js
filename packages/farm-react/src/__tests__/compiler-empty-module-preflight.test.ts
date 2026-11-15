// @vitest-environment node

import { parseSync, transformAsync, traverse, type NodePath } from "@babel/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const id = "/app/EmptyCandidates.tsx";
const fixtures = [
  "",
  "export const value = 1;",
  "export function helper(value: number) { return value * 2; }",
  'export const element = <svg><a href="/">link</a><foreignObject><div /></foreignObject></svg>;',
  "export default () => <div />;",
  "export function helper() { function Nested() { return <div />; } return Nested; }",
  "export interface Props { value: number }; export type Value = Props['value'];",
];

function helperRequests() {
  const ast = parseSync("const value = 1", { configFile: false, babelrc: false });
  if (!ast) throw new Error("Expected parsed scope");
  let scope: NodePath["scope"] | undefined;
  traverse(ast, {
    Program(path) {
      scope = path.scope;
    },
  });
  if (!scope) throw new Error("Expected program scope");
  return vi.spyOn(Object.getPrototypeOf(scope), "generateUidIdentifier");
}

afterEach(() => vi.restoreAllMocks());

describe.each(["static", "hybrid"] as const)("empty candidate preflight (%s)", (reactivity) => {
  describe.each(["infer", "annotation"] as const)("mode=%s", (mode) => {
    it.each(fixtures)(
      "preserves code and maps without reserving helper names: %s",
      async (source) => {
        const reference = await transformAsync(source, {
          filename: id,
          sourceType: "module",
          ast: false,
          code: true,
          sourceMaps: true,
          sourceFileName: id,
          configFile: false,
          babelrc: false,
          parserOpts: { plugins: ["jsx", "typescript"] },
          generatorOpts: { comments: true, compact: false },
        });
        const requests = helperRequests();
        const result = await compileReactModule(
          source,
          id,
          normalizeReactCompilerOptions({ mode, reactivity }),
        );
        expect(requests).not.toHaveBeenCalled();
        expect(result.compiled).toEqual([]);
        expect(result.diagnostics).toEqual([]);
        expect(result.code).toBe(reference?.code || source);
        expect(result.map).toEqual(reference?.map || null);
        expect(Object.values(result.optimizations).every((value) => value === 0)).toBe(true);
      },
    );
  });
});

it("still analyzes selected components and preserves unsupported diagnostics in mixed modules", async () => {
  const requests = helperRequests();
  const result = await compileReactModule(
    `
    import { useState, useEffect } from "react";
    export const value = 1;
    export function Counter() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>{count}</button>; }
    export function Unsupported() { useEffect(() => {}, []); return <div />; }
  `,
    id,
    normalizeReactCompilerOptions({ reactivity: "hybrid" }),
  );
  expect(requests).toHaveBeenCalled();
  expect(result.compiled).toEqual(["Counter"]);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0].component).toBe("Unsupported");
  expect(result.code).toContain("createCompiledComponent");
});

it.each([
  ['export function View() { "use no compiler"; return <div />; }', "infer"],
  ["export function View() { return <div />; }", "annotation"],
] as const)("skips helper setup for a present but unselected candidate", async (source, mode) => {
  const requests = helperRequests();
  const result = await compileReactModule(source, id, normalizeReactCompilerOptions({ mode }));
  expect(requests).not.toHaveBeenCalled();
  expect(result.compiled).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

const unselected = [
  { source: 'export default function View() { "use no compiler"; return <div />; }' },
  { source: 'export const View = () => { "use no compiler"; return <div />; };' },
  { source: 'export const View = function () { "use no compiler"; return <div />; };' },
  {
    source:
      '"use compiler"; export function View() { "use compiler"; "use no compiler"; return <svg><a /></svg>; }',
    mode: "annotation",
  },
  { source: "export const View = () => <div />;", mode: "annotation" },
  { source: "export const View = function () { return <div />; };", mode: "annotation" },
  {
    source:
      'export function View() { function Inner() { "use compiler"; return <p />; } return <Inner />; }',
    mode: "annotation",
  },
  {
    source:
      'export const First = () => <div />, Second = () => { "use no compiler"; return <svg />; };',
    mode: "annotation",
  },
  {
    source:
      'export function View() { const value = 1; "use compiler"; return <div>{value}</div>; }',
    mode: "annotation",
  },
  {
    source: '"use compiler"; export function View() { return <div />; }',
    mode: "annotation",
    directive: "use optimized",
  },
  {
    source:
      '"use optimized"; export function View() { "use no compiler"; return <math><mi>x</mi></math>; }',
    mode: "annotation",
    directive: "use optimized",
  },
] satisfies Array<{
  source: string;
  mode?: "infer" | "annotation";
  directive?: string;
}>;

describe.each(["static", "hybrid"] as const)("unselected preflight (%s)", (reactivity) => {
  it.each(unselected)("keeps Babel output and maps without helper setup: $source", async (test) => {
    const reference = await transformAsync(test.source, {
      filename: id,
      sourceType: "module",
      ast: false,
      code: true,
      sourceMaps: true,
      sourceFileName: id,
      configFile: false,
      babelrc: false,
      parserOpts: { plugins: ["jsx", "typescript"] },
      generatorOpts: { comments: true, compact: false },
    });
    const requests = helperRequests();
    const result = await compileReactModule(
      test.source,
      id,
      normalizeReactCompilerOptions({ mode: test.mode, directive: test.directive, reactivity }),
    );
    expect(requests).not.toHaveBeenCalled();
    expect(result.compiled).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(Object.values(result.optimizations).every((value) => value === 0)).toBe(true);
    expect(result.code).toBe(reference?.code);
    expect(result.map).toEqual(reference?.map);
  });

  it.each(["infer", "annotation"] as const)(
    "keeps selection and unsupported diagnostics in mixed %s candidates",
    async (mode) => {
      const result = await compileReactModule(
        `import { useEffect, useState } from "react";
        export function Skipped() { "use no compiler"; return <div />; }
        export const First = () => { "use optimized"; const [value, setValue] = useState(1); return <span>{value}</span>; },
          AlsoSkipped = () => { "use no compiler"; return <div />; },
          Second = function () { "use optimized"; const [value, setValue] = useState(2); return <span>{value}</span>; };
        export default function Last() { "use optimized"; const [value, setValue] = useState(3); return <span>{value}</span>; }
        export function Unsupported() { "use optimized"; useEffect(() => {}, []); return <div />; }`,
        id,
        normalizeReactCompilerOptions({
          mode,
          ...(mode === "annotation" ? { directive: "use optimized" } : {}),
          reactivity,
        }),
      );
      expect(result.compiled).toEqual(["First", "Second", "Last"]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        component: "Unsupported",
        selected: mode === "annotation",
      });
      expect(result.diagnostics[0].reason).toBeTruthy();
      expect(result.code).toContain('"use no compiler"');
    },
  );

  it("keeps module-level selection for concise arrows and explicit diagnostics", async () => {
    const result = await compileReactModule(
      `"use optimized";
      import { useEffect, useState } from "react";
      export const First = () => { const [value, setValue] = useState(1); return <div>{value}</div>; };
      export const Concise = () => <div>concise</div>;
      export const Unsupported = function () { useEffect(() => {}, []); return <div />; };
      export function Skipped() { "use no compiler"; useEffect(() => {}, []); return <div />; }`,
      id,
      normalizeReactCompilerOptions({ mode: "annotation", directive: "use optimized", reactivity }),
    );
    expect(result.compiled).toEqual(["First"]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]).toMatchObject({
      component: "Concise",
      reason: "components must use a block body",
      selected: true,
    });
    expect(result.diagnostics[1]).toMatchObject({ component: "Unsupported", selected: true });
  });
});
