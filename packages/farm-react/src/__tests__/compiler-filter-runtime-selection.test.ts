// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

describe.each(["hybrid", "static"] as const)("%s filter runtime selection", (reactivity) => {
  async function compile(
    update = "",
    sibling = "",
    binding = "row.id",
    child = "{row.label}",
    removal = "current.filter(row => row.id !== 'a')",
  ) {
    return compileReactModule(
      `import { useState } from "react";
      export function Rows({ transform, next }) {
        const [rows, setRows] = useState([{ id: "a", label: "A" }]);
        const [other, setOther] = useState([{ id: "b", label: "B" }]);
        const [selected, setSelected] = useState("a");
        const [marked, setMarked] = useState(new Set(["a"]));
        const [lookup, setLookup] = useState(new Map([["a", "A"]]));
        return <main>
          <button onClick={() => setRows(current => ${removal})}>Remove</button>
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

  it.each(["", "setRows(current => transform(current))", "setRows(current => current.slice(1))"])(
    "specializes removals while preserving opaque reconciliation: %s",
    async (update) => {
      const result = await compile(update);
      expect(result.compiled).toEqual(["Rows"]);
      expect(result.diagnostics).toEqual([]);
      expect(result.optimizations.keyedArrayFilterHints).toBe(1);
      expect(result.code).toContain("keyedRowsFilterOnlyRuntimeFeature");
      expect(result.code).not.toContain("keyedRowsFilterHintedRuntimeFeature");
    },
  );

  it("specializes slice-only removal hints too", async () => {
    const result = await compile("", "", "row.id", "{row.label}", "current.slice(1)");
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArraySliceHints).toBe(1);
    expect(result.optimizations.keyedArrayFilterHints).toBe(0);
    expect(result.code).toContain("keyedRowsFilterOnlyRuntimeFeature");
  });

  it.each([
    "setRows(current => current.map(row => row.id === 'a' ? {...row, label: 'Changed'} : row))",
    "setRows(current => [...current, {id: 'c', label: 'C'}])",
    "setRows(current => [{id: 'c', label: 'C'}, ...current])",
    "setRows(current => current.toReversed())",
    "setRows(current => current.toSorted((a, b) => a.rank - b.rank))",
    "setRows(current => current.toSpliced(1, 0, next))",
  ])("retains broader capabilities for mixed updates: %s", async (update) => {
    const result = await compile(update);
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).not.toContain("keyedRowsFilterOnlyRuntimeFeature");
  });

  it.each([
    "setOther(current => current.map(row => row.id === 'b' ? {...row, label: 'Changed'} : row))",
    "setOther(current => [...current, {id: 'c', label: 'C'}])",
  ])("includes another collection's accepted capabilities: %s", async (update) => {
    const result = await compile(
      update,
      "<ul>{other.map(row => <li key={row.id}>{row.label}</li>)}</ul>",
    );
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.optimizations.keyedMapUpdateHints + result.optimizations.keyedArrayAppendHints,
    ).toBeGreaterThan(0);
    expect(result.code).not.toContain("keyedRowsFilterOnlyRuntimeFeature");
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
        expect(result.code).not.toContain("keyedRowsFilterOnlyRuntimeFeature");
        expect(result.code).toContain(
          binding === "selected === row.id"
            ? "keyedRowsIdentityFilterOnlyRuntimeFeature"
            : "keyedRowsFilterHintedRuntimeFeature",
        );
      }
    },
  );

  it.each([
    '{row.id === "a" ? <span>{row.label}</span> : null}',
    '<div>{row.id === "a" && <strong>{row.label}</strong>}</div>',
  ])("keeps conditional/host row capabilities: %s", async (child) => {
    const result = await compile("", "", "row.id", child);
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toMatch(/keyedRows(?:Host|Conditional|Complete)\w*RuntimeFeature/);
    expect(result.code).not.toContain("keyedRowsFilterOnlyRuntimeFeature");
  });
});
