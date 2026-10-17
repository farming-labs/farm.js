// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as babel from "@babel/core";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const { types: t } = babel;
const names = [
  "rewriteQueuedKeyedArrayReorderMapHints",
  "rewriteQueuedKeyedArrayMappedStructuralHints",
  "rewriteQueuedKeyedArrayStructuralMapHints",
  "rewriteQueuedKeyedArrayStructuralPrependMapHints",
  "rewriteQueuedKeyedArrayRollingWindowMapHints",
  "rewriteQueuedKeyedArrayStructuralReorderHints",
  "rewriteQueuedKeyedArrayMapReorderHints",
] as const;
type Result = { root: babel.types.JSXElement } & Record<string, unknown>;
type Pass = (...args: unknown[]) => Result;
const source = readFileSync(new URL("../compiler.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("compiler.ts", source, ts.ScriptTarget.Latest, true);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const require = createRequire(import.meta.url);

function probe(name: (typeof names)[number]) {
  let traversals = 0;
  const instrumentedBabel = {
    ...babel,
    traverse: (...args: Parameters<typeof babel.traverse>) => {
      traversals++;
      return babel.traverse(...args);
    },
  };
  const pass = new Function("require", "exports", `${outputText}; return ${name};`)(
    (id: string) => (id === "@babel/core" ? instrumentedBabel : require(id)),
    {},
  ) as Pass;
  const declaration = ast.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  if (!declaration) throw new Error(`Missing ${name}`);
  const helpers = declaration.parameters.slice(2, -1).map((parameter) => {
    if (parameter.type?.getText(ast) !== "t.Identifier") throw new Error("Unexpected parameter");
    return t.identifier(`_${parameter.name.getText(ast)}`);
  });
  return {
    helpers,
    traversals: () => traversals,
    run: (root: babel.types.JSXElement, allowed = true) =>
      pass(
        root,
        new Map([["setRows", { valueName: "rows", setterName: "setRows", index: 0 }]]),
        ...helpers,
        allowed,
      ),
  };
}

function root(expression = "rows.map(row => row)"): babel.types.JSXElement {
  const file = babel.parseSync(
    `<main onClick={() => { setRows(current => ${expression}); }}></main>`,
    {
      configFile: false,
      babelrc: false,
      parserOpts: { plugins: ["jsx", "typescript"] },
    },
  );
  const statement = file?.program.body[0];
  if (!t.isExpressionStatement(statement) || !t.isJSXElement(statement.expression)) {
    throw new Error("Expected JSX root");
  }
  return statement.expression;
}

function unchanged(result: Result, input: babel.types.JSXElement, before: string) {
  expect(result.root).not.toBe(input);
  expect(result.root).toEqual(t.cloneNode(input, true));
  const counters = Object.entries(result).filter(([key]) => /count$/i.test(key));
  expect(counters.length).toBeGreaterThan(0);
  expect(counters.every(([, value]) => value === 0)).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
}

describe.each(names)("queued hint preflight: %s", (name) => {
  it("does not build scopes when no compiler helper call exists", () => {
    const analysis = probe(name);
    const input = root();
    const before = JSON.stringify(input);
    unchanged(analysis.run(input), input, before);
    expect(analysis.traversals()).toBe(0);
  });

  it("preserves the disabled pass without inspecting possible helper calls", () => {
    const analysis = probe(name);
    const input = root(`${analysis.helpers[0].name}(current)`);
    unchanged(analysis.run(input, false), input, JSON.stringify(input));
    expect(analysis.traversals()).toBe(0);
  });

  it("ignores matching strings, property names and non-call identifiers", () => {
    const analysis = probe(name);
    const helper = analysis.helpers[0].name;
    const input = root(
      `({${helper}: '${helper}', reference: ${helper}, call: object.${helper}()})`,
    );
    unchanged(analysis.run(input), input, JSON.stringify(input));
    expect(analysis.traversals()).toBe(0);
  });

  it("keeps full analysis for each possible helper, including nested calls", () => {
    const analysis = probe(name);
    for (const helper of analysis.helpers) {
      const beforeCount = analysis.traversals();
      const input = root(`(() => ${helper.name}(current))()`);
      unchanged(analysis.run(input), input, JSON.stringify(input));
      expect(analysis.traversals()).toBeGreaterThan(beforeCount);
    }
  });

  it("does not treat a shadowed helper name as proof of eligibility", () => {
    const analysis = probe(name);
    const helper = analysis.helpers[0].name;
    const input = root(`((${helper}) => ${helper}(current))(custom)`);
    unchanged(analysis.run(input), input, JSON.stringify(input));
    expect(analysis.traversals()).toBeGreaterThan(0);
  });

  it("rechecks the same root after a helper call is introduced", () => {
    const analysis = probe(name);
    const input = root();
    unchanged(analysis.run(input), input, JSON.stringify(input));
    expect(analysis.traversals()).toBe(0);
    input.children.push(
      t.jsxExpressionContainer(t.callExpression(analysis.helpers[0], [t.identifier("current")])),
    );
    unchanged(analysis.run(input), input, JSON.stringify(input));
    expect(analysis.traversals()).toBeGreaterThan(0);
  });
});
