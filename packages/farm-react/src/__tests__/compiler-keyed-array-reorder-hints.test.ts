// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true, "/app");

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedArrayReorderHints.tsx", infer);
}

describe("React AOT keyed-array reorder hints", () => {
  it("records a direct native reverse for index-independent keyed rows", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current.toReversed())}>Reverse</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayReorder");
    expect(result.code).toContain("keyedRowsReorderHintedRuntimeFeature");
    expect(result.code).toContain("reorderIndexIndependent");
  });

  it("records a direct native reverse returned from an exact updater block", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]);
        return <section>
          <button onClick={() => setRows((current) => {
            return current.toReversed();
          })}>Reverse</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayReorder");
    expect(result.code).toContain("keyedRowsReorderHintedRuntimeFeature");
    expect(result.code).toContain("reorderIndexIndependent");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedArrayReorderHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedArrayReorder"),
    });
  });

  it("retains the combined optional runtime when reorder and another array hint coexist", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ next }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => setRows((current) => current.toReversed())}>Reverse</button>
          <button onClick={() => setRows((current) => current.with(0, next))}>Replace</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.optimizations.keyedArrayPositionHints).toBe(1);
    expect(result.code).toContain("keyedRowsEveryHintedRuntimeFeature");
  });

  it.each([
    {
      name: "an index-dependent row",
      row: "(row, index) => <li key={row.id}>{index}: {row.label}</li>",
      update: "current.toReversed()",
    },
    {
      name: "an updater block with a local declaration",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "{ const next = current.toReversed(); return next; }",
    },
    {
      name: "an updater block with conditional returns",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "{ if (current.length > 1) return current.toReversed(); return current; }",
    },
    {
      name: "an updater block without a return",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "{ current.toReversed(); }",
    },
    {
      name: "an updater block with a directive",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: '{ "use strict"; return current.toReversed(); }',
    },
    {
      name: "an argument",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.toReversed(true)",
    },
    {
      name: "a computed method",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: 'current["toReversed"]()',
    },
    {
      name: "a chained transform",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.slice().toReversed()",
    },
  ])("keeps $name off the reorder fast path", async ({ row, update }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => setRows((current) => ${update})}>Reverse</button>
          <ul>{rows.map(${row})}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArrayReorderHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayReorder");
  });
});
