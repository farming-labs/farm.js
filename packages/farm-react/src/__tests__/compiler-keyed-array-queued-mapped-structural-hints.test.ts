// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true, "/app");

async function compile(source: string) {
  return compileReactModule(source, "/app/QueuedMappedStructuralHints.tsx", infer);
}

describe("React AOT queued mapped structural hints", () => {
  it("retains adjacent maps through following filter and slice setters", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, nextRank, hiddenId, limit }) {
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
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, rank: nextRank } : row
            ));
            setRows((current) => current.filter((row) => row.id !== hiddenId));
            setRows((current) => current.slice(0, limit));
          }}>Edit and trim</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArrayQueuedMapPipeline\(/g)).toHaveLength(2);
    expect(result.code.match(/finalizeCompilerKeyedArrayMappedStructuralUpdate\(/g)).toHaveLength(
      2,
    );
    expect(result.code).not.toContain("createCompilerKeyedMapUpdate");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("keyedRowsEveryHintedRuntimeFeature");
    await expect(
      transformWithEsbuild(result.code, "/app/QueuedMappedStructuralHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("finalizeCompilerKeyedArrayMappedStructuralUpdate"),
    });
  });

  it.each([
    {
      name: "an intervening statement",
      updates: `
        setRows((current) => current.map((row) =>
          row.id === editedId ? { ...row, label: nextLabel } : row
        ));
        onMapped();
        setRows((current) => current.filter((row) => row.id !== hiddenId));
      `,
    },
    {
      name: "another state setter",
      updates: `
        setRows((current) => current.map((row) =>
          row.id === editedId ? { ...row, label: nextLabel } : row
        ));
        setSelected(editedId);
        setRows((current) => current.filter((row) => row.id !== hiddenId));
      `,
    },
    {
      name: "structural work before the map",
      updates: `
        setRows((current) => current.filter((row) => row.id !== hiddenId));
        setRows((current) => current.map((row) =>
          row.id === editedId ? { ...row, label: nextLabel } : row
        ));
      `,
    },
    {
      name: "an unsupported map callback",
      updates: `
        setRows((current) => current.map((row) => ({ ...row, label: nextLabel })));
        setRows((current) => current.filter((row) => row.id !== hiddenId));
      `,
    },
  ])("keeps complete fallback across $name", async ({ updates }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, hiddenId, onMapped }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]);
        const [selected, setSelected] = useState(null);
        return <section data-selected={selected ?? "none"}>
          <button onClick={() => {
            ${updates}
          }}>Update</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.code).not.toContain("createCompilerKeyedArrayQueuedMapPipeline");
    expect(result.code).not.toContain("finalizeCompilerKeyedArrayMappedStructuralUpdate");
  });
});
