// @vitest-environment node

import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedMembershipTargets.tsx", infer);
}

describe("React AOT keyed membership targets", () => {
  it("emits target metadata for local Set membership against the exact row key", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function MarkedRows() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        const [markedIds, setMarkedIds] = useState(new Set(["a"]));
        return (
          <section><ul>
            {rows.map((row) => (
              <li
                aria-checked={markedIds.has(row.id)}
                className={markedIds.has(row.id) ? "marked" : ""}
                key={row.id}
                onClick={() => setMarkedIds(new Set([row.id]))}
                style={{ opacity: markedIds.has(row.id) ? 1 : 0.5 }}
              >
                {markedIds.has(row.id) ? row.label : "Hidden"}
              </li>
            ))}
          </ul></section>
        );
      }
    `);

    expect(result.compiled).toEqual(["MarkedRows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMembershipTargets).toBe(4);
    expect(result.code.match(/membershipTarget:/g)).toHaveLength(4);
    expect(result.code).toContain("dependency: 1");
    expect(result.code).toContain("read: () => _farmState[1].get()");
  });

  it("normalizes public List key parameter names", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function MarkedRows() {
        const [rows, setRows] = useState([{ id: "a", label: "Alpha" }]);
        const [markedIds, setMarkedIds] = useState(new Set(["a"]));
        return (
          <section><ul>
            <List each={rows} by={(entry) => entry.id}>
              {(row) => <li data-marked={markedIds.has(row.id)}>{row.label}</li>}
            </List>
          </ul></section>
        );
      }
    `);

    expect(result.compiled).toEqual(["MarkedRows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMembershipTargets).toBe(1);
    expect(result.code).toContain("membershipTarget:");
  });

  it.each([
    {
      name: "a different row field",
      binding: "markedIds.has(row.slug)",
    },
    {
      name: "another reactive dependency",
      binding: "markedIds.has(row.id) && enabled",
    },
    {
      name: "another read from the target",
      binding: "markedIds.has(row.id) ? markedIds.size : 0",
    },
  ])("keeps $name on React's existing path", async ({ binding }) => {
    const result = await compile(`
      import { useState } from "react";
      export function ConservativeRows() {
        const [rows, setRows] = useState([{ id: "a", slug: "alpha" }]);
        const [markedIds, setMarkedIds] = useState(new Set(["a"]));
        const [enabled, setEnabled] = useState(true);
        return (
          <section>
            <button onClick={() => setMarkedIds(new Set(["a"]))}>Mark</button>
            <ul>{rows.map((row) => <li data-marked={${binding}} key={row.id}>{row.id}</li>)}</ul>
          </section>
        );
      }
    `);

    expect(result.optimizations.keyedMembershipTargets).toBe(0);
    expect(result.code).not.toContain("membershipTarget:");
  });

  it("does not treat Set-like props as locally owned membership state", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function PropMembership({ markedIds }) {
        const [rows, setRows] = useState([{ id: "a" }]);
        return <ul>{rows.map((row) => <li data-marked={markedIds.has(row.id)} key={row.id}>{row.id}</li>)}</ul>;
      }
    `);

    expect(result.optimizations.keyedMembershipTargets).toBe(0);
    expect(result.code).not.toContain("membershipTarget:");
  });
});
