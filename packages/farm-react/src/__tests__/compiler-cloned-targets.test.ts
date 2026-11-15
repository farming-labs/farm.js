import { parseSync, transformFromAstSync, traverse, types as t } from "@babel/core";
import { describe, expect, it, vi } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

async function compileTargets(row: string) {
  const result = await compileReactModule(
    `
    import { useState } from "react";
    export function Rows() {
      const [items, setItems] = useState([]);
      return <section><button onClick={() => setItems([{id: 1, label: "one"}])}>Run</button>
        <ul>{items.map(item => ${row})}</ul></section>;
    }
  `,
    "/app/Rows.tsx",
    normalizeReactCompilerOptions(true),
  );
  expect(result.compiled).toEqual(["Rows"]);
  expect(result.diagnostics).toEqual([]);
  let lookup: ((root: Element) => (Element | null)[]) | undefined;
  const ast = parseSync(result.code, {
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ["jsx"] },
  })!;
  traverse(ast, {
    JSXAttribute(path) {
      if (!t.isJSXIdentifier(path.node.name, { name: "targets" })) return;
      const value = path.node.value;
      if (!t.isJSXExpressionContainer(value) || !t.isArrowFunctionExpression(value.expression))
        return;
      const code = transformFromAstSync(
        t.file(t.program([t.expressionStatement(value.expression)])),
        "",
        {
          configFile: false,
          babelrc: false,
        },
      )!.code!;
      lookup = new Function(`return (${code.replace(/;\s*$/, "")})`)();
    },
  });
  return lookup;
}

describe("compiled cloned-row target paths", () => {
  it("shares overlapping DOM edges and preserves target order", async () => {
    const lookup = await compileTargets(
      "<li key={item.id} className={item.label}><span>{item.id}</span><b><em>{item.label}</em></b></li>",
    );
    expect(lookup).toBeTypeOf("function");
    const row = document.createElement("li");
    row.innerHTML = "<span>id</span><b><em>label</em></b>";
    const expected = [row, row.querySelector("span"), row.querySelector("em")];
    const first = vi.spyOn(Element.prototype, "firstElementChild", "get");
    const next = vi.spyOn(Element.prototype, "nextElementSibling", "get");
    try {
      expect(lookup!(row)).toEqual(expected);
      expect(first).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalledTimes(1);
    } finally {
      first.mockRestore();
      next.mockRestore();
    }
    expect(lookup!(document.createElement("li"))).toEqual([expect.any(Element), null, null]);
  });

  it("reuses a target shared by an attribute and text binding", async () => {
    const lookup = await compileTargets(
      "<li key={item.id}><span title={item.label}>{item.id}</span></li>",
    );
    expect(lookup).toBeTypeOf("function");
    const row = document.createElement("li");
    const span = row.appendChild(document.createElement("span"));
    expect(lookup!(row)).toEqual([span, span]);
  });

  it.each([
    ["no repeated edges", "<li key={item.id}><span>{item.label}</span></li>"],
    ["form controls", "<li key={item.id}><input value={item.label} onChange={() => {}} /></li>"],
    [
      "style bindings",
      "<li key={item.id}><span title={item.label} style={{color: item.label}}>{item.label}</span></li>",
    ],
    [
      "custom elements",
      "<li key={item.id}><my-label title={item.label}>{item.label}</my-label></li>",
    ],
    [
      "wide rows",
      `<li key={item.id}>${"<i />".repeat(40)}<span title={item.label}>{item.label}</span></li>`,
    ],
  ])("keeps %s on the existing walker", async (_name, row) => {
    expect(await compileTargets(row)).toBeUndefined();
  });
});
