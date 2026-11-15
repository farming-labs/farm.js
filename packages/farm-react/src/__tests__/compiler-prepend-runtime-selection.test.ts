// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

describe.each(["hybrid", "static"] as const)("%s prepend runtime selection", (reactivity) => {
  async function compile(update = "", sibling = "", binding = "row.id", child = "{row.label}") {
    return compileReactModule(
      `import { useState } from "react";
      export function Rows({ transform, next }) {
        const [rows, setRows] = useState([{ id: "a", label: "A" }]);
        const [other, setOther] = useState([{ id: "b", label: "B" }]);
        const [selected, setSelected] = useState("a");
        const [marked, setMarked] = useState(new Set(["a"]));
        const [lookup, setLookup] = useState(new Map([["a", "A"]]));
        return <main>
          <button onClick={() => setRows(current => [{id: "c", label: "C"}, ...current])}>Prepend</button>
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

  it.each(["", "setRows(current => transform(current))"])(
    "specializes prepend hints while preserving opaque reconciliation: %s",
    async (update) => {
      const result = await compile(update);
      expect(result.compiled).toEqual(["Rows"]);
      expect(result.diagnostics).toEqual([]);
      expect(result.optimizations.keyedArrayPrependHints).toBe(1);
      expect(result.code).toContain("keyedRowsPrependOnlyRuntimeFeature");
      expect(result.code).not.toContain("keyedRowsPrependHintedRuntimeFeature");
    },
  );

  it.each([
    "setRows(current => current.map(row => row.id === 'a' ? {...row, label: 'Changed'} : row))",
    "setRows(current => [...current, {id: 'c', label: 'C'}])",
    "setRows(current => current.filter(row => row.id !== 'a'))",
    "setRows(current => current.slice(1))",
    "setRows(current => current.toReversed())",
    "setRows(current => current.toSorted((a, b) => a.rank - b.rank))",
    "setRows(current => current.toSpliced(1, 0, next))",
  ])("retains broader capabilities for mixed updates: %s", async (update) => {
    const result = await compile(update);
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).not.toContain("keyedRowsPrependOnlyRuntimeFeature");
  });

  it.each([
    "setOther(current => current.map(row => row.id === 'b' ? {...row, label: 'Changed'} : row))",
    "setOther(current => [...current, {id: 'c', label: 'C'}])",
    "setOther(current => current.filter(row => row.id !== 'b'))",
  ])("includes another collection's accepted capabilities: %s", async (update) => {
    const result = await compile(
      update,
      "<ul>{other.map(row => <li key={row.id}>{row.label}</li>)}</ul>",
    );
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.optimizations.keyedMapUpdateHints +
        result.optimizations.keyedArrayAppendHints +
        result.optimizations.keyedArrayFilterHints,
    ).toBeGreaterThan(0);
    expect(result.code).not.toContain("keyedRowsPrependOnlyRuntimeFeature");
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
        expect(result.code).not.toContain("keyedRowsPrependOnlyRuntimeFeature");
        expect(result.code).toContain("keyedRowsPrependHintedRuntimeFeature");
      }
    },
  );

  it.each([
    '{row.id === "a" ? <span>{row.label}</span> : null}',
    '<div>{row.id === "a" && <strong>{row.label}</strong>}</div>',
  ])("keeps conditional/host row capabilities on either list: %s", async (child) => {
    for (const sibling of [false, true]) {
      const result = await compile(
        "",
        sibling ? `<ul>{other.map(row => <li key={row.id}>${child}</li>)}</ul>` : "",
        "row.id",
        sibling ? "{row.label}" : child,
      );
      expect(result.compiled).toEqual(["Rows"]);
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toMatch(/keyedRows(?:Host|Conditional|Complete)\w*RuntimeFeature/);
      expect(result.code).not.toContain("keyedRowsPrependOnlyRuntimeFeature");
    }
  });
});
