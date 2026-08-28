// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedArrayPrependHints.tsx", infer);
}

describe("React AOT keyed-array prepend hints", () => {
  it("records safe immutable prepends for index-independent keyed rows", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => [{ id: "b", label: "Beta" }, ...current])}>
            Prepend
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayPrependHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayPrepend");
    expect(result.code).toContain("prependIndexIndependent={true}");
    expect(result.code).toContain("keyedRowsPrependHintedRuntimeFeature");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedArrayPrependHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedArrayPrepend"),
    });
  });

  it("supports safe prefix batches and the public List primitive", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Feed() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => { const batch = makeRows(); setRows((current) => [...batch, { id: "c", label: "Gamma" }, ...current]); }}>
            Prepend
          </button>
          <ul><List each={rows} by={(row) => row.id}>{(row) => <li>{row.label}</li>}</List></ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.optimizations.keyedArrayPrependHints).toBe(1);
    expect(result.code).toContain("prependIndexIndependent={true}");
  });

  it("selects the combined optional runtime when filter and prepend sites coexist", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => setRows((current) => [{ id: "b", label: "Beta" }, ...current])}>
            Prepend
          </button>
          <button onClick={() => setRows((current) => current.filter((row) => row.id !== "a"))}>
            Remove
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.optimizations.keyedArrayPrependHints).toBe(1);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.code).toContain("keyedRowsFilterPrependHintedRuntimeFeature");
  });

  it.each([
    {
      name: "an index-sensitive row",
      row: "(row, index) => <li key={row.id}>{index}: {row.label}</li>",
      update: 'setRows((current) => [{ id: "b", label: "Beta" }, ...current])',
    },
    {
      name: "a collection-derived key",
      row: "(row) => <li key={row.id + rows.length}>{row.label}</li>",
      update: 'setRows((current) => [{ id: "b", label: "Beta" }, ...current])',
    },
    {
      name: "a block-bodied updater",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: 'setRows((current) => { return [{ id: "b", label: "Beta" }, ...current]; })',
    },
    {
      name: "an append",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: 'setRows((current) => [...current, { id: "b", label: "Beta" }])',
    },
    {
      name: "a middle insertion",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: 'setRows((current) => [current[0], { id: "b", label: "Beta" }, ...current.slice(1)])',
    },
    {
      name: "no new prefix",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "setRows((current) => [...current])",
    },
    {
      name: "a potentially side-effecting prefix",
      row: "(row) => <li key={row.id}>{row.label}</li>",
      update: "setRows((current) => [createRow(), ...current])",
    },
  ])("keeps $name off the prepend fast path", async ({ row, update }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <main>
          <button onClick={() => { ${update}; }}>Prepend</button>
          <ul>{rows.map(${row})}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.optimizations.keyedArrayPrependHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayPrepend");
    expect(result.code).not.toContain("prependIndexIndependent");
  });
});
