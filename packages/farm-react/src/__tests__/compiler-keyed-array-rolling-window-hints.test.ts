import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true, "/app");

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedArrayRollingWindowHints.tsx", infer);
}

describe("React AOT keyed-array rolling-window hints", () => {
  it("records a retained tail followed by safe incoming rows", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ next }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => setRows((current) => [...current.slice(1), next])}>Roll</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.optimizations.keyedArrayRollingWindowHints).toBe(1);
    expect(result.optimizations.keyedArraySliceHints).toBe(0);
    expect(result.code).toContain("createCompilerKeyedArrayRollingWindow");
    expect(result.code).toContain("createCompilerKeyedArraySlice");
  });

  it("supports a negative retained-tail bound and multiple incoming values", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ first, rest }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => setRows((current) => [...current.slice(-5), first, ...rest])}>
            Roll
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArrayRollingWindowHints).toBe(1);
  });

  it("records compiler-safe runtime retained-tail bounds", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ trimCount, window }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => setRows((current) => [...current.slice(trimCount), ...window])}>
            Roll by count
          </button>
          <button onClick={() => setRows((current) => [...current.slice(Math.trunc(trimCount / 2)), ...window])}>
            Roll by calculated count
          </button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayRollingWindowHints).toBe(2);
    expect(result.code.match(/createCompilerKeyedArrayRollingWindow\(/g)).toHaveLength(2);
    expect(result.code).toContain("trimCount");
  });

  it("retains same-key maps on both sides of one rolling-window setter", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ next, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => [...current.slice(1), next]);
            setRows((current) => current.map((row) =>
              row.id === next.id ? { ...row, selected: true } : row
            ));
          }}>Roll and edit</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayRollingWindowHints).toBe(1);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.code).toContain("createCompilerKeyedArrayQueuedMapPipeline");
    expect(result.code).toContain("finalizeCompilerKeyedArrayMappedStructuralUpdate");
    expect(result.code).toContain("createCompilerKeyedArrayMappedStructuralAppend");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralAppendMapPipeline");
    expect(result.code).toContain("keyedRowsStructuralAppendMapHintedRuntimeFeature");
    expect(result.code).not.toContain("createCompilerKeyedArrayRollingWindow");
  });

  it("lowers a rolling window followed by maps through the structural append runtime", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ next, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => {
            setRows((current) => [...current.slice(1), next]);
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
          }}>Roll and edit</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.optimizations.keyedArrayRollingWindowHints).toBe(1);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayStructuralAppend");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralAppendMapPipeline");
    expect(result.code).toContain("keyedRowsStructuralAppendMapHintedRuntimeFeature");
    expect(result.code).not.toContain("createCompilerKeyedArrayRollingWindow");
  });

  it("keeps the dedicated rolling helper when mapped and plain sites share a module", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ next, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => {
            setRows((current) => [...current.slice(1), next]);
          }}>Roll</button>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => [...current.slice(1), next]);
          }}>Map and roll</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.optimizations.keyedArrayRollingWindowHints).toBe(2);
    expect(result.code).toContain("createCompilerKeyedArrayRollingWindow");
    expect(result.code).toContain("createCompilerKeyedArrayMappedStructuralAppend");
    expect(result.code).toContain("keyedRowsStructuralAppendMapHintedRuntimeFeature");
  });

  it("retains safe maps through a segment containing two rolling setters", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ nextOne, nextTwo, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => [...current.slice(1), nextOne]);
            setRows((current) => current.map((row) =>
              row.id === nextOne.id ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => [...current.slice(1), nextTwo]);
            setRows((current) => current.map((row) =>
              row.id === nextTwo.id ? { ...row, label: nextLabel } : row
            ));
          }}>Roll twice</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.optimizations.keyedArrayRollingWindowHints).toBe(2);
    expect(result.optimizations.keyedArrayMappedRollingWindowChainHints).toBe(2);
    expect(result.optimizations.keyedMapUpdateHints).toBe(3);
    expect(result.code).toContain("createCompilerKeyedArrayMappedRollingWindow");
    expect(result.code).toContain("createCompilerKeyedArrayRollingWindowMapPipeline");
    expect(result.code).toContain("keyedRowsMappedRollingWindowHintedRuntimeFeature");
    expect(result.code).not.toMatch(/\bcreateCompilerKeyedArrayRollingWindow\b/);
    expect(result.code).not.toContain("createCompilerKeyedArrayQueuedMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayMappedStructuralAppend");
    expect(result.code).not.toContain("createCompilerKeyedArrayStructuralAppendMapPipeline");
  });

  it("retains a rolling-window chain through a safe multi-branch map callback", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ nextOne, nextTwo, firstId, secondId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => {
            setRows((current) => [...current.slice(1), nextOne]);
            setRows((current) => current.map((row) =>
              row.id === firstId
                ? { ...row, label: nextLabel }
                : row.id === secondId
                  ? { ...row, label: nextLabel }
                  : row
            ));
            setRows((current) => [...current.slice(1), nextTwo]);
          }}>Roll around unsupported map</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.optimizations.keyedArrayMappedRollingWindowChainHints).toBe(2);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayRollingWindowMapPipeline");
    expect(result.code).toContain("createCompilerKeyedArrayMappedRollingWindow");
  });

  it("does not emit a rolling-window chain hint when one nested map branch is effectful", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ nextOne, nextTwo, firstId, secondId, computeLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => {
            setRows((current) => [...current.slice(1), nextOne]);
            setRows((current) => current.map((row) =>
              row.id === firstId
                ? { ...row, label: "First" }
                : row.id === secondId
                  ? { ...row, label: computeLabel(row) }
                  : row
            ));
            setRows((current) => [...current.slice(1), nextTwo]);
          }}>Roll around unsafe map</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.optimizations.keyedArrayMappedRollingWindowChainHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayRollingWindowMapPipeline");
  });

  it("does not connect rolling-window maps across another statement", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ next, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => {
            setRows((current) => [...current.slice(1), next]);
            logRoll();
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
          }}>Roll and edit</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.code).toContain("createCompilerKeyedArrayRollingWindow");
    expect(result.code).not.toContain("createCompilerKeyedArrayStructuralAppendMapPipeline");
    expect(result.code).not.toContain("keyedRowsStructuralAppendMapHintedRuntimeFeature");
  });

  it("separates mapped rolling segments around an unsupported setter", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ nextOne, nextTwo, editedId, nextLabel }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => [...current.slice(1), nextOne]);
            setRows((current) => current.customTransform());
            setRows((current) => [...current.slice(1), nextTwo]);
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
          }}>Roll around unsupported work</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Feed"]);
    expect(result.optimizations.keyedArrayRollingWindowHints).toBe(2);
    expect(result.code).toContain("current.customTransform()");
    expect(result.code).toContain("createCompilerKeyedArrayMappedStructuralAppend");
    expect(result.code).toContain("createCompilerKeyedArrayStructuralAppendMapPipeline");
    expect(result.code).not.toContain("createCompilerKeyedArrayRollingWindow");
  });

  it.each([
    {
      name: "an index-dependent row",
      row: "(row, index) => <li key={row.id}>{index}: {row.label}</li>",
      update: "[...current.slice(1), next]",
    },
    {
      name: "a collection-dependent key",
      row: "row => <li key={rows.length + row.id}>{row.label}</li>",
      update: "[...current.slice(1), next]",
    },
    {
      name: "a no-op slice bound",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "[...current.slice(0), next]",
    },
    {
      name: "a middle slice",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "[...current.slice(1, -1), next]",
    },
    {
      name: "a block-bodied updater",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "{ return [...current.slice(1), next]; }",
    },
    {
      name: "an unsafe incoming call",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "[...current.slice(1), makeNext()]",
    },
    {
      name: "an effectful slice bound",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "[...current.slice(makeOffset()), next]",
    },
    {
      name: "a fractional slice bound",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "[...current.slice(1.5), next]",
    },
    {
      name: "an assigned slice bound",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "[...current.slice(offset = 1), next]",
    },
    {
      name: "an updated slice bound",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "[...current.slice(offset++), next]",
    },
    {
      name: "a retained tail in the wrong position",
      row: "row => <li key={row.id}>{row.label}</li>",
      update: "[next, ...current.slice(1)]",
    },
  ])("keeps $name off the rolling-window fast path", async ({ row, update }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Feed({ next, offset, makeNext, makeOffset }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return <section>
          <button onClick={() => setRows((current) => ${update})}>Roll</button>
          <ul>{rows.map(${row})}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArrayRollingWindowHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedArrayRollingWindow");
  });
});
