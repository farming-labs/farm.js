// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseSync, types as t } from "@babel/core";
import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";

// Exercise the private analyses without adding production exports or counters.
const require = createRequire(import.meta.url);
const babel = require("@babel/core") as typeof import("@babel/core");
const source = readFileSync(new URL("../compiler.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
let traversals = 0;
let clones = 0;
const instrumentedBabel = {
  ...babel,
  traverse: (...args: Parameters<typeof babel.traverse>) => {
    traversals += 1;
    return babel.traverse(...args);
  },
  types: new Proxy(babel.types, {
    get(target, key, receiver) {
      if (key === "cloneNode") {
        return (...args: Parameters<typeof t.cloneNode>) => {
          clones += 1;
          return t.cloneNode(...args);
        };
      }
      return Reflect.get(target, key, receiver);
    },
  }),
};
const { collectReferencedLocals, rewriteDerivedAccess } = new Function(
  "require",
  "exports",
  `${outputText}; return { collectReferencedLocals, rewriteDerivedAccess };`,
)((id: string) => (id === "@babel/core" ? instrumentedBabel : require(id)), {}) as {
  collectReferencedLocals: (expression: t.Expression, names: ReadonlySet<string>) => string[];
  rewriteDerivedAccess: <T extends t.Expression>(
    expression: T,
    derivedByName: ReadonlyMap<string, t.Expression>,
  ) => T;
};

function expression(code: string): t.Expression {
  const file = parseSync(`(${code})`, {
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ["jsx", "typescript"] },
  });
  const statement = file?.program.body[0];
  if (!t.isExpressionStatement(statement)) throw new Error("Expected expression");
  return statement.expression;
}

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

function expectOwnedTree(output: t.Expression, input: t.Expression): void {
  const inputNodes = new Set<t.Node>();
  t.traverseFast(input, (node) => {
    inputNodes.add(node);
  });
  t.traverseFast(output, (node) => {
    expect(inputNodes.has(node)).toBe(false);
  });
}

function printed(value: t.Expression): string {
  // Babel retains the original shorthand flag after replacing a property's
  // value. Compare emitted syntax rather than that incidental AST flag.
  const code = babel.transformFromAstSync(
    t.file(t.program([t.expressionStatement(value)])),
    undefined,
    {
      configFile: false,
      babelrc: false,
    },
  )?.code;
  if (typeof code !== "string") throw new Error("Expected generated expression");
  return code;
}

beforeEach(() => {
  traversals = 0;
  clones = 0;
});

const emptyInputs = [
  "42",
  "rows.map(row => row.label)",
  "value => { const local = value + 1; return local; }",
  '<main title="value">{items.map(item => <span key={item.id}>{item.label}</span>)}</main>',
];

describe("empty local-name analysis", () => {
  it.each(emptyInputs)("does not clone or build scopes for %s", (code) => {
    const input = expression(code);
    const before = JSON.stringify(input);
    freeze(input);
    expect(collectReferencedLocals(input, new Set())).toEqual([]);
    expect(traversals).toBe(0);
    expect(clones).toBe(0);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("returns independently mutable empty results", () => {
    const input = expression("value");
    const first = collectReferencedLocals(input, new Set());
    const second = collectReferencedLocals(input, new Set());
    expect(first).not.toBe(second);
    first.push("not a reference");
    expect(second).toEqual([]);
  });

  it.each([
    ["[second, first, second]", ["first", "second"], ["second", "first"]],
    ["object.local", ["local"], []],
    ["[object[local], { local: other, local }]", ["local", "other"], ["local", "other"]],
    ["local => local + outside", ["local", "outside"], ["outside"]],
    [
      "(local = fallback) => local + outside",
      ["local", "fallback", "outside"],
      ["fallback", "outside"],
    ],
    ["() => { let local; return local + outside; }", ["local", "outside"], ["outside"]],
    [
      "() => { try { throw 0; } catch (local) { return local + outside; } }",
      ["local", "outside"],
      ["outside"],
    ],
    ["() => { { const local = 1; consume(local); } return local; }", ["local"], ["local"]],
    [
      "[Math, NaN, undefined, Infinity]",
      ["Math", "NaN", "undefined", "Infinity"],
      ["Math", "NaN", "undefined", "Infinity"],
    ],
    [
      "<Local value={outside}><local /></Local>",
      ["Local", "local", "outside"],
      ["Local", "outside"],
    ],
    ["item => <Item value={item} />", ["item", "Item"], ["Item"]],
  ] as const)("keeps scoped reference semantics for %s", (code, names, expected) => {
    const input = expression(code);
    const before = JSON.stringify(input);
    freeze(input);
    expect(collectReferencedLocals(input, new Set(names))).toEqual(expected);
    expect(traversals).toBe(1);
    expect(clones).toBe(1);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("local-name miss preflight", () => {
  it.each([
    "42",
    "'local'",
    "/local/",
    "`local ${other}`",
    "other /* local */",
    "object['local']",
    "({ 'local': other })",
    "rows.map(row => row.label)",
    "value => { const other = value + 1; return other; }",
    '<main title="local">Local 数 {other}</main>',
    "<><Other value={other} /></>",
    "other as number",
    "other!",
    "other satisfies number",
  ])("does not clone or build scopes for a proven miss in %s", (code) => {
    const input = expression(code);
    const before = JSON.stringify(input);
    freeze(input);
    expect(collectReferencedLocals(input, new Set(["local", "Local", "数"]))).toEqual([]);
    expect(traversals).toBe(0);
    expect(clones).toBe(0);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    ["数 + local", ["local", "数"], ["数", "local"]],
    ["local as number", ["local"], ["local"]],
    ["local!", ["local"], ["local"]],
    ["local satisfies number", ["local"], ["local"]],
    ["({ local }) => local", ["local"], []],
    ["function local() { return local; }", ["local"], []],
    ["object?.[local]", ["local"], ["local"]],
    ["<Local.Part />", ["Local", "Part"], ["Local"]],
    ["<main local={other} />", ["local"], []],
  ] as const)("still builds scopes for a possible match in %s", (code, names, expected) => {
    const input = expression(code);
    const before = JSON.stringify(input);
    freeze(input);
    expect(collectReferencedLocals(input, new Set(names))).toEqual(expected);
    expect(traversals).toBe(1);
    expect(clones).toBe(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("returns fresh arrays and observes changes to a reused name set", () => {
    const input = expression("local");
    freeze(input);
    const names = new Set(["other"]);
    const first = collectReferencedLocals(input, names);
    const second = collectReferencedLocals(input, names);
    expect(first).not.toBe(second);
    first.push("not a reference");
    expect(second).toEqual([]);
    expect(traversals).toBe(0);
    names.add("local");
    expect(collectReferencedLocals(input, names)).toEqual(["local"]);
    expect(traversals).toBe(1);
    names.delete("local");
    expect(collectReferencedLocals(input, names)).toEqual([]);
    expect(traversals).toBe(1);
  });
});

describe("empty derived-name analysis", () => {
  it.each(emptyInputs)("keeps an owned clone without building scopes for %s", (code) => {
    const input = expression(code);
    const before = JSON.stringify(input);
    freeze(input);
    const output = rewriteDerivedAccess(input, new Map());
    expect(traversals).toBe(0);
    expect(clones).toBe(1);
    expect(output).toEqual(t.cloneNode(input, true));
    expectOwnedTree(output, input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not share output nodes between empty-map calls", () => {
    const input = expression("value + 1");
    const first = rewriteDerivedAccess(input, new Map());
    const second = rewriteDerivedAccess(input, new Map());
    expectOwnedTree(first, second);
  });

  it.each([
    ["derived + derived", "(state + 1) + (state + 1)"],
    ["derived => derived + outside", "derived => derived + outside"],
    [
      "() => { const derived = 1; return derived; }",
      "() => { const derived = 1; return derived; }",
    ],
    ["object.derived", "object.derived"],
    ["object[derived]", "object[state + 1]"],
    ["({ derived })", "({ derived: state + 1 })"],
    ["<span>{derived}</span>", "<span>{state + 1}</span>"],
    ["(local = derived) => local", "(local = state + 1) => local"],
  ])("keeps scoped replacement semantics for %s", (code, expected) => {
    const input = expression(code);
    const replacement = expression("state + 1");
    const before = JSON.stringify([input, replacement]);
    freeze(input);
    freeze(replacement);
    const output = rewriteDerivedAccess(input, new Map([["derived", replacement]]));
    expect(traversals).toBe(1);
    expect(printed(output)).toBe(printed(expression(expected)));
    expectOwnedTree(output, input);
    expectOwnedTree(output, replacement);
    expect(JSON.stringify([input, replacement])).toBe(before);
  });

  it("replaces global-named locals and does not recursively expand inserted expressions", () => {
    const input = expression("[Math, NaN]");
    const output = rewriteDerivedAccess(
      input,
      new Map([
        ["Math", expression("NaN + 1")],
        ["NaN", expression("2")],
      ]),
    );
    expect(t.isNodesEquivalent(output, expression("[NaN + 1, 2]"))).toBe(true);
    expect(traversals).toBe(1);
  });
});
