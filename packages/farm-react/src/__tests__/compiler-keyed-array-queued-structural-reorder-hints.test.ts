// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true, "/app");

async function compile(source: string) {
  return compileReactModule(source, "/app/QueuedStructuralReorderHints.tsx", infer);
}

describe("React AOT queued structural reorder hints", () => {
  it("retains structural and mapped lineage through a following reverse", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, hiddenId }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.filter((row) => row.id !== hiddenId));
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.toReversed());
          }}>Trim, edit, and reverse</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("createCompilerKeyedArrayFilter");
    expect(result.code).toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralReorder");
    expect(result.code).not.toContain("createCompilerKeyedArrayQueuedMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
    await expect(
      transformWithEsbuild(result.code, "/app/QueuedStructuralReorderHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedArrayStructuralReorder"),
    });
  });

  it("composes maps on both sides of structural work before a sort", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, nextRank, hiddenId }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
          { id: "c", label: "Gamma", rank: 3 },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.filter((row) => row.id !== hiddenId));
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, rank: nextRank } : row
            ));
            setRows((current) => current.toSorted((left, right) => left.rank - right.rank));
          }}>Edit, trim, edit, and sort</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.code).toContain("createCompilerKeyedArrayQueuedMapPipeline");
    expect(result.code).toContain("finalizeCompilerKeyedArrayMappedStructuralUpdate");
    expect(result.code).toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralSort");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
    expect(result.code).not.toContain("createCompilerKeyedArraySort");
  });

  it("keeps structural lineage through reorders and later maps", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, hiddenId }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.filter((row) => row.id !== hiddenId));
            setRows((current) => current.toReversed());
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.toSorted());
          }}>Trim, reverse, edit, and sort</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.code).toContain("createCompilerKeyedArrayStructuralReorder");
    expect(result.code).toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralSort");
    expect(result.code).not.toContain("createCompilerKeyedArrayQueuedMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
  });

  it("switches an existing mapped reorder to structural lineage after a filter", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", rank: 1, visible: true },
          { id: "b", rank: 2, visible: false },
          { id: "c", rank: 3, visible: true },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, rank: nextRank } : row
            ));
            setRows((current) => current.toReversed());
            setRows((current) => current.filter((row) => row.visible));
            setRows((current) => current.toReversed());
          }}>Edit and reorder</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayStructuralReorder\(/g)).toHaveLength(1);
    expect(result.code).not.toContain("createCompilerKeyedArrayReorder");
  });

  it("rewrites a map and reorder pipeline after an adjacent structural setter", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, hiddenId }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.filter((row) => row.id !== hiddenId));
            setRows((current) => current
              .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
              .toReversed()
            );
          }}>Update</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.code).toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralReorder");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
  });

  it.each([
    {
      name: "an intervening statement",
      updates: `
        setRows((current) => current.filter((row) => row.id !== hiddenId));
        onFiltered();
        setRows((current) => current.toReversed());
      `,
    },
    {
      name: "another state setter",
      updates: `
        setRows((current) => current.filter((row) => row.id !== hiddenId));
        setSelected(editedId);
        setRows((current) => current.toReversed());
      `,
    },
    {
      name: "an unsupported map",
      updates: `
        setRows((current) => current.filter((row) => row.id !== hiddenId));
        setRows((current) => current.map((row) => ({ ...row, label: nextLabel })));
        setRows((current) => current.toReversed());
      `,
    },
  ])("keeps the complete fallback across $name", async ({ updates }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, hiddenId, onFiltered }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]);
        const [selected, setSelected] = useState(null);
        return <section data-selected={selected ?? "none"}>
          <button onClick={() => { ${updates} }}>Update</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.code).toContain("createCompilerKeyedArrayReorder");
    expect(result.code).not.toContain("createCompilerKeyedArrayStructuralReorder");
  });

  it("keeps host-backed keyed rows on complete reconciliation", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", visible: true },
          { id: "b", label: "Beta", visible: false },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.filter((row) => row.visible));
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.toReversed());
          }}>Update</button>
          <ul>{rows.map((row) => <li key={row.id}>
            <span>{row.label}</span>
            <div>{row.visible && <strong>Visible</strong>}</div>
          </li>)}</ul>
        </section>;
      }
    `);

    expect(result.code).toContain("keyedRowsHostEveryHintedRuntimeFeature");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayStructuralReorder");
  });
});
