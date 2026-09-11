// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedArrayAppendHints.tsx", infer);
}

describe("React AOT keyed-array append hints", () => {
  it("records functional array-literal appends for compiled keyed rows", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => [...current, { id: "b", label: "Beta" }])}>
            Append one
          </button>
          <button onClick={() => { const additions = makeRows(); setRows((current) => [...current, ...additions]); }}>
            Append many
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayAppendHints).toBe(2);
    expect(result.code).toContain("createCompilerKeyedArrayAppend");
    expect(result.code).toContain("keyedRowsHintedRuntimeFeature");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedArrayAppendHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedArrayAppend"),
    });
  });

  it("supports the public List primitive without another option", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Inventory() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => [...current, { id: "b", label: "Beta" }])}>
            Append
          </button>
          <ul>
            <List each={rows} by={(row) => row.id}>
              {(row) => <li>{row.label}</li>}
            </List>
          </ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.optimizations.keyedArrayAppendHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayAppend");
    expect(result.code).toContain("collectionDependency={0}");
  });

  it("emits composable filter and append hints for adjacent queued setters", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory({ expiredId, incoming }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => {
            setRows((current) => current.filter((row) => row.id !== expiredId));
            setRows((current) => [...current, incoming]);
          }}>
            Replace expired row
          </button>
          <button onClick={() => setRows((current) => current.toReversed())}>Reverse</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArrayAppendHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayFilter");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralAppend");
    expect(result.code).toContain("keyedRowsStructuralAppendHintedRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsFilterHintedRuntimeFeature");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedArrayAppendHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedArrayAppend"),
    });
  });

  it("links a bounded slice to multiple following append setters", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory({ incoming, extra }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
          { id: "d", label: "Delta" },
        ]);
        return <main>
          <button onClick={() => {
            setRows((current) => current.slice(1, 3));
            setRows((current) => [...current, incoming]);
            setRows((current) => [...current, extra]);
          }}>
            Replace edges
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.optimizations.keyedArrayAppendHints).toBe(2);
    expect(result.code).toContain("createCompilerKeyedArraySlice");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralAppend");
    expect(result.code).toContain("keyedRowsStructuralAppendHintedRuntimeFeature");
  });

  it("retains structural append lineage through following safe map setters", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory({ expiredId, incoming, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => {
            setRows((current) => current.slice(1));
            setRows((current) => [...current, incoming]);
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.map((row) =>
              row.id === incoming.id ? { ...row, selected: true } : row
            ));
          }}>
            Refresh rows
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.optimizations.keyedArrayAppendHints).toBe(1);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.code).toContain("createCompilerKeyedArrayStructuralAppend");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralAppendMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline as");
    expect(result.code).toContain("keyedRowsStructuralAppendMapHintedRuntimeFeature");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedArrayAppendHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedArrayStructuralAppendMapPipeline"),
    });
  });

  it("does not link a map across an intervening statement after structural append", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory({ expiredId, incoming, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => {
            setRows((current) => current.slice(1));
            setRows((current) => [...current, incoming]);
            logRefresh();
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
          }}>
            Refresh rows
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.optimizations.keyedArrayAppendHints).toBe(1);
    expect(result.code).not.toContain("createCompilerKeyedArrayStructuralAppendMapPipeline");
  });

  it("retains filtered survivor lineage through following safe map setters", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory({ expiredId, incoming, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => {
            setRows((current) => current.filter((row) => row.id !== expiredId));
            setRows((current) => [...current, incoming]);
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
          }}>
            Refresh rows
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArrayAppendHints).toBe(1);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayStructuralAppend");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralAppendMapPipeline");
    expect(result.code).toContain("keyedRowsStructuralAppendMapHintedRuntimeFeature");
  });

  it("retains structural append lineage when a safe map runs before the append", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory({ expiredId, incoming, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => {
            setRows((current) => current.filter((row) => row.id !== expiredId));
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => [...current, incoming]);
          }}>
            Refresh rows
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArrayAppendHints).toBe(1);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("createCompilerKeyedArrayMappedStructuralAppend");
    expect(result.code).not.toContain("createCompilerKeyedArrayStructuralAppend as");
    expect(result.code).not.toContain("createCompilerKeyedArrayStructuralAppendMapPipeline as");
    expect(result.code).toContain("keyedRowsStructuralAppendMapHintedRuntimeFeature");
  });

  it("does not link a mapped structural append across intervening work", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory({ expiredId, incoming, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => {
            setRows((current) => current.filter((row) => row.id !== expiredId));
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            logRefresh();
            setRows((current) => [...current, incoming]);
          }}>
            Refresh rows
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.code).not.toContain("createCompilerKeyedArrayMappedStructuralAppend");
    expect(result.code).not.toContain("keyedRowsStructuralAppendMapHintedRuntimeFeature");
  });

  it("retains a safe map through a following structural removal and append", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory({ expiredId, incoming, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.filter((row) => row.id !== expiredId));
            setRows((current) => [...current, incoming]);
          }}>
            Refresh rows
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArrayAppendHints).toBe(1);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayQueuedMapPipeline");
    expect(result.code).toContain("finalizeCompilerKeyedArrayMappedStructuralUpdate");
    expect(result.code).toContain("createCompilerKeyedArrayMappedStructuralAppend");
    expect(result.code).toContain("keyedRowsStructuralAppendMapHintedRuntimeFeature");
  });

  it("does not hint a collection when an existing row key reads its length", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => [...current, { id: "b", label: "Beta" }])}>
            Append
          </button>
          <ul>{rows.map((row) => <li key={row.id + rows.length}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.optimizations.keyedArrayAppendHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayAppend");
  });

  it.each([
    {
      name: "a captured direct replacement",
      update: 'setRows([...rows, { id: "b", label: "Beta" }])',
    },
    {
      name: "a prepend",
      update: 'setRows((current) => [{ id: "b", label: "Beta" }, ...current])',
    },
    {
      name: "a middle spread",
      update:
        'setRows((current) => [{ id: "b", label: "Beta" }, ...current, { id: "c", label: "Gamma" }])',
    },
    {
      name: "a copy without appended entries",
      update: "setRows((current) => [...current])",
    },
    {
      name: "a block-bodied updater",
      update:
        'setRows((current) => { const next = [...current, { id: "b", label: "Beta" }]; return next; })',
    },
    {
      name: "a side-effecting trailing call",
      update: "setRows((current) => [...current, ...makeRows(current)])",
    },
  ])("does not hint $name", async ({ update }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => { ${update}; }}>Update</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.optimizations.keyedArrayAppendHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayAppend");
  });
});
