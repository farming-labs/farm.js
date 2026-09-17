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
const queuedWindowAction = "table-position-window-refresh-queued";
const queuedWindowSnapshotAction = `${queuedWindowAction}-snapshot`;
const batchInsertAction = "table-position-batch-insert";
const reverseAction = "table-reverse";
const reverseSnapshotAction = `${reverseAction}-snapshot`;

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

    it.each([
      [queuedWindowAction, 2],
      [queuedWindowSnapshotAction, 0],
    ] as const)("keeps %s at %i position hints in " + reactivity, async (action, hints) => {
      const result = await compileReactModule(
        isolateAction(action).source,
        filename,
        normalizeReactCompilerOptions({ reactivity }),
      );

      expect(result.compiled).toContain("StandardTableBenchmark");
      expect(result.diagnostics).toEqual([]);
      expect(result.optimizations.keyedArrayPositionHints).toBe(hints);
      expect(result.code.includes("createCompilerKeyedArrayWindowReplace")).toBe(hints > 0);
    });

    it.each([
      [batchInsertAction, 1],
      [`${batchInsertAction}-snapshot`, 0],
    ] as const)("keeps %s at %i batch hints in " + reactivity, async (action, hints) => {
      const result = await compileReactModule(
        isolateAction(action).source,
        filename,
        normalizeReactCompilerOptions({ reactivity }),
      );
      expect(result.compiled).toContain("StandardTableBenchmark");
      expect(result.diagnostics).toEqual([]);
      expect(result.optimizations.keyedArrayPositionHints).toBe(hints);
      expect(result.code.includes("createCompilerKeyedArrayBatchInsert")).toBe(hints > 0);
    });

    it.each([
      [reverseAction, 1],
      [reverseSnapshotAction, 0],
    ] as const)("keeps %s at %i reorder hints in " + reactivity, async (action, hints) => {
      const result = await compileReactModule(
        isolateAction(action).source,
        filename,
        normalizeReactCompilerOptions({ reactivity }),
      );
      expect(result.compiled).toContain("StandardTableBenchmark");
      expect(result.diagnostics).toEqual([]);
      expect(result.optimizations.keyedArrayReorderHints).toBe(hints);
      expect(result.code.includes("createCompilerKeyedArrayReorder")).toBe(hints > 0);
    });
  }

  it.each([0, 1, 2, 11, 10_000])(
    "keeps reversal handlers equivalent across repeated %i-row updates",
    (count) => {
      const rows = Object.freeze(
        Array.from({ length: count }, (_, index) => Object.freeze({ id: index + 1 })),
      );
      const results = [reverseAction, reverseSnapshotAction].map((action) => {
        let next = rows;
        let revision = 0;
        let setterCalls = 0;
        const run = new Function(
          "setRows",
          "setOperation",
          "setRevision",
          `return (${isolateAction(action).handler})();`,
        );
        for (let round = 1; round <= 3; round += 1) {
          const previous = next;
          run(
            (update: (current: typeof rows) => typeof rows) => {
              next = update(previous);
              setterCalls += 1;
            },
            () => {},
            (update: (value: number) => number) => {
              revision = update(revision);
            },
          );
          expect(setterCalls).toBe(round);
          expect(revision).toBe(round);
          expect(next).not.toBe(previous);
          expect(next).toHaveLength(count);
          for (let index = 0; index < count; index += 1) {
            expect(next[index]).toBe(previous[count - 1 - index]);
          }
          Object.freeze(next);
        }
        return next;
      });
      expect(results[0]).toEqual(results[1]);
    },
  );

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

  it("keeps queued window handlers equivalent across repeated 10,000-row updates", () => {
    const rows = Object.freeze(
      Array.from({ length: 10_000 }, (_, index) =>
        Object.freeze({ id: index + 1, label: `Row ${index}`, amount: index }),
      ),
    );
    const results = [queuedWindowAction, queuedWindowSnapshotAction].map((action) => {
      let next = rows;
      let revision = 0;
      let setterCalls = 0;
      const run = new Function(
        "rows",
        "setRows",
        "setOperation",
        "setRevision",
        `return (${isolateAction(action).handler})();`,
      );

      for (let round = 1; round <= 2; round += 1) {
        const previous = next;
        run(
          previous,
          (update: (current: typeof rows) => typeof rows) => {
            // Each queued setter receives the preceding setter's result.
            next = update(next);
            setterCalls += 1;
          },
          () => {},
          (update: (value: number) => number) => {
            revision = update(revision);
          },
        );

        expect(setterCalls).toBe(round * 2);
        expect(revision).toBe(round);
        expect(next).toHaveLength(rows.length);
        for (let index = 0; index < rows.length; index += 1) {
          const refreshed = (index >= 2_500 && index < 2_532) || (index >= 7_500 && index < 7_532);
          const changed = index === 2_516 || index === 7_516;
          expect(next[index]).toEqual({
            ...rows[index],
            label: `${rows[index].label}${" queued".repeat(changed ? round : 0)}`,
            amount: rows[index].amount + (changed ? round : 0),
          });
          if (refreshed) {
            expect(next[index]).not.toBe(previous[index]);
          } else {
            expect(next[index]).toBe(previous[index]);
          }
          Object.freeze(next[index]);
        }
        Object.freeze(next);
      }
      return next;
    });
    expect(results[0]).toEqual(results[1]);
  });
});
