import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true, "/app");

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedArrayPositionHints.tsx", infer);
}

describe("React AOT keyed-array position hints", () => {
  it("records native known-position insertion, removal, and replacement", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ next }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => setRows((current) => current.toSpliced(1, 0, next))}>Insert</button>
          <button onClick={() => setRows((current) => current.toSpliced(0, 1))}>Remove</button>
          <button onClick={() => setRows((current) => current.with(0, next))}>Replace</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.optimizations.keyedArrayPositionHints).toBe(3);
    expect(result.code).toContain("createCompilerKeyedArrayPositionUpdate");
    expect(result.code).toContain("keyedRowsPositionHintedRuntimeFeature");
  });

  it("supports safe static negative positions", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ next }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => setRows((current) => current.with(-1, next))}>Replace</button>
          <button onClick={() => setRows((current) => current.toSpliced(-1, 1))}>Remove</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArrayPositionHints).toBe(2);
  });

  it.each([
    {
      name: "an index-dependent row",
      row: "(row, index) => <li key={row.id}>{index}: {row.label}</li>",
      update: "current.with(0, next)",
    },
    {
      name: "a dynamic position",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.with(offset, next)",
    },
    {
      name: "a block-bodied updater",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "{ return current.with(0, next); }",
    },
    {
      name: "a block-bodied removal updater",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "{ return current.toSpliced(0, 1); }",
    },
    {
      name: "an unsafe incoming call",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.with(0, makeNext())",
    },
    {
      name: "a zero-count removal",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.toSpliced(0, 0)",
    },
    {
      name: "a multi-item removal",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.toSpliced(0, 2)",
    },
    {
      name: "a dynamic removal count",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.toSpliced(0, deleteCount)",
    },
    {
      name: "a computed removal method",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: 'current["toSpliced"](0, 1)',
    },
    {
      name: "a chained removal source",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.slice().toSpliced(0, 1)",
    },
    {
      name: "a multi-item insertion",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.toSpliced(0, 0, next, next)",
    },
    {
      name: "a direct toSpliced replacement",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "current.toSpliced(0, 1, next)",
    },
  ])("keeps $name off the position fast path", async ({ row, update }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ next, offset, deleteCount, makeNext }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => setRows((current) => ${update})}>Change</button>
          <ul>{rows.map(${row})}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArrayPositionHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayPositionUpdate");
  });
});
