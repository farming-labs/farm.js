// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

describe.each(["hybrid", "static"] as const)("%s append runtime selection", (reactivity) => {
  async function compile(update = "", sibling = "", binding = "row.id", child = "{row.label}") {
    return compileReactModule(
      `import { useState } from "react";
      export function Rows({ transform }) {
        const [rows, setRows] = useState([{ id: "a", label: "A" }]);
        const [other, setOther] = useState([{ id: "b", label: "B" }]);
        const [selected, setSelected] = useState("a");
        const [marked, setMarked] = useState(new Set(["a"]));
        const [lookup, setLookup] = useState(new Map([["a", "A"]]));
        return <main>
          <button onClick={() => setRows(current => [...current, {id: "c", label: "C"}])}>Append</button>
          <button onClick={() => { ${update}; }}>Update</button>
          <ul>{rows.map(row => <li key={row.id} data-value={${binding}}
            onClick={() => setSelected(row.id)}>${child}</li>)}</ul>
          ${sibling}
        </main>;
      }`,
      "/app/Rows.tsx",
      normalizeReactCompilerOptions({ reactivity }),
    );
  }

  it.each([
    "",
    "setRows(current => [...current, {id: 'd', label: 'D'}]); setRows(current => [...current])",
    "setRows(current => transform(current))",
  ])(
    "specializes accepted append hints with an opaque or append-only update: %s",
    async (update) => {
      const result = await compile(update);
      expect(result.compiled).toEqual(["Rows"]);
      expect(result.diagnostics).toEqual([]);
      expect(result.optimizations.keyedArrayAppendHints).toBeGreaterThan(0);
      expect(result.optimizations.keyedMapUpdateHints).toBe(0);
      expect(result.code).toContain("keyedRowsAppendOnlyRuntimeFeature");
      expect(result.code).not.toContain("keyedRowsHintedRuntimeFeature");
    },
  );

  it.each([
    "setRows(current => current.map(row => row.id === 'a' ? {...row, label: 'Changed'} : row))",
    "setRows(current => current.filter(row => row.id !== 'a'))",
    "setRows(current => current.slice(1))",
    "setRows(current => [{id: 'd', label: 'D'}, ...current])",
    "setRows(current => current.toReversed())",
    "setRows(current => current.toSorted((a, b) => a.rank - b.rank))",
  ])("retains the broader runtime for mixed operations: %s", async (update) => {
    const result = await compile(update);
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayAppendHints).toBeGreaterThan(0);
    expect(result.code).not.toContain("keyedRowsAppendOnlyRuntimeFeature");
  });

  it("accounts for accepted map hints on a different collection", async () => {
    const result = await compile(
      "setOther(current => current.map(row => row.id === 'b' ? {...row, label: 'Changed'} : row))",
      "<ul>{other.map(row => <li key={row.id}>{row.label}</li>)}</ul>",
    );
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.code).toContain("keyedRowsHintedRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsAppendOnlyRuntimeFeature");
  });

  it.each(["selected === row.id", "marked.has(row.id)", "lookup.get(row.id)"])(
    "keeps target support for %s on either list",
    async (binding) => {
      for (const sibling of [false, true]) {
        const result = await compile(
          "",
          sibling
            ? `<ul>{other.map(row => <li key={row.id} data-value={${binding}}>{row.label}</li>)}</ul>`
            : "",
          sibling ? "row.id" : binding,
        );
        expect(result.compiled).toEqual(["Rows"]);
        expect(result.diagnostics).toEqual([]);
        expect(result.code).toContain("keyedRowsHintedRuntimeFeature");
        expect(result.code).not.toContain("keyedRowsAppendOnlyRuntimeFeature");
      }
    },
  );

  it("leaves React-owned conditional rows on their existing path", async () => {
    const result = await compile(
      "",
      "",
      "row.id",
      '{row.id === "a" ? <span>{row.label}</span> : null}',
    );
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).not.toContain("keyedRowsAppendOnlyRuntimeFeature");
  });
});
