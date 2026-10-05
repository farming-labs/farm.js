// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

describe("keyed target runtime selection", () => {
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
