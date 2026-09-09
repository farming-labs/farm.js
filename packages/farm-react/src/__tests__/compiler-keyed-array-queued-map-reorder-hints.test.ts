// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true, "/app");

async function compile(source: string) {
  return compileReactModule(source, "/app/QueuedMapReorderHints.tsx", infer);
}

describe("React AOT queued map then reorder hints", () => {
  it("retains two adjacent same-state maps through a following sort", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, rank: nextRank } : row
            ));
            setRows((current) => current.toSorted((left, right) => left.rank - right.rank));
          }}>Edit and sort</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArrayQueuedMapPipeline\(/g)).toHaveLength(2);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(1);
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArraySort");
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
    await expect(
      transformWithEsbuild(result.code, "/app/QueuedMapReorderHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedArrayQueuedMapPipeline"),
    });
  });

  it("retains one standalone safe map through a following reverse", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.toReversed());
          }}>Edit and reverse</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArrayQueuedMapPipeline\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(1);
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayReorder");
  });

  it("composes maps and reorders on both sides of the same queued chain", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.toReversed());
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, rank: nextRank } : row
            ));
            setRows((current) => current.toReversed());
          }}>Edit and preserve order</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.optimizations.keyedArrayReorderHints).toBe(2);
    expect(result.code.match(/createCompilerKeyedArrayQueuedMapPipeline\(/g)).toHaveLength(2);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(2);
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayReorder");
  });

  it("retains mapped lineage through consecutive adjacent reorders", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", rank: 1 },
          { id: "b", rank: 2 },
          { id: "c", rank: 3 },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, rank: nextRank } : row
            ));
            setRows((current) => current.toReversed());
            setRows((current) => current.toSorted((left, right) => left.rank - right.rank));
            setRows((current) => current.toReversed());
          }}>Edit and reorder</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(2);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArrayQueuedMapPipeline\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(3);
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayReorder");
    expect(result.code).not.toContain("createCompilerKeyedArraySort");
  });

  it("continues a same-setter map and reorder pipeline across later reorder setters", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", rank: 1 },
          { id: "b", rank: 2 },
          { id: "c", rank: 3 },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current
              .map((row) => row.id === editedId ? { ...row, rank: nextRank } : row)
              .toReversed()
            );
            setRows((current) => current.toSorted((left, right) => left.rank - right.rank));
            setRows((current) => current.toReversed());
          }}>Edit and reorder</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.optimizations.keyedArrayReorderHints).toBe(2);
    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(3);
    expect(result.code).not.toContain("createCompilerKeyedArrayReorder");
    expect(result.code).not.toContain("createCompilerKeyedArraySort");
  });

  it.each([
    {
      name: "an intervening statement",
      between: "onReordered();",
    },
    {
      name: "a different state setter",
      between: "setOther((current) => current + 1);",
    },
    {
      name: "a structural update",
      between: "setRows((current) => current.filter((row) => row.visible));",
    },
  ])("ends consecutive reorder lineage at $name", async ({ between }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextRank, onReordered }) {
        const [rows, setRows] = useState([
          { id: "a", rank: 1, visible: true },
          { id: "b", rank: 2, visible: false },
        ]);
        const [other, setOther] = useState(0);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, rank: nextRank } : row
            ));
            setRows((current) => current.toReversed());
            ${between}
            setRows((current) => current.toReversed());
          }}>Edit and reorder</button>
          <output>{other}</output>
          <ul>{rows.map((row) => <li key={row.id}>{row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.code.match(/createCompilerKeyedArrayMapReorder\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayReorder\(/g)).toHaveLength(1);
  });

  it.each([
    {
      name: "an intervening statement",
      body: `
        setRows((current) => current.map((row) =>
          row.id === editedId ? { ...row, label: nextLabel } : row
        ));
        onMapped();
        setRows((current) => current.toReversed());
      `,
    },
    {
      name: "a different state setter",
      body: `
        setRows((current) => current.map((row) =>
          row.id === editedId ? { ...row, label: nextLabel } : row
        ));
        setOther((current) => current + 1);
        setRows((current) => current.toReversed());
      `,
    },
    {
      name: "a structural reorder",
      body: `
        setRows((current) => current.map((row) =>
          row.id === editedId ? { ...row, label: nextLabel } : row
        ));
        setRows((current) => current.filter((row) => row.visible).toReversed());
      `,
    },
  ])("does not connect maps across $name", async ({ body }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, onMapped }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", visible: true },
          { id: "b", label: "Beta", visible: false },
        ]);
        const [other, setOther] = useState(0);
        return <section>
          <button onClick={() => { ${body} }}>Update</button>
          <output>{other}</output>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.code).not.toContain("createCompilerKeyedArrayQueuedMapPipeline");
    expect(result.code).not.toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });

  it("does not lower queued map and reorder hints for host-backed rows", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", visible: true },
          { id: "b", label: "Beta", visible: false },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.toReversed());
          }}>Edit and reverse</button>
          <ul>{rows.map((row) => <li key={row.id}>
            <span>{row.label}</span>
            <div>{row.visible && <strong>{row.label}</strong>}</div>
          </li>)}</ul>
        </section>;
      }
    `);

    expect(result.code).toContain("keyedRowsHostReorderHintedRuntimeFeature");
    expect(result.code).not.toContain("createCompilerKeyedArrayQueuedMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapReorder");
  });
});
