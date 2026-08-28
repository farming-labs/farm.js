// @vitest-environment node

import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedIdentityTargets.tsx", infer);
}

describe("React AOT keyed identity targets", () => {
  it("emits target metadata for strict comparisons against the exact row key", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function SelectableRows() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        const [selectedId, setSelectedId] = useState(null);
        return (
          <section><ul>
            {rows.map((row) => (
              <li
                aria-selected={selectedId === row.id}
                className={row.id !== selectedId ? "idle" : "selected"}
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                style={{ opacity: selectedId === row.id ? 1 : 0.5 }}
              >
                <span>{selectedId === row.id ? row.label : "Hidden"}</span>
              </li>
            ))}
          </ul></section>
        );
      }
    `);

    expect(result.compiled).toEqual(["SelectableRows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedIdentityTargets).toBe(4);
    expect(result.code.match(/identityTarget:/g)).toHaveLength(4);
    expect(result.code).toContain("dependency: 1");
    expect(result.code).toContain("read: () => _farmState[1].get()");
  });

  it("normalizes public List key parameter names and supports primitive prop targets", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function SelectedRows({ activeId }) {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section><ul>
            <List each={rows} by={(entry) => entry.id}>
              {(row) => <li data-active={row.id === activeId}>{row.label}</li>}
            </List>
          </ul></section>
        );
      }
    `);

    expect(result.compiled).toEqual(["SelectedRows"]);
    expect(result.optimizations.keyedIdentityTargets).toBe(1);
    expect(result.code).toContain("identityTarget:");
    expect(result.code).toMatch(/read: \(\) => _farmState\[1\]\.get\(\)/);
  });

  it.each([
    {
      name: "loose equality",
      binding: 'row.id == selectedId ? "selected" : ""',
    },
    {
      name: "a different row field",
      binding: 'row.slug === selectedId ? "selected" : ""',
    },
    {
      name: "a target read outside the key comparison",
      binding: 'row.id === selectedId ? "selected" : selectedId',
    },
    {
      name: "another reactive dependency",
      binding: 'row.id === selectedId && enabled ? "selected" : ""',
    },
  ])("keeps $name on complete binding evaluation", async ({ binding }) => {
    const result = await compile(`
      import { useState } from "react";
      export function ConservativeRows() {
        const [rows, setRows] = useState([{ id: "a", slug: "alpha" }]);
        const [selectedId, setSelectedId] = useState("a");
        const [enabled, setEnabled] = useState(true);
        return (
          <section>
            <button onClick={() => setSelectedId("b")}>Select</button>
            <ul>{rows.map((row) => <li className={${binding}} key={row.id}>{row.id}</li>)}</ul>
          </section>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["ConservativeRows"]);
    expect(result.optimizations.keyedIdentityTargets).toBe(0);
    expect(result.code).not.toContain("identityTarget:");
  });

  it("does not target a dependency that also changes key structure", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function StructuralTarget() {
        const [rows, setRows] = useState([{ id: "a" }]);
        const [selectedId, setSelectedId] = useState("a");
        return (
          <ul onClick={() => setSelectedId("b")}>
            {rows.map((row) => (
              <li data-selected={row.id === selectedId} key={selectedId + row.id}>{row.id}</li>
            ))}
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual(["StructuralTarget"]);
    expect(result.optimizations.keyedIdentityTargets).toBe(0);
  });
});
