// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedArrayFilterHints.tsx", infer);
}

describe("React AOT keyed-array filter hints", () => {
  it("records concise immutable filters for index-independent keyed rows", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => current.filter((row) => row.id !== "a"))}>
            Remove
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayFilter");
    expect(result.code).toContain("filterIndexIndependent={true}");
    expect(result.code).toContain("keyedRowsFilterHintedRuntimeFeature");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedArrayFilterHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedArrayFilter"),
    });
  });

  it("supports the public List primitive", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Inventory() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => current.filter((row) => row.id !== "a"))}>
            Remove
          </button>
          <ul><List each={rows} by={(row) => row.id}>{(row) => <li>{row.label}</li>}</List></ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.code).toContain("filterIndexIndependent={true}");
  });

  it.each([
    {
      name: "an index-sensitive row",
      row: "(row, index) => <li key={row.id}>{index}: {row.label}</li>",
      update: "setRows((current) => current.filter((row) => row.id !== 'a'))",
    },
    {
      name: "a collection-derived key",
      row: "(row) => <li key={row.id + rows.length}>{row.label}</li>",
      update: "setRows((current) => current.filter((row) => row.id !== 'a'))",
    },
    {
      name: "a block-bodied updater",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update:
        "setRows((current) => { const next = current.filter((row) => row.id !== 'a'); return next; })",
    },
    {
      name: "a block-bodied predicate",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "setRows((current) => current.filter((row) => { return row.id !== 'a'; }))",
    },
    {
      name: "an index-aware predicate",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "setRows((current) => current.filter((row, index) => index !== 0))",
    },
    {
      name: "a potentially side-effecting predicate",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "setRows((current) => current.filter((row) => shouldKeep(row)))",
    },
    {
      name: "a filter thisArg",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "setRows((current) => current.filter((row) => row.id !== 'a', scope))",
    },
  ])("keeps $name on complete reconciliation", async ({ row, update }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => { ${update}; }}>Remove</button>
          <ul>{rows.map(${row})}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.optimizations.keyedArrayFilterHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayFilter");
    expect(result.code).not.toContain("filterIndexIndependent");
  });
});
