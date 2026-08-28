// @vitest-environment node

import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedMapLookupTargets.tsx", infer);
}

describe("React AOT keyed Map lookup targets", () => {
  it("emits target metadata for local Map lookups with the exact row key", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function StatusRows() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        const [statusById, setStatusById] = useState(new Map([["a", "ready"]]));
        return (
          <section><ul>
            {rows.map((row) => (
              <li
                aria-label={statusById.get(row.id) ?? "unknown"}
                className={statusById.get(row.id) === "ready" ? "ready" : ""}
                key={row.id}
                onClick={() => setStatusById(new Map([[row.id, "done"]]))}
                style={{ opacity: statusById.get(row.id) === "done" ? 1 : 0.5 }}
              >
                {statusById.get(row.id) ?? row.label}
              </li>
            ))}
          </ul></section>
        );
      }
    `);

    expect(result.compiled).toEqual(["StatusRows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapLookupTargets).toBe(4);
    expect(result.code.match(/mapLookupTarget:/g)).toHaveLength(4);
    expect(result.code).toContain("dependency: 1");
    expect(result.code).toContain("read: () => _farmState[1].get()");
  });

  it("normalizes public List key parameter names", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function StatusRows() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        const [statusById, setStatusById] = useState(new Map([["a", "ready"]]));
        return (
          <section><ul>
            <List each={rows} by={(entry) => entry.id}>
              {(row) => <li data-status={statusById.get(row.id)}>{row.label}</li>}
            </List>
          </ul></section>
        );
      }
    `);

    expect(result.compiled).toEqual(["StatusRows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapLookupTargets).toBe(1);
    expect(result.code).toContain("mapLookupTarget:");
  });

  it.each([
    {
      name: "a different row field",
      binding: "statusById.get(row.slug)",
    },
    {
      name: "another reactive dependency",
      binding: "enabled ? statusById.get(row.id) : 'disabled'",
    },
    {
      name: "another read from the target",
      binding: "statusById.get(row.id) ? statusById.size : 0",
    },
  ])("keeps $name on React's existing path", async ({ binding }) => {
    const result = await compile(`
      import { useState } from "react";
      export function ConservativeRows() {
        const [rows, setRows] = useState([{ id: "a", slug: "alpha" }]);
        const [statusById, setStatusById] = useState(new Map([["a", "ready"]]));
        const [enabled, setEnabled] = useState(true);
        return (
          <section>
            <button onClick={() => setStatusById(new Map([["a", "done"]]))}>Update</button>
            <ul>{rows.map((row) => <li data-status={${binding}} key={row.id}>{row.id}</li>)}</ul>
          </section>
        );
      }
    `);

    expect(result.optimizations.keyedMapLookupTargets).toBe(0);
    expect(result.code).not.toContain("mapLookupTarget:");
  });

  it("does not treat Map-like props as locally owned lookup state", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function PropLookup({ statusById }) {
        const [rows, setRows] = useState([{ id: "a" }]);
        return <ul>{rows.map((row) => <li data-status={statusById.get(row.id)} key={row.id}>{row.id}</li>)}</ul>;
      }
    `);

    expect(result.optimizations.keyedMapLookupTargets).toBe(0);
    expect(result.code).not.toContain("mapLookupTarget:");
  });
});
