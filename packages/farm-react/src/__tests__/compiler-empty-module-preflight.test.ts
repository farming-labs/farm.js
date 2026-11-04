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
] as const)(
  "keeps the existing selection path for a present but unselected candidate",
  async (source, mode) => {
    const requests = helperRequests();
    const result = await compileReactModule(source, id, normalizeReactCompilerOptions({ mode }));
    expect(requests).toHaveBeenCalled();
    expect(result.compiled).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  },
);
