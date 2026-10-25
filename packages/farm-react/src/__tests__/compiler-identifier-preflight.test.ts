// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseSync, types as t } from "@babel/core";
import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

// Instrument the real private analysis, not the production compiler exports.
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
const referencesIdentifier = new Function(
  "require",
  "exports",
  `${outputText}; return referencesIdentifier;`,
)((id: string) => (id === "@babel/core" ? instrumentedBabel : require(id)), {}) as (
  expression: t.Expression,
  name: string,
) => boolean;

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

beforeEach(() => {
  traversals = 0;
  clones = 0;
});

describe("identifier preflight", () => {
  it.each([
    "42",
    "'target'",
    "/target/",
    "`target`",
    "object.other",
    "() => { const other = 1; return other; }",
    '<main title="target">target</main>',
    "({ ['target']: 1 })",
    "value as Other",
  ])("rejects absent names without cloning or building scopes: %s", (code) => {
    const input = expression(code);
    const before = JSON.stringify(input);
    freeze(input);
    expect(referencesIdentifier(input, "target")).toBe(false);
    expect(traversals).toBe(0);
    expect(clones).toBe(0);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    ["target", "target"],
    ["object[target]", "target"],
    ["({ target })", "target"],
    ["() => () => target", "target"],
    ["(local = target) => local", "target"],
    ["target?.value", "target"],
    ["[...target]", "target"],
    ["<Target />", "Target"],
    ["<Target.Part />", "Target"],
    ["<target.Part />", "target"],
    ["<main>{target}</main>", "target"],
    ["target as unknown", "target"],
    ["target!", "target"],
    ["数 + 1", "数"],
    ["\\u0074arget", "target"],
    ["Math.max(1, 2)", "Math"],
    ["NaN", "NaN"],
    ["undefined", "undefined"],
    ["Infinity", "Infinity"],
  ])("retains full analysis for a possible reference: %s", (code, name) => {
    const input = expression(code);
    const before = JSON.stringify(input);
    freeze(input);
    expect(referencesIdentifier(input, name)).toBe(true);
    expect(traversals).toBe(1);
    expect(clones).toBe(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    "target => target",
    "function target() { return target; }",
    "() => { const target = 1; return target; }",
    "() => { return target; var target; }",
    "() => { try { throw 0; } catch (target) { return target; } }",
    "({ target: 1 })",
    "object.target",
    "<target />",
    '<main target="value" />',
    "() => { target: for (;;) { break target; } }",
  ])("does not mistake a syntactic match for a free reference: %s", (code) => {
    const input = expression(code);
    const before = JSON.stringify(input);
    freeze(input);
    expect(referencesIdentifier(input, "target")).toBe(false);
    expect(traversals).toBe(1);
    expect(clones).toBe(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("rechecks different names and edited trees instead of caching a negative result", () => {
    const input = t.identifier("other");
    expect(referencesIdentifier(input, "target")).toBe(false);
    expect(referencesIdentifier(input, "other")).toBe(true);
    input.name = "target";
    expect(referencesIdentifier(input, "target")).toBe(true);
    expect(referencesIdentifier(input, "other")).toBe(false);
  });

  it("resolves JSX names shadowed by a callback parameter", () => {
    expect(referencesIdentifier(expression("Target => <Target />"), "Target")).toBe(false);
    expect(traversals).toBe(1);
    expect(clones).toBe(1);
  });
});

describe.each(["static", "hybrid"] as const)(
  "identifier preflight integration (%s)",
  (reactivity) => {
    const compile = (key: string) =>
      compileReactModule(
        `import { useState } from "react";
       export function Rows() {
         const [items, setItems] = useState([{ id: "a", index: "a" }]);
         return <ul>{items.map((item, index) => <li key={${key}}>{item.id}</li>)}</ul>;
       }`,
        "/app/Rows.tsx",
        normalizeReactCompilerOptions({ reactivity }),
      );

    it("keeps item-derived keys when the index name is absent", async () => {
      const result = await compile("item.id");
      expect(result.compiled).toEqual(["Rows"]);
      expect(result.diagnostics).toEqual([]);
    });

    it("keeps item-derived keys whose property happens to match the index name", async () => {
      const result = await compile("item.index");
      expect(result.compiled).toEqual(["Rows"]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each(["index", "'constant'"])("retains fallback for an invalid key: %s", async (key) => {
      const result = await compile(key);
      expect(result.compiled).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].reason).toContain(
        key === "index"
          ? "keys cannot depend on the array index"
          : "keys must depend on the mapped item",
      );
      expect(result.code).not.toContain("createCompiledComponent");
      expect(result.code).toContain("items.map");
    });
  },
);
