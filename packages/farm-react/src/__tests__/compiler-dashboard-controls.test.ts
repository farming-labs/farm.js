// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSync, traverse, types as t } from "@babel/core";
import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const filename = fileURLToPath(
  new URL(
    "../../../../examples/react-compiler-dashboard/src/components/standard-table-benchmark.tsx",
    import.meta.url,
  ),
);
const source = readFileSync(filename, "utf8");
const optimizedAction = "table-multi-map-update";
const snapshotAction = `${optimizedAction}-snapshot`;

// Read the actual benchmark instead of copying a control that could drift from it.
function isolateAction(action: string) {
  const ast = parseSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ["jsx", "typescript"] },
  });
  if (!ast) throw new Error("The benchmark did not parse.");
  const edits: { start: number; end: number }[] = [];
  let handler: string | undefined;
  traverse(ast, {
    JSXAttribute(path) {
      const attribute = path.node;
      if (
        !t.isJSXIdentifier(attribute.name) ||
        !/^on[A-Z]/.test(attribute.name.name) ||
        !t.isJSXExpressionContainer(attribute.value)
      ) {
        return;
      }
      const expression = attribute.value.expression;
      if (expression.start == null || expression.end == null) {
        throw new Error("The benchmark handler has no source location.");
      }
      const opening = path.parentPath.node;
      const selected =
        t.isJSXOpeningElement(opening) &&
        opening.attributes.some(
          (item) =>
            t.isJSXAttribute(item) &&
            t.isJSXIdentifier(item.name, { name: "data-action" }) &&
            t.isStringLiteral(item.value, { value: action }),
        );
      if (selected) {
        if (handler) throw new Error(`Duplicate benchmark action: ${action}`);
        handler = source.slice(expression.start, expression.end);
      } else {
        edits.push({ start: expression.start, end: expression.end });
      }
      path.skip();
    },
  });
  if (!handler) throw new Error(`Missing benchmark action: ${action}`);
  let isolated = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    isolated = `${isolated.slice(0, edit.start)}() => {}${isolated.slice(edit.end)}`;
  }
  return { handler, source: isolated };
}

describe("production compiler dashboard controls", () => {
  for (const reactivity of ["static", "hybrid"] as const) {
    it.each([
      [optimizedAction, 2],
      [snapshotAction, 0],
    ] as const)("keeps %s at %i map hints in " + reactivity, async (action, hints) => {
      const result = await compileReactModule(
        isolateAction(action).source,
        filename,
        normalizeReactCompilerOptions({ reactivity }),
      );

      expect(result.compiled).toContain("StandardTableBenchmark");
      expect(result.diagnostics).toEqual([]);
      expect(result.optimizations.keyedMapUpdateHints).toBe(hints);
      expect(result.code.includes("createCompilerKeyedMapUpdate")).toBe(hints > 0);
    });
  }

  it.each([0, 1, 10, 11, 10_000])(
    "keeps optimized and control native updates equivalent for %i rows",
    (count) => {
      const rows = Object.freeze(
        Array.from({ length: count }, (_, index) =>
          Object.freeze({ id: index + 1, label: `Row ${index}`, amount: index }),
        ),
      );
      const results = [optimizedAction, snapshotAction].map((action) => {
        let next = rows;
        let revision = 0;
        const run = new Function(
          "setRows",
          "setOperation",
          "setRevision",
          `return (${isolateAction(action).handler})();`,
        );
        run(
          (update: (current: typeof rows) => typeof rows) => {
            next = update(rows);
          },
          () => {},
          (update: (value: number) => number) => {
            revision = update(revision);
          },
        );
        expect(revision).toBe(1);
        expect(next).toHaveLength(count);
        for (let index = 0; index < count; index += 1) {
          if (index % 10 === 0) {
            expect(next[index]).toEqual({
              ...rows[index],
              label: `${rows[index].label} reviewed`,
              amount: rows[index].amount + 1,
            });
            expect(next[index]).not.toBe(rows[index]);
          } else {
            expect(next[index]).toBe(rows[index]);
          }
        }
        return next;
      });
      expect(results[0]).toEqual(results[1]);
    },
  );
});
