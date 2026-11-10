// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

describe.each(["hybrid", "static"] as const)("plain position runtime in %s mode", (reactivity) => {
  async function compile(update: string, sibling = "", extra = "", attribute = "") {
    return compileReactModule(
      `import { useState } from "react";
      export function Rows({ next, second }) {
        const [rows, setRows] = useState([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
        const [other, setOther] = useState([{ id: "c", label: "C" }]);
        const [selected, setSelected] = useState("a");
        const [marked, setMarked] = useState(new Set(["a"]));
        const [lookup, setLookup] = useState(new Map([["a", "A"]]));
        return <main>
          <button onClick={() => setRows(current => ${update})}>Change</button>
          ${extra}
          <ul>{rows.map(row => <li key={row.id} ${attribute}>{row.label}</li>)}</ul>
          ${sibling}
        </main>;
      }`,
      "/app/Rows.tsx",
      normalizeReactCompilerOptions({ reactivity }),
    );
  }

  it.each([
    "current.with(0, next)",
    "current.toSpliced(1, 0, next)",
    "current.toSpliced(0, 1)",
    "current.toSpliced(0, 2)",
    "current.toSpliced(0, 1, next)",
  ])("omits unused targets for %s and retains map/append support", async (update) => {
    const result = await compile(
      update,
      "<ul>{other.map(row => <li key={row.id}>{row.label}</li>)}</ul>",
      `<button onClick={() => setRows(current => current.map(row => row.id === "a" ? {...row, label: row.label + "!"} : row))}>Map</button>
       <button onClick={() => setOther(current => [...current, {id: "e", label: "E"}])}>Append</button>`,
    );
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayPositionHints).toBe(1);
    expect(result.code).toContain("keyedRowsPlainPositionHintedRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsPositionHintedRuntimeFeature");
    expect(result.code).toContain("createCompilerKeyedArrayPositionUpdate");
    expect(result.code).toContain("createCompilerKeyedMapUpdate");
    expect(result.code).toContain("createCompilerKeyedArrayAppend");
  });

  describe.each([false, true])("target in sibling plan: %s", (sibling) => {
    it.each(["selected === row.id", "marked.has(row.id)", "lookup.get(row.id)"])(
      "retains the general runtime for %s",
      async (binding) => {
        const attribute = `data-value={${binding}} onClick={() => setSelected(row.id)}`;
        const result = await compile(
          "current.with(0, next)",
          sibling
            ? `<ul>{other.map(row => <li key={row.id} ${attribute}>{row.label}</li>)}</ul>`
            : "",
          "",
          sibling ? "" : attribute,
        );
        expect(result.compiled).toEqual(["Rows"]);
        expect(result.diagnostics).toEqual([]);
        expect(result.optimizations.keyedArrayPositionHints).toBe(1);
        expect(result.code).toContain("keyedRowsPositionHintedRuntimeFeature");
        expect(result.code).not.toContain("keyedRowsPlainPositionHintedRuntimeFeature");
      },
    );
  });

  it.each([
    ["current.filter(row => row.id !== 'c')", "keyedRowsEveryHintedRuntimeFeature"],
    ["[{id: 'd', label: 'D'}, ...current]", "keyedRowsEveryHintedRuntimeFeature"],
    ["current.toReversed()", "keyedRowsEveryHintedRuntimeFeature"],
    ["current.toSpliced(0, 0, next, second)", "keyedRowsBatchPositionHintedRuntimeFeature"],
    ["current.toSpliced(0, 2, next, second)", "keyedRowsWindowPositionHintedRuntimeFeature"],
  ])("retains broader sibling update capabilities for %s", async (update, feature) => {
    const result = await compile(
      "current.with(0, next)",
      "<ul>{other.map(row => <li key={row.id}>{row.label}</li>)}</ul>",
      `<button onClick={() => setOther(current => ${update})}>Other</button>`,
    );
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(feature);
    expect(result.code).not.toContain("keyedRowsPlainPositionHintedRuntimeFeature");
  });

  it.each([
    '{row.id === "c" ? <span>{row.label}</span> : null}',
    '<div>{row.id === "c" && <strong>{row.label}</strong>}</div>',
  ])("retains conditional/host capabilities used by a sibling: %s", async (child) => {
    const result = await compile(
      "current.with(0, next)",
      `<ul>{other.map(row => <li key={row.id}>${child}</li>)}</ul>`,
    );
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayPositionHints).toBe(1);
    expect(result.code).toContain("createCompilerKeyedArrayPositionUpdate");
    expect(result.code).toMatch(
      /keyedRows(?:Host|Conditional|Complete)PositionHintedRuntimeFeature/,
    );
    expect(result.code).not.toContain("keyedRowsPlainPositionHintedRuntimeFeature");
  });
});
