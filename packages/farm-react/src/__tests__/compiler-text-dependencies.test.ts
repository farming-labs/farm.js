// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseSync, types as t } from "@babel/core";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Exercise private analysis with the real collector/validators, without adding
// a production export or instrumentation to the compiler's hot path.
const source = readFileSync(new URL("../compiler.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
type States = Map<string, { valueName: string; setterName: string; index: number }>;
type Result = {
  bindings?: Array<{ dependencies: number[]; path: number[]; value: t.Expression }>;
  reason?: string;
};
type Probe = {
  host: (
    root: t.JSXElement,
    states: States,
    conditional?: Set<t.Expression>,
    keyed?: Set<t.Expression>,
  ) => Result;
  composable: (
    root: t.JSXElement,
    states: States,
  ) => { plans?: Array<{ kind: string; dependencies: number[] }>; reason?: string };
};
function probe() {
  const calls = new Map<t.Expression, number>();
  const compiler = new Function(
    "require",
    "exports",
    "observe",
    `${outputText}
    const originalCollect = collectStateDependencies;
    collectStateDependencies = (...args) => { observe(args[0]); return originalCollect(...args); };
    const safeGlobals = new Set(["Math", "String", "Number", "Boolean"]);
    return {
      host: (root, states, conditional = new Set(), keyed = new Set()) =>
        analyzeHostTree(root, states, safeGlobals, conditional, keyed, new Set(), new Set()),
      composable: (root, states) =>
        analyzeComposableBlocks(root, states, safeGlobals, new Set(), new Set())
    };
  `,
  )(createRequire(import.meta.url), {}, (expression: t.Expression) => {
    calls.set(expression, (calls.get(expression) || 0) + 1);
  }) as Probe;
  return { ...compiler, calls };
}
function root(source: string): t.JSXElement {
  const file = parseSync(source, {
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ["jsx"] },
  });
  const statement = file?.program.body[0];
  if (!t.isExpressionStatement(statement) || !t.isJSXElement(statement.expression)) {
    throw new Error("Expected a JSX root");
  }
  return statement.expression;
}
function states(...names: string[]): States {
  return new Map(
    names.map((valueName, index) => [
      valueName,
      { valueName, setterName: `set${valueName}`, index },
    ]),
  );
}
function expressions(element: t.JSXElement): t.Expression[] {
  return element.children.flatMap((child) =>
    t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)
      ? [child.expression]
      : [],
  );
}

describe("pass-local text dependencies", () => {
  it("collects each text expression once and unions sorted, distinct dependencies", () => {
    const analysis = probe();
    const element = root('<p>{b} / {a + b}{a}{"static"}{/* empty */}</p>');
    const original = JSON.stringify(element);
    const result = analysis.host(element, states("a", "b"));
    expect(result.reason).toBeUndefined();
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings?.[0].dependencies).toEqual([0, 1]);
    for (const expression of expressions(element)) expect(analysis.calls.get(expression)).toBe(1);
    expect(JSON.stringify(element)).toBe(original);
  });

  it("does not leak dependencies between sibling host visits", () => {
    const analysis = probe();
    const result = analysis.host(root("<main><p>{a}</p><p>{b}</p></main>"), states("a", "b"));
    expect(result.bindings?.map(({ path, dependencies }) => ({ path, dependencies }))).toEqual([
      { path: [0], dependencies: [0] },
      { path: [1], dependencies: [1] },
    ]);
    expect([...analysis.calls.values()]).toEqual([1, 1]);
  });

  it("preserves mixed stateful text fallback without a second collection", () => {
    const analysis = probe();
    const element = root("<p>{a}<strong>child</strong></p>");
    expect(analysis.host(element, states("a")).reason).toBe(
      "mixed element and stateful text children are not supported yet",
    );
    expect(analysis.calls.get(expressions(element)[0])).toBe(1);
  });

  it("validates every child before selecting mixed-text fallback", () => {
    const analysis = probe();
    const element = root("<p>{a}<strong>child</strong>{Date.now()}</p>");
    expect(analysis.host(element, states("a")).reason).toBe(
      "dynamic child structures require React reconciliation",
    );
    for (const expression of expressions(element)) expect(analysis.calls.get(expression)).toBe(1);
  });

  it.each(["Date.now()", "fn?.()", "({ a: 1 })", "() => a", "[a]"])(
    "preserves unsupported text fallback for %s",
    (expression) => {
      expect(probe().host(root(`<p>{${expression}}</p>`), states("a")).reason).toBe(
        "dynamic child structures require React reconciliation",
      );
    },
  );

  it("leaves conditional and keyed expressions to their owning analyzers", () => {
    const analysis = probe();
    const element = root(
      "<main>{open && <p>{a}</p>}{items.map(item => <p key={item.id}>{item.label}</p>)}</main>",
    );
    const [conditional, keyed] = expressions(element);
    expect(
      analysis.host(
        element,
        states("open", "a", "items"),
        new Set([conditional]),
        new Set([keyed]),
      ),
    ).toEqual({ bindings: [] });
    expect(analysis.calls.size).toBe(0);
  });

  it("does not reuse results across visits when bindings or syntax change", () => {
    const analysis = probe();
    const element = root("<p>{a}</p>");
    const expression = expressions(element)[0];
    expect(analysis.host(element, states()).bindings).toEqual([]);
    expect(analysis.host(element, states("a")).bindings?.[0].dependencies).toEqual([0]);
    expect(analysis.host(element, states("b", "a")).bindings?.[0].dependencies).toEqual([1]);
    if (!t.isIdentifier(expression)) throw new Error("Expected identifier");
    expression.name = "b";
    expect(analysis.host(element, states("b", "a")).bindings?.[0].dependencies).toEqual([0]);
    expect(analysis.calls.get(expression)).toBe(4);
  });

  it("keeps lexical globals reactive and matching property names nonreactive", () => {
    expect(
      probe().host(root("<p>{Infinity}{NaN}</p>"), states("NaN", "Infinity")).bindings?.[0]
        .dependencies,
    ).toEqual([0, 1]);
    expect(probe().host(root("<p>{record.a}</p>"), states("a")).bindings).toEqual([]);
  });

  it("reuses conditional text dependencies without dropping branch ownership", () => {
    const analysis = probe();
    const element = root(
      "<main><header>Title</header>{open && <section onClick={() => a}><p>{b}{a + b}</p></section>}<footer>End</footer></main>",
    );
    const result = analysis.composable(element, states("open", "a", "b"));
    expect(result.reason).toBeUndefined();
    expect(result.plans).toContainEqual(
      expect.objectContaining({ kind: "conditional", dependencies: [0, 1, 2] }),
    );
    const branchExpressions: t.Expression[] = [];
    t.traverseFast(element, (node) => {
      if (
        t.isJSXExpressionContainer(node) &&
        (t.isIdentifier(node.expression, { name: "b" }) || t.isBinaryExpression(node.expression))
      )
        branchExpressions.push(node.expression);
    });
    expect(branchExpressions).toHaveLength(2);
    for (const expression of branchExpressions) expect(analysis.calls.get(expression)).toBe(1);
  });
});
