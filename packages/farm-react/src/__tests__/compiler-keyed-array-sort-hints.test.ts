import { describe, expect, it } from "vitest";
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
      name: "a non-reorder intermediate method",
      update: "current.slice().toSorted((left, right) => left.rank - right.rank).toReversed()",
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
});
