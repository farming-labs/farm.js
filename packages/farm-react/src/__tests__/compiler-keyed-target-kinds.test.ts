// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

describe("keyed target runtime selection", () => {
  it.each([
    ["row.id", "keyedRowsFilterHintedRuntimeFeature"],
    ["selected === row.id", "keyedRowsIdentityFilterHintedRuntimeFeature"],
    ["marked.has(row.id)", "keyedRowsFilterHintedRuntimeFeature"],
    ["lookup.get(row.id)", "keyedRowsFilterHintedRuntimeFeature"],
    ["selected === row.id} data-marked={marked.has(row.id)", "keyedRowsFilterHintedRuntimeFeature"],
  ])("keeps filter hints while selecting targets for %s", async (binding, feature) => {
    const result = await compileReactModule(
      `
      import { useState } from "react";
      export function Rows() {
        const [rows, setRows] = useState([{id: "a"}, {id: "b"}]);
        const [selected, setSelected] = useState("a");
        const [marked, setMarked] = useState(new Set(["a"]));
        const [lookup, setLookup] = useState(new Map([["a", "A"]]));
        return <main><ul>{rows.map(row => <li key={row.id} data-value={${binding}}>
          <button onClick={() => setSelected(row.id)}>Select</button>
          <button onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>Remove</button>
        </li>)}</ul></main>;
      }
      `,
      "/app/Rows.tsx",
      normalizeReactCompilerOptions(true),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.optimizations.keyedArrayFilterHints).toBe(1);
    expect(result.code).toContain(feature);
    expect(result.code).toContain("delegateEvents={true}");
  });

  it.each([
    ['<ul>{rows.map(row => <li key={row.id}>{marked.has(row.id) ? "Marked" : ""}</li>)}</ul>', ""],
    ["", '{row.id === "a" ? <span>First</span> : null}'],
  ])("retains shared target and conditional capabilities", async (sibling, child) => {
    const result = await compileReactModule(
      `import { useState } from "react";
      export function Rows() {
        const [rows, setRows] = useState([{id: "a"}, {id: "b"}]);
        const [selected, setSelected] = useState("a");
        const [marked, setMarked] = useState(new Set(["a"]));
        return <main>
          <button onClick={() => setRows(current => current.filter(row => row.id !== "a"))}>Remove</button>
          <ul>{rows.map(row => <li key={row.id} data-selected={selected === row.id}>
            <button onClick={() => setSelected(row.id)}>Select</button>${child}
          </li>)}</ul>${sibling}
        </main>;
      }`,
      "/app/Rows.tsx",
      normalizeReactCompilerOptions(true),
    );
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.diagnostics).toEqual([]);
    // React-owned conditional rows do not accept structural filter hints.
    expect(result.optimizations.keyedArrayFilterHints).toBe(child ? 0 : 1);
    expect(result.code).toContain(
      child ? "keyedListRuntimeFeature" : "keyedRowsFilterHintedRuntimeFeature",
    );
    expect(result.code).not.toContain("keyedRowsIdentityFilterHintedRuntimeFeature");
  });

  it.each([
    ["selected === row.id", "keyedRowsIdentityRuntimeFeature"],
    ["marked.has(row.id)", "keyedRowsMembershipRuntimeFeature"],
    ["lookup.get(row.id)", "keyedRowsMapLookupRuntimeFeature"],
    ["selected === row.id} data-marked={marked.has(row.id)", "keyedRowsRuntimeFeature"],
  ])("selects the runtime for %s", async (binding, feature) => {
    const result = await compileReactModule(
      `
      import { useState } from "react";
      export function Rows() {
        const [rows, setRows] = useState([{id: "a"}]);
        const [selected, setSelected] = useState("a");
        const [marked, setMarked] = useState(new Set(["a"]));
        const [lookup, setLookup] = useState(new Map([["a", "A"]]));
        return <main><ul>{rows.map(row => <li key={row.id} data-value={${binding}} onClick={() => setSelected(row.id)}>{row.id}</li>)}</ul></main>;
      }
    `,
      "/app/Rows.tsx",
      normalizeReactCompilerOptions(true),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.code).toContain(feature);
  });
});
