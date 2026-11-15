// @vitest-environment node

import { parseSync, traverse, types as t } from "@babel/core";
import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const cases = [
  [
    "keyed row",
    "KeyedRows",
    "<ul>{rows.map(row => <li key={row.id}><span>{row.label}</span><b>prefix {row.label} suffix</b></li>)}</ul>",
  ],
  [
    "nested keyed row",
    "KeyedRows",
    "<ul>{rows.map(row => <li key={row.id}><section><span>{row.label}</span><b>prefix {row.label} suffix</b></section></li>)}</ul>",
  ],
] as const;

describe.each(["static", "hybrid"] as const)("scalar text readers (%s)", (reactivity) => {
  it.each(cases)(
    "avoids wrapper arrays in %s bindings and retains multi-part text",
    async (_name, marker, body) => {
      const result = await compileReactModule(
        `
      import { useState } from "react";
      export function Labels() {
        const [rows, setRows] = useState([{id: 1, label: "before"}]);
        return <main><button onClick={() => setRows(current => current.map(row => ({...row, label: "after"})))}>Update</button>${body}</main>;
      }
    `,
        "/app/Labels.tsx",
        normalizeReactCompilerOptions({ reactivity }),
      );
      expect(result.compiled).toEqual(["Labels"]);
      expect(result.diagnostics).toEqual([]);
      if (marker) expect(result.code).toContain(marker);
      const reads: t.Expression[] = [];
      const ast = parseSync(result.code, {
        configFile: false,
        babelrc: false,
        parserOpts: { plugins: ["jsx", "typescript"] },
      })!;
      traverse(ast, {
        ObjectExpression(path) {
          const fields = path.node.properties;
          const property = (name: string) =>
            fields.find(
              (field) => t.isObjectProperty(field) && t.isIdentifier(field.key, { name }),
            );
          const kind = property("kind");
          const read = property("read");
          if (
            !t.isObjectProperty(kind) ||
            !t.isStringLiteral(kind.value, { value: "text" }) ||
            !t.isObjectProperty(read) ||
            !t.isArrowFunctionExpression(read.value)
          )
            return;
          const body = read.value.body;
          if (t.isExpression(body)) reads.push(body);
        },
      });
      expect(reads.length).toBeGreaterThanOrEqual(2);
      expect(reads.some((read) => !t.isArrayExpression(read))).toBe(true);
      expect(
        reads.filter((read) => t.isArrayExpression(read) && read.elements.length === 1),
      ).toEqual([]);
      expect(reads.some((read) => t.isArrayExpression(read) && read.elements.length === 3)).toBe(
        true,
      );
    },
  );
});
