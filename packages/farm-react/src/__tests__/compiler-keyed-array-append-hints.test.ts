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
