// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true, "/app");

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedArraySortHints.tsx", infer);
}

describe("React AOT keyed-array sort hints", () => {
  it("records a direct native sort for index-independent keyed rows", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState([
          { id: "a", rank: 2, label: "Alpha" },
          { id: "b", rank: 1, label: "Beta" },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current.toSorted((left, right) => left.rank - right.rank))}>Sort</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArraySort");
    expect(result.code).toContain("keyedRowsReorderHintedRuntimeFeature");
    expect(result.code).toContain("reorderIndexIndependent");
  });

  it("supports the native default comparator and shares the reorder runtime with reverse", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState(["beta", "alpha"]);
        return <section>
          <button onClick={() => setRows((current) => current.toSorted())}>Sort</button>
          <button onClick={() => setRows((current) => current.toReversed())}>Reverse</button>
          <ul>{rows.map((row) => <li key={row}>{row}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArraySort");
    expect(result.code).toContain("createCompilerKeyedArrayReorder");
    expect(result.code).toContain("keyedRowsReorderHintedRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsEveryHintedRuntimeFeature");
  });

  it("emits every native reorder in one queued sort and reverse chain", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState([
          { id: "a", rank: 2, label: "Alpha" },
          { id: "b", rank: 1, label: "Beta" },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.toSorted((left, right) => left.rank - right.rank));
            setRows((current) => current.toReversed());
            setRows((current) => current.toReversed());
            setRows((current) => current.toSorted((left, right) => right.rank - left.rank));
          }}>Reorder</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArraySortHints).toBe(2);
    expect(result.optimizations.keyedArrayReorderHints).toBe(2);
    expect(result.code).toContain("createCompilerKeyedArraySort");
    expect(result.code).toContain("createCompilerKeyedArrayReorder");
    expect(result.code).toContain("keyedRowsReorderHintedRuntimeFeature");
  });

  it("lowers every step in one native sort and reverse pipeline", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState([
          { id: "a", rank: 2, label: "Alpha" },
          { id: "b", rank: 1, label: "Beta" },
        ]);
        return <section>
          <button onClick={() => setRows((current) =>
            current
              .toSorted((left, right) => left.rank - right.rank)
              .toReversed()
              .toSorted((left, right) => right.rank - left.rank)
          )}>Reorder</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.optimizations.keyedArraySortHints).toBe(2);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArraySort\(/g)).toHaveLength(2);
    expect(result.code.match(/createCompilerKeyedArrayReorder\(/g)).toHaveLength(1);
    expect(result.code).toContain("keyedRowsReorderHintedRuntimeFeature");
  });

  it("supports a reverse-first pipeline and the native default comparator", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState(["beta", "alpha"]);
        return <section>
          <button onClick={() => setRows((current) =>
            current.toReversed().toSorted().toReversed()
          )}>Reorder</button>
          <ul>{rows.map((row) => <li key={row}>{row}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(2);
    expect(result.code.match(/createCompilerKeyedArraySort\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayReorder\(/g)).toHaveLength(2);
  });

  it("lowers a structural prefix followed by native reorder steps", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState([
          { id: "a", rank: 2, visible: true, label: "Alpha" },
          { id: "b", rank: 1, visible: false, label: "Beta" },
          { id: "c", rank: 3, visible: true, label: "Gamma" },
        ]);
        return <section>
          <button onClick={() => setRows((current) =>
            current
              .filter((row) => row.visible)
              .slice(0, 2)
              .toSorted((left, right) => left.rank - right.rank)
              .toReversed()
          )}>Keep and reorder</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArrayFilter\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArraySlice\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayStructuralSort\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayStructuralReorder\(/g)).toHaveLength(1);
    expect(result.code).not.toContain("createCompilerKeyedArraySort");
    expect(result.code).not.toContain("createCompilerKeyedArrayReorder");
    expect(result.code).toContain("keyedRowsEveryHintedRuntimeFeature");
  });

  it("lowers a same-key map followed by a native sort as one reorder pipeline", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .map((row) => row.id === editedId ? { ...row, rank: nextRank } : row)
            .toSorted((left, right) => left.rank - right.rank)
          )}>Edit and sort</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("createCompilerKeyedArrayMapReorder");
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
    expect(result.code).toContain("reorderIndexIndependent");
    expect(result.code).not.toContain("createCompilerKeyedMapUpdate");
    expect(result.code).not.toContain("createCompilerKeyedArraySort");
  });

  it("keeps each reorder step in a mapped sort and reverse pipeline", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .map((row) => row.id === editedId ? { ...row, rank: row.rank + 1 } : row)
            .toSorted((left, right) => left.rank - right.rank)
            .toReversed()
          )}>Edit and reorder</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder/g)).toHaveLength(4);
  });

  it("composes multiple safe maps before native reorder steps", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextRank, nextLabel }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
            .map((row) => row.id === editedId ? { ...row, rank: nextRank } : row)
            .toSorted((left, right) => left.rank - right.rank)
            .toReversed()
          )}>Edit and reorder</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArrayMapPipeline\(/g)).toHaveLength(1);
    expect(result.code.match(/_farmApplyMap\d*\(/g)).toHaveLength(2);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(2);
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
    expect(result.code).not.toContain("createCompilerKeyedMapUpdate");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedArraySortHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedArrayMapPipeline"),
    });
  });

  it("groups multiple safe maps before a direct native reverse", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextRank, nextLabel }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
            .map((row) => row.id === editedId ? { ...row, rank: nextRank } : row)
            .toReversed()
          )}>Edit and reverse</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.optimizations.keyedArraySortHints).toBe(0);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArrayMapPipeline\(/g)).toHaveLength(1);
    expect(result.code.match(/_farmApplyMap\d*\(/g)).toHaveLength(2);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(1);
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });

  it("carries a structured block-bodied map through a native sort", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ firstId, secondId }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .map((row) => {
              const matchesFirst = row.id === firstId;
              if (matchesFirst) return { ...row, rank: 4 };
              const matchesSecond = row.id === secondId;
              if (matchesSecond) return { ...row, rank: 3 };
              return row;
            })
            .toSorted((left, right) => left.rank - right.rank)
          )}>Edit and sort</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("createCompilerKeyedArrayMapReorder");
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });

  it("preserves every step in an exact mapped reverse-parity pipeline", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
            .toReversed()
            .toReversed()
            .toReversed()
          )}>Edit and reverse</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(3);
    expect(result.code.match(/createCompilerKeyedArrayMapPipeline\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(3);
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });

  it("preserves reverse and map metadata across separately queued setters", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.toReversed());
            setRows((current) => current
              .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
              .toReversed()
            );
          }}>Edit without changing final order</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(2);
    expect(result.code.match(/createCompilerKeyedArrayReorder\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayMapPipeline\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(1);
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });

  it("preserves an exact reverse when consecutive safe maps are the final steps", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .toReversed()
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
            .map((row) => row.id === editedId ? { ...row, rank: nextRank } : row)
          )}>Reverse and edit</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArrayReorder\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayMapPipeline\(/g)).toHaveLength(1);
    expect(result.code.match(/_farmApplyMap\d*\(/g)).toHaveLength(2);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g) || []).toHaveLength(0);
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });

  it("carries mapped lineage through reorder steps on both sides of a safe map", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .toSorted((left, right) => left.rank - right.rank)
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
            .toReversed()
          )}>Sort, edit, and reverse</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArraySort\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayMapPipeline\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(1);
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });

  it("does not lower map and reorder pipelines for host-backed keyed rows", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1, visible: true },
          { id: "b", label: "Beta", rank: 2, visible: false },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .map((row) => row.id === editedId ? { ...row, rank: nextRank } : row)
            .toSorted((left, right) => left.rank - right.rank)
          )}>Edit and sort</button>
          <ul>{rows.map((row) => (
            <li key={row.id}>
              <span>{row.label}: {row.rank}</span>
              <div>{row.visible && <strong>{row.label}</strong>}</div>
            </li>
          ))}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("keyedRowsHostRuntimeFeature");
    expect(result.optimizations.keyedMapUpdateHints).toBe(0);
    expect(result.optimizations.keyedArraySortHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
  });

  it.each([
    {
      name: "an unconditional replacement",
      pipeline:
        "current.map((row) => ({ ...row, rank: row.rank + 1 })).toSorted((a, b) => a.rank - b.rank)",
    },
    {
      name: "a referenced mapper",
      declaration: "const updateRow = (row) => row.id === editedId ? { ...row, rank: 0 } : row;",
      pipeline: "current.map(updateRow).toSorted((a, b) => a.rank - b.rank)",
    },
    {
      name: "a mutable block-local alias",
      pipeline:
        "current.map((row) => { let matches = row.id === editedId; return matches ? { ...row, rank: 0 } : row; }).toSorted((a, b) => a.rank - b.rank)",
    },
    {
      name: "an unsupported second mapper",
      pipeline:
        "current.map((row) => row.id === editedId ? { ...row, rank: 0 } : row).map((row) => ({ ...row, rank: row.rank + 1 })).toSorted((a, b) => a.rank - b.rank)",
    },
    {
      name: "a map thisArg",
      pipeline:
        "current.map((row) => row.id === editedId ? { ...row, rank: 0 } : row, null).toSorted((a, b) => a.rank - b.rank)",
    },
    {
      name: "a computed map method",
      pipeline:
        'current["map"]((row) => row.id === editedId ? { ...row, rank: 0 } : row).toSorted((a, b) => a.rank - b.rank)',
    },
    {
      name: "a map after a structural reorder",
      pipeline:
        "current.filter((row) => row.rank > 0).toReversed().map((row) => row.id === editedId ? { ...row, rank: 0 } : row)",
    },
  ])("keeps $name on complete reconciliation", async ({ declaration = "", pipeline }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId }) {
        const [rows, setRows] = useState([{ id: "a", rank: 1 }]);
        ${declaration}
        return <section>
          <button onClick={() => setRows((current) => ${pipeline})}>Update</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArraySortHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).not.toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });

  it("keeps mapped lineage when filter or slice ends the pipeline", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, limit }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", visible: true },
          { id: "b", label: "Beta", visible: false },
          { id: "c", label: "Gamma", visible: true },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
            .filter((row) => row.visible)
          )}>Map and filter</button>
          <button onClick={() => setRows((current) => current
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
            .slice(1, limit)
          )}>Map and slice</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(0);
    expect(result.code.match(/createCompilerKeyedArrayMapPipeline\(/g)).toHaveLength(2);
    expect(result.code).toContain("createCompilerKeyedArrayFilter");
    expect(result.code).toContain("createCompilerKeyedArraySlice");
    expect(result.code.match(/finalizeCompilerKeyedArrayMappedStructuralUpdate\(/g)).toHaveLength(
      2,
    );
    expect(result.code).toContain("keyedRowsEveryHintedRuntimeFeature");
    expect(result.code).not.toContain("createCompilerKeyedArrayStructuralReorder");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
  });

  it("carries mapped row lineage through a following filter and sort", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", rank: 1, visible: true },
          { id: "b", rank: 2, visible: false },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .map((row) => row.id === editedId ? { ...row, rank: nextRank } : row)
            .filter((row) => row.visible)
            .toSorted((left, right) => left.rank - right.rank)
          )}>Update</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("createCompilerKeyedArrayFilter");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralSort");
    expect(result.code).toContain("keyedRowsEveryHintedRuntimeFeature");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
  });

  it("carries mapped row lineage between filter, slice, and sort steps", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, nextRank, limit }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1, visible: true },
          { id: "b", label: "Beta", rank: 2, visible: false },
          { id: "c", label: "Gamma", rank: 3, visible: true },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .filter((row) => row.visible)
            .map((row) => row.id === editedId ? { ...row, rank: nextRank } : row)
            .slice(0, limit)
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
            .toSorted((left, right) => left.rank - right.rank)
          )}>Update</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayFilter");
    expect(result.code).toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("createCompilerKeyedArraySlice");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralSort");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
  });

  it("keeps structural lineage when a safe map ends the pipeline", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, limit }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", visible: true },
          { id: "b", label: "Beta", visible: false },
          { id: "c", label: "Gamma", visible: true },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .filter((row) => row.visible)
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
          )}>Filter and update</button>
          <button onClick={() => setRows((current) => current
            .slice(0, limit)
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
          )}>Slice and update</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(0);
    expect(result.code.match(/createCompilerKeyedArrayMapPipeline\(/g)).toHaveLength(2);
    expect(result.code).toContain("createCompilerKeyedArrayFilter");
    expect(result.code).toContain("createCompilerKeyedArraySlice");
    expect(result.code).toContain("keyedRowsEveryHintedRuntimeFeature");
    expect(result.code).not.toContain("createCompilerKeyedArrayStructuralReorder");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
  });

  it("carries consecutive maps through slice and reverse steps", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, offset }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
          { id: "c", label: "Gamma", rank: 3 },
        ]);
        return <section>
          <button onClick={() => setRows((current) => current
            .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
            .map((row) => row.id === editedId ? { ...row, rank: row.rank + 1 } : row)
            .slice(offset)
            .toReversed()
            .toReversed()
          )}>Update</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(2);
    expect(result.code.match(/createCompilerKeyedArrayMapPipeline\(/g)).toHaveLength(1);
    expect(result.code).toContain("createCompilerKeyedArraySlice");
    expect(result.code.match(/createCompilerKeyedArrayStructuralReorder\(/g)).toHaveLength(2);
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
  });

  it.each([
    {
      name: "a referenced comparator",
      declaration: "const compare = (left, right) => left.rank - right.rank;",
      update: "current.toSorted(compare).toReversed()",
    },
    {
      name: "a computed outer method",
      update: 'current.toSorted((left, right) => left.rank - right.rank)["toReversed"]()',
    },
    {
      name: "a no-op slice without a structural hint",
      update: "current.slice().toSorted((left, right) => left.rank - right.rank).toReversed()",
    },
    {
      name: "a structural method after reordering",
      update:
        "current.toSorted((left, right) => left.rank - right.rank).filter((row) => row.visible)",
    },
    {
      name: "a referenced filter predicate",
      declaration: "const visible = (row) => row.visible;",
      update: "current.filter(visible).toReversed()",
    },
    {
      name: "an invalid reverse argument",
      update: "current.toSorted((left, right) => left.rank - right.rank).toReversed(true)",
    },
  ])(
    "keeps a pipeline with $name off the reorder fast path",
    async ({ declaration = "", update }) => {
      const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState([{ id: "a", rank: 1, label: "Alpha" }]);
        ${declaration}
        return <section>
          <button onClick={() => setRows((current) => ${update})}>Reorder</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

      expect(result.optimizations.keyedArraySortHints).toBe(0);
      expect(result.optimizations.keyedArrayReorderHints).toBe(0);
      expect(result.code).not.toContain("createCompilerKeyedArraySort");
      expect(result.code).not.toContain("createCompilerKeyedArrayReorder");
    },
  );

  it.each([
    {
      name: "an index-dependent row",
      row: "(row, index) => <li key={row.id}>{index}: {row.label}</li>",
      update: "current.toSorted((left, right) => left.rank - right.rank)",
    },
    {
      name: "a block-bodied updater",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "{ return current.toSorted((left, right) => left.rank - right.rank); }",
    },
    {
      name: "a referenced comparator",
      declaration: "const compare = (left, right) => left.rank - right.rank;",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.toSorted(compare)",
    },
    {
      name: "a one-parameter comparator",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.toSorted((row) => row.rank)",
    },
    {
      name: "an async comparator",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.toSorted(async (left, right) => left.rank - right.rank)",
    },
    {
      name: "a multi-statement comparator",
      row: "row => <li key={row.id}>{row.label}</li>",
      update:
        "current.toSorted((left, right) => { const difference = left.rank - right.rank; return difference; })",
    },
    {
      name: "a computed method",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: 'current["toSorted"]((left, right) => left.rank - right.rank)',
    },
    {
      name: "a chained transform",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.slice().toSorted((left, right) => left.rank - right.rank)",
    },
  ])("keeps $name off the sort fast path", async ({ declaration = "", row, update }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState([{ id: "a", rank: 1, label: "Alpha" }]);
        ${declaration}
        return <section>
          <button onClick={() => setRows((current) => ${update})}>Sort</button>
          <ul>{rows.map(${row})}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArraySortHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArraySort");
  });

  it("keeps an index-dependent structural reorder on complete reconciliation", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table() {
        const [rows, setRows] = useState([
          { id: "a", rank: 2, visible: true },
          { id: "b", rank: 1, visible: false },
        ]);
        return <section>
          <button onClick={() => setRows((current) =>
            current
              .filter((row) => row.visible)
              .toSorted((left, right) => left.rank - right.rank)
          )}>Keep and sort</button>
          <ul>{rows.map((row, index) => <li key={row.id}>{index}: {row.id}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArrayFilterHints).toBe(0);
    expect(result.optimizations.keyedArraySortHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayFilter");
    expect(result.code).not.toContain("createCompilerKeyedArraySort");
  });
});
