// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedArraySliceHints.tsx", infer);
}

describe("React AOT keyed-array slice hints", () => {
  it.each([
    ["drops a prefix", "current.slice(1000)"],
    ["drops a suffix", "current.slice(0, -1000)"],
    ["keeps a middle window", "current.slice(2, 8)"],
    ["keeps a negative tail", "current.slice(-5)"],
  ])("records a native slice that %s", async (_name, update) => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => ${update})}>Trim</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArraySlice");
    expect(result.code).toContain("filterIndexIndependent={true}");
    expect(result.code).toContain("keyedRowsFilterHintedRuntimeFeature");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedArraySliceHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedArraySlice"),
    });
  });

  it("supports the public List primitive and shares the removal runtime with filter", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Feed() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => current.slice(1))}>Trim</button>
          <button onClick={() => setRows((current) => current.filter((row) => row.id !== "a"))}>Remove</button>
          <ul><List each={rows} by={(row) => row.id}>{(row) => <li>{row.label}</li>}</List></ul>
        </main>;
      }
    `);

    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.code).toContain("keyedRowsFilterHintedRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsFilterPrependHintedRuntimeFeature");
  });

  it("records compiler-safe runtime slice bounds", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ offset, bounds, trimTail }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => current.slice(offset))}>Drop prefix</button>
          <button onClick={() => setRows((current) => current.slice(bounds.start, bounds.end))}>Keep window</button>
          <button onClick={() => setRows((current) => current.slice(Math.trunc(offset / 2)))}>Drop calculated prefix</button>
          <button onClick={() => setRows((current) => current.slice(0, trimTail ? -trimTail : current.length))}>Drop suffix</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArraySliceHints).toBe(4);
    expect(result.code.match(/createCompilerKeyedArraySlice\(/g)).toHaveLength(4);
    expect(result.code).toContain("keyedRowsFilterHintedRuntimeFeature");
  });

  it.each([
    {
      name: "an index-sensitive row",
      row: "(row, index) => <li key={row.id}>{index}: {row.label}</li>",
      update: "current.slice(1)",
    },
    {
      name: "a collection-derived key",
      row: "(row) => <li key={row.id + rows.length}>{row.label}</li>",
      update: "current.slice(1)",
    },
    {
      name: "a block-bodied updater",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "{ return current.slice(1); }",
    },
    {
      name: "a fractional start",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "current.slice(1.5)",
    },
    {
      name: "a bound call",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "current.slice(getOffset())",
    },
    {
      name: "a bound assignment",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "current.slice(offset = 1)",
    },
    {
      name: "a bound update expression",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "current.slice(offset++)",
    },
    {
      name: "an unbounded copy",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "current.slice(0)",
    },
    {
      name: "a call without bounds",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "current.slice()",
    },
    {
      name: "a chained slice",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "current.filter(Boolean).slice(1)",
    },
  ])("keeps $name off the slice fast path", async ({ row, update }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ offset = 1, getOffset }: { offset?: number; getOffset?: () => number }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => ${update})}>Trim</button>
          <ul>{rows.map(${row})}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.optimizations.keyedArraySliceHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArraySlice");
  });
});
