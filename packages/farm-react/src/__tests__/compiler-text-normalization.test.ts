// @vitest-environment node

import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

// Exercise the actual private normalizer without adding a public runtime export.
const source = readFileSync(new URL("../compiler-runtime.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "runtime.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declaration = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "renderTextValue",
);
if (!declaration) throw new Error("Missing runtime text normalizer");
const { outputText } = ts.transpileModule(declaration.getText(), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
});
const normalize = new Function(`${outputText}; return renderTextValue;`)() as (
  value: unknown,
) => string;

type Factory = (log: string[]) => unknown;
const cases: Array<[string, Factory]> = [
  ...[
    undefined,
    null,
    true,
    false,
    "",
    "x",
    0,
    -0,
    1,
    NaN,
    Infinity,
    -Infinity,
    12n,
    Symbol("s"),
  ].map((value, index): [string, Factory] => [`primitive ${index}`, () => value]),
  ["empty array", () => []],
  ["single array", () => [1]],
  ["mixed array", () => [1, null, false, "x"]],
  ["nested arrays", () => [[1], [null, ["x", false]]]],
  // Intentionally sparse: Array.from would create present undefined elements instead.
  ["single sparse array", () => new Array(1)], // oxlint-disable-line unicorn/no-new-array
  ["sparse array", () => new Array(3)], // oxlint-disable-line unicorn/no-new-array
  ["object", () => ({})],
  [
    "custom primitive",
    (log) => ({
      [Symbol.toPrimitive](hint: string) {
        log.push(hint);
        return "coerced";
      },
    }),
  ],
  [
    "throwing coercion",
    (log) => ({
      toString() {
        log.push("throw");
        throw new TypeError("coercion failed");
      },
    }),
  ],
  [
    "array getter",
    (log) =>
      Object.defineProperty([1], "0", {
        get() {
          log.push("get");
          return "getter";
        },
      }),
  ],
  [
    "custom array map",
    (log) =>
      Object.defineProperty([1, 2], "map", {
        value(callback: (value: unknown) => unknown) {
          log.push("custom map");
          return Array.prototype.map.call(this, callback);
        },
      }),
  ],
  [
    "array proxy",
    (log) =>
      new Proxy([1, 2], {
        get(target, key, receiver) {
          log.push(String(key));
          return Reflect.get(target, key, receiver);
        },
      }),
  ],
  [
    "array subclass",
    () => {
      class Values extends Array {}
      return new Values(1, 2);
    },
  ],
  [
    "revoked proxy",
    () => {
      const { proxy, revoke } = Proxy.revocable([], {});
      revoke();
      return proxy;
    },
  ],
];

function observe(factory: Factory, wrapped: boolean) {
  const log: string[] = [];
  const value = factory(log);
  try {
    return { value: normalize(wrapped ? [value] : value), log };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { error: { name: error.name, message: error.message }, log };
  }
}

it.each(cases)(
  "preserves normalization and evaluation for %s without a wrapper",
  (_name, factory) => {
    expect(observe(factory, false)).toEqual(observe(factory, true));
  },
);
