// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as babel from "@babel/core";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const { types: t } = babel;
const probes = [
  ["has", "containsPotentialKeyedMembershipCall"],
  ["get", "containsPotentialKeyedMapLookupCall"],
] as const;
type State = { valueName: string; setterName: string; index: number };
type Probe = (expression: babel.types.Expression, state: ReadonlyMap<string, State>) => boolean;
const source = readFileSync(new URL("../compiler.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const require = createRequire(import.meta.url);

function probe(name: (typeof probes)[number][1]) {
  let traversals = 0;
  let clones = 0;
  const instrumentedBabel = {
    ...babel,
    types: {
      ...t,
      cloneNode: (...args: Parameters<typeof t.cloneNode>) => {
        clones++;
        return t.cloneNode(...args);
      },
    },
    traverse: (...args: Parameters<typeof babel.traverse>) => {
      traversals++;
      return babel.traverse(...args);
    },
  };
  const run = new Function("require", "exports", `${outputText}; return ${name};`)(
    (id: string) => (id === "@babel/core" ? instrumentedBabel : require(id)),
    {},
  ) as Probe;
  return { run, traversals: () => traversals, clones: () => clones };
}

function expression(code: string): babel.types.Expression {
  const file = babel.parseSync(`(${code})`, {
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ["jsx", "typescript"] },
  });
  const statement = file?.program.body[0];
  if (!t.isExpressionStatement(statement)) throw new Error("Expected expression");
  return statement.expression;
}

function state(setterName = "setRows") {
  return new Map([["rows", { valueName: "rows", setterName, index: 0 }]]);
}

function freeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

describe.each(probes)("collection presence probe: .%s()", (method, name) => {
  const accepted = [
    `rows.${method}(key)`,
    `condition ? rows.${method}(key) : false`,
    `() => rows.${method}(key)`,
    `<span>{rows.${method}(key)}</span>`,
    `(rows.${method}(key) as boolean)`,
    `rows.${method}<string>(key)`,
    `unrelated(rows.${method}(key))`,
    // Presence is deliberately conservative: full target analysis owns scope proof.
    `((rows) => rows.${method}(key))(custom)`,
    `(() => { const rows = custom; return rows.${method}(key); })()`,
  ];
  const rejected = [
    `rows.${method === "has" ? "get" : "has"}(key)`,
    `rows['${method}'](key)`,
    `rows?.${method}(key)`,
    `rows.${method}?.(key)`,
    `rows.${method}(...keys)`,
    `rows.${method}()`,
    `rows.${method}(key, extra)`,
    `unknown.${method}(key)`,
    `this.rows.${method}(key)`,
    `rows.${method}`,
    `({ ${method}: 'rows.${method}(key)' })`,
  ];

  it.each(accepted)("preserves a possible match in %s without mutating the input", (code) => {
    const analysis = probe(name);
    const input = expression(code);
    const before = JSON.stringify(input);
    freeze(input);
    expect(analysis.run(input, state())).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(rejected)("preserves rejection of %s", (code) => {
    const analysis = probe(name);
    const input = expression(code);
    const before = JSON.stringify(input);
    freeze(input);
    expect(analysis.run(input, state())).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not create scopes or clones for a match", () => {
    const analysis = probe(name);
    expect(analysis.run(expression(`rows.${method}(key)`), state())).toBe(true);
    expect(analysis.traversals()).toBe(0);
    expect(analysis.clones()).toBe(0);
  });

  it("does not create scopes or clones for a miss", () => {
    const analysis = probe(name);
    expect(analysis.run(expression("() => key.label"), state())).toBe(false);
    expect(analysis.traversals()).toBe(0);
    expect(analysis.clones()).toBe(0);
  });

  it("requires a setter and rechecks changing reactive state", () => {
    const analysis = probe(name);
    const input = expression(`rows.${method}(key)`);
    const reactive = state("");
    expect(analysis.run(input, reactive)).toBe(false);
    reactive.get("rows")!.setterName = "setRows";
    expect(analysis.run(input, reactive)).toBe(true);
    reactive.clear();
    expect(analysis.run(input, reactive)).toBe(false);
  });

  it("rechecks the same expression after its body changes", () => {
    const analysis = probe(name);
    const input = t.arrowFunctionExpression([], t.booleanLiteral(false));
    expect(analysis.run(input, state())).toBe(false);
    input.body = expression(`rows.${method}(key)`);
    expect(analysis.run(input, state())).toBe(true);
    input.body = t.booleanLiteral(false);
    expect(analysis.run(input, state())).toBe(false);
  });
});
