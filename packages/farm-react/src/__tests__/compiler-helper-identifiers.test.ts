// @vitest-environment node

import { parseSync, traverse, types as t, type NodePath } from "@babel/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const id = "/app/HelperIdentifiers.tsx";
const keyedHelper = /^(?:create|finalize|apply)CompilerKeyed/;

function program(code: string): NodePath<t.Program> {
  const ast = parseSync(code, {
    configFile: false,
    babelrc: false,
    sourceType: "module",
    parserOpts: { plugins: ["jsx", "typescript"] },
  });
  if (!ast) throw new Error("Expected parsed module");
  let result: NodePath<t.Program> | undefined;
  traverse(ast, {
    Program(path) {
      result = path;
    },
  });
  if (!result) throw new Error("Expected program scope");
  return result;
}

function requests() {
  return vi.spyOn(Object.getPrototypeOf(program("").scope), "generateUidIdentifier");
}

function helpers(code: string) {
  const path = program(code);
  const imports = path.node.body.flatMap((statement) =>
    t.isImportDeclaration(statement) && statement.source.value === "@farm.js/react/compiler-runtime"
      ? statement.specifiers.flatMap((specifier) =>
          t.isImportSpecifier(specifier) &&
          t.isIdentifier(specifier.imported) &&
          keyedHelper.test(specifier.imported.name)
            ? [{ imported: specifier.imported.name, local: specifier.local.name }]
            : [],
        )
      : [],
  );
  for (const { local } of imports) {
    const binding = path.scope.getBinding(local);
    expect(binding?.kind).toBe("module");
    expect(binding?.referencePaths.length).toBeGreaterThan(0);
    for (const reference of binding!.referencePaths) {
      expect(reference.scope.getBinding(local)).toBe(binding);
    }
  }
  return imports;
}

const rows = (name: string) => `export function ${name}() {
  const [items, setItems] = useState([{id: "a", label: "Alpha"}, {id: "b", label: "Beta"}]);
  return <main><button onClick={() => setItems(previous => previous.filter(item => item.id !== "a"))}>Remove</button>
    <ul>{items.map(item => <li key={item.id}>{item.label}</li>)}</ul></main>;
}`;

afterEach(() => vi.restoreAllMocks());

describe.each(["static", "hybrid"] as const)("lazy helper identifiers (%s)", (reactivity) => {
  it.each([
    "export function Counter() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>{count}</button>; }",
    "export const Counter = () => { const [count, setCount] = useState(0); return <section><button onClick={() => setCount(count + 1)}>{count}</button></section>; };",
  ])("avoids unused helper reservations in a selected component", async (source) => {
    const spy = requests();
    const result = await compileReactModule(
      'import {useState} from "react";' + source,
      id,
      normalizeReactCompilerOptions({ reactivity }),
    );
    expect(result.compiled).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
    expect(helpers(result.code)).toEqual([]);
    // Five reorder recognizer aliases may be needed; the other twenty are not.
    expect(spy.mock.calls.filter(([name]) => keyedHelper.test(name)).length).toBeLessThanOrEqual(5);
  });

  it.each([false, true])(
    "shares each imported helper across candidates (reversed=%s)",
    async (reverse) => {
      const sources = [
        rows("First"),
        'export function Skipped() { "use no compiler"; return <svg><a /></svg>; }',
        "export function Unsupported() { useEffect(() => {}, []); return <div />; }",
        rows("Second"),
      ];
      if (reverse) sources.reverse();
      const spy = requests();
      const result = await compileReactModule(
        'import {useState, useEffect} from "react";' + sources.join("\n"),
        id,
        normalizeReactCompilerOptions({ reactivity }),
      );
      expect(result.compiled).toEqual(reverse ? ["Second", "First"] : ["First", "Second"]);
      expect(result.diagnostics).toHaveLength(1);
      const imported = helpers(result.code);
      expect(imported.map((item) => item.imported)).toContain("createCompilerKeyedArrayFilter");
      for (const helper of imported) {
        expect(spy.mock.calls.filter(([name]) => name === helper.imported)).toHaveLength(1);
        expect(program(result.code).scope.getBinding(helper.local)?.referencePaths).toHaveLength(2);
      }
    },
  );

  it.each(["binding", "global", "import"] as const)(
    "preserves %s collisions and module-local caches",
    async (kind) => {
      const first = "_createCompilerKeyedArrayFilter",
        second = first + "2";
      const declaration =
        kind === "binding"
          ? `const ${first} = "before", ${second} = "after";`
          : kind === "import"
            ? `import {before as ${first}, after as ${second}} from "user-module";`
            : "";
      const source = `import {useState} from "react";${declaration}
      export const before = ${first};${rows("Rows")}export const after = ${second};
      export function Skipped() { "use no compiler"; const ${first} = "local"; return <p>{${first}}</p>; }`;
      const options = normalizeReactCompilerOptions({ reactivity });
      const result = await compileReactModule(source, id, options);
      expect(result.compiled).toEqual(["Rows"]);
      expect(result.diagnostics).toEqual([]);
      const helper = helpers(result.code).find(
        (item) => item.imported === "createCompilerKeyedArrayFilter",
      );
      expect(helper).toBeDefined();
      expect([first, second]).not.toContain(helper!.local);
      expect(result.code).toContain(`export const before = ${first};`);
      expect(result.code).toContain(`export const after = ${second};`);
      expect(result.code).toContain(`const ${first} = "local";`);
      expect(await compileReactModule(source, id, options)).toEqual(result);
      const fresh = await compileReactModule(
        'import {useState} from "react";' + rows("Rows"),
        "/app/Fresh.tsx",
        options,
      );
      expect(
        helpers(fresh.code).find((item) => item.imported === "createCompilerKeyedArrayFilter")
          ?.local,
      ).toBe(first);
    },
  );
});
