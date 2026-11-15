// @vitest-environment node

import { parseSync, traverse, types as t, type NodePath } from "@babel/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const id = "/app/FeatureIdentifiers.tsx";
const rows = (name: string) => `
  export function ${name}() {
    const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
    return <main><button onClick={() => setItems(items)}>Keep</button><ul>
      {items.map(item => <li key={item.id}>{item.label}</li>)}
    </ul></main>;
  }
`;

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

function features(code: string) {
  const path = program(code);
  const imports = path.node.body.flatMap((statement) =>
    t.isImportDeclaration(statement) && statement.source.value === "@farm.js/react/compiler-runtime"
      ? statement.specifiers.flatMap((specifier) =>
          t.isImportSpecifier(specifier) &&
          t.isIdentifier(specifier.imported) &&
          specifier.imported.name.endsWith("RuntimeFeature")
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

afterEach(() => vi.restoreAllMocks());

describe.each(["static", "hybrid"] as const)("feature identifier allocation (%s)", (reactivity) => {
  it.each([
    [
      "feature-free",
      "export function Counter() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>{count}</button>; }",
      "infer",
      ["Counter"],
    ],
    ["opted-out", `export function View() { "use no compiler"; return <div />; }`, "infer", []],
    ["unselected", rows("Rows"), "annotation", []],
    [
      "unsupported",
      "export function View() { useEffect(() => {}, []); return <div />; }",
      "infer",
      [],
    ],
  ] as const)(
    "does not reserve feature aliases for %s components",
    async (_name, source, mode, compiled) => {
      const spy = requests();
      const result = await compileReactModule(
        'import { useState, useEffect } from "react";\n' + source,
        id,
        normalizeReactCompilerOptions({ mode, reactivity }),
      );
      expect(result.compiled).toEqual(compiled);
      expect(features(result.code)).toEqual([]);
      expect(spy.mock.calls.filter(([name]) => name.endsWith("RuntimeFeature"))).toEqual([]);
      expect(result.diagnostics).toHaveLength(_name === "unsupported" ? 1 : 0);
    },
  );

  it.each([false, true])(
    "reserves each used feature once across mixed candidates (reversed=%s)",
    async (reverse) => {
      const sources = [
        rows("First"),
        'export function Skipped() { "use no compiler"; return <div />; }',
        "export function Unsupported() { useEffect(() => {}, []); return <div />; }",
        rows("Second"),
      ];
      if (reverse) sources.reverse();
      const spy = requests();
      const result = await compileReactModule(
        'import { useState, useEffect } from "react";\n' + sources.join("\n"),
        id,
        normalizeReactCompilerOptions({ reactivity }),
      );
      expect(result.compiled).toEqual(reverse ? ["Second", "First"] : ["First", "Second"]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].component).toBe("Unsupported");
      const imported = features(result.code);
      expect(imported).toHaveLength(1);
      expect(
        spy.mock.calls.filter(([name]) => name.endsWith("RuntimeFeature")).map(([name]) => name),
      ).toEqual(imported.map((feature) => feature.imported));
      const binding = program(result.code).scope.getBinding(imported[0].local);
      expect(binding?.referencePaths).toHaveLength(2);
    },
  );

  it.each(["binding", "global", "import"] as const)(
    "preserves %s collisions before and after the selected component",
    async (kind) => {
      const reference = await compileReactModule(
        'import { useState } from "react";\n' + rows("Rows"),
        id,
        normalizeReactCompilerOptions({ reactivity }),
      );
      const [feature] = features(reference.code);
      expect(feature).toBeDefined();
      const names = [feature.local, feature.local + "2"];
      const declaration =
        kind === "binding"
          ? `const ${names[0]} = "before", ${names[1]} = "after";`
          : kind === "import"
            ? `import { before as ${names[0]}, after as ${names[1]} } from "user-module";`
            : "";
      const source = `import { useState } from "react"; ${declaration}
      export const before = ${names[0]};
      ${rows("Rows")}
      export const after = ${names[1]};
      export function Skipped() { "use no compiler"; const ${feature.local} = "local"; return <p>{${feature.local}}</p>; }
    `;
      const spy = requests();
      const result = await compileReactModule(
        source,
        id,
        normalizeReactCompilerOptions({ reactivity }),
      );
      expect(result.compiled).toEqual(["Rows"]);
      expect(result.diagnostics).toEqual([]);
      const [actual] = features(result.code);
      expect(actual.imported).toBe(feature.imported);
      expect(names).not.toContain(actual.local);
      expect(result.code).toContain(`export const before = ${names[0]};`);
      expect(result.code).toContain(`export const after = ${names[1]};`);
      expect(result.code).toContain(`const ${feature.local} = "local";`);
      expect(spy.mock.calls.filter(([name]) => name.endsWith("RuntimeFeature"))).toEqual([
        [feature.imported],
      ]);
    },
  );

  it.each([false, true])(
    "keeps distinct features independent of candidate order (reversed=%s)",
    async (reverse) => {
      const sources = [
        rows("Rows"),
        "export function Toggle() { const [shown, setShown] = useState(true); return <section><button onClick={() => setShown(!shown)}>Toggle</button>{shown ? <strong>Shown</strong> : <em>Hidden</em>}</section>; }",
      ];
      if (reverse) sources.reverse();
      const spy = requests();
      const result = await compileReactModule(
        'import { useState } from "react";\n' + sources.join("\n"),
        id,
        normalizeReactCompilerOptions({ reactivity }),
      );
      expect(result.compiled).toEqual(reverse ? ["Toggle", "Rows"] : ["Rows", "Toggle"]);
      expect(result.diagnostics).toEqual([]);
      const imported = features(result.code);
      expect(imported).toHaveLength(2);
      const reserved = spy.mock.calls
        .filter(([name]) => name.endsWith("RuntimeFeature"))
        .map(([name]) => name)
        .sort();
      expect(reserved).toEqual(imported.map((feature) => feature.imported).sort());
      expect(new Set(imported.map((feature) => feature.local)).size).toBe(2);
    },
  );

  it("keeps module/function annotation selection and module-local caches separate", async () => {
    const spy = requests();
    const functionSelected = rows("Selected").replace("() {", '() { "use compiler";');
    const source = 'import { useState } from "react";\n' + rows("Unselected") + functionSelected;
    const first = await compileReactModule(
      source,
      id,
      normalizeReactCompilerOptions({ mode: "annotation", reactivity }),
    );
    const second = await compileReactModule(
      '"use compiler";\n' + source,
      "/app/Second.tsx",
      normalizeReactCompilerOptions({ mode: "annotation", reactivity }),
    );
    expect(first.compiled).toEqual(["Selected"]);
    expect(second.compiled).toEqual(["Unselected", "Selected"]);
    const imported = features(first.code);
    expect(features(second.code)).toEqual(imported);
    expect(spy.mock.calls.filter(([name]) => name.endsWith("RuntimeFeature"))).toEqual([
      [imported[0].imported],
      [imported[0].imported],
    ]);
  });
});
