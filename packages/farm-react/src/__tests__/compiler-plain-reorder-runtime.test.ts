// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

describe.each(["hybrid", "static"] as const)("plain reorder runtime in %s mode", (reactivity) => {
  async function compile(update: string, sibling = "", extra = "") {
    return compileReactModule(
      `import { useState } from "react";
      export function Rows() {
        const [rows, setRows] = useState([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
        const [other, setOther] = useState([{ id: "c", label: "C" }]);
        const [selected, setSelected] = useState("a");
        const [marked, setMarked] = useState(new Set(["a"]));
        const [lookup, setLookup] = useState(new Map([["a", "A"]]));
        return <main>
          <button onClick={() => setRows(current => ${update})}>Reorder</button>
          ${extra}
          <ul>{rows.map(row => <li key={row.id}>{row.label}</li>)}</ul>
          ${sibling}
        </main>;
      }`,
      "/app/Rows.tsx",
      normalizeReactCompilerOptions({ reactivity }),
    );
  }

  it.each(["current.toReversed()", "current.toSorted()"])(
    "omits target machinery for %s while preserving separate map and append updates",
    async (update) => {
      const result = await compile(
        update,
        "<ul>{other.map(row => <li key={row.id}>{row.label}</li>)}</ul>",
        `<button onClick={() => setRows(current => current.map(row => row.id === "a" ? {...row, label: row.label + "!"} : row))}>Map</button>
         <button onClick={() => setOther(current => [...current, {id: "d", label: "D"}])}>Append</button>`,
      );
      expect(result.compiled).toEqual(["Rows"]);
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("keyedRowsPlainReorderHintedRuntimeFeature");
      expect(result.code).not.toContain("keyedRowsReorderHintedRuntimeFeature");
      expect(result.code).toContain("createCompilerKeyedMapUpdate");
      expect(result.code).toContain("createCompilerKeyedArrayAppend");
      expect(
        result.optimizations.keyedArrayReorderHints + result.optimizations.keyedArraySortHints,
      ).toBe(1);
    },
  );

  it.each(["selected === row.id", "marked.has(row.id)", "lookup.get(row.id)"])(
    "retains targets used by a sibling keyed plan: %s",
    async (binding) => {
      const result = await compile(
        "current.toReversed()",
        `<ul>{other.map(row => <li key={row.id} data-value={${binding}} onClick={() => setSelected(row.id)}>{row.label}</li>)}</ul>`,
      );
      expect(result.compiled).toEqual(["Rows"]);
      expect(result.diagnostics).toEqual([]);
      expect(result.optimizations.keyedArrayReorderHints).toBe(1);
      expect(result.code).toContain("keyedRowsReorderHintedRuntimeFeature");
      expect(result.code).not.toContain("keyedRowsPlainReorderHintedRuntimeFeature");
    },
  );

  it("retains combined structural capabilities used by a sibling list", async () => {
    const result = await compile(
      "current.toReversed()",
      "<ul>{other.map(row => <li key={row.id}>{row.label}</li>)}</ul>",
      '<button onClick={() => setOther(current => current.filter(row => row.id !== "c"))}>Remove</button>',
    );
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.code).toContain("keyedRowsEveryHintedRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsPlainReorderHintedRuntimeFeature");
  });

  it.each([
    '{row.id === "c" ? <span>{row.label}</span> : null}',
    '<div>{row.id === "c" && <strong>{row.label}</strong>}</div>',
  ])("retains conditional/host capabilities used by a sibling: %s", async (child) => {
    const result = await compile(
      "current.toReversed()",
      `<ul>{other.map(row => <li key={row.id}>${child}</li>)}</ul>`,
    );
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toMatch(/keyedRows(?:Host|Conditional|Complete)\w*RuntimeFeature/);
    expect(result.code).not.toContain("keyedRowsPlainReorderHintedRuntimeFeature");
  });
});
