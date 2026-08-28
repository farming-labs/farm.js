// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedCollectionUpdateHints.tsx", infer);
}

describe("React AOT keyed collection update hints", () => {
  it("records executed keys for proven immutable Set and Map updaters", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory() {
        const [rows, setRows] = useState([{ id: "a" }, { id: "b" }]);
        const [marked, setMarked] = useState(() => new Set());
        const [statusById, setStatusById] = useState(() => new Map());
        return (
          <section>
            <button onClick={() => setMarked((current) => {
              const next = new Set(current);
              if (next.has("a")) next.delete("a");
              else next.add("a");
              return next;
            })}>Toggle</button>
            <button onClick={() => setStatusById((current) => new Map(current).set("b", "done"))}>
              Update
            </button>
            <ul>
              {rows.map((row) => (
                <li data-marked={marked.has(row.id)} data-status={statusById.get(row.id)} key={row.id}>
                  {row.id}
                </li>
              ))}
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations).toMatchObject({
      keyedCollectionUpdateHints: 3,
      keyedMapLookupTargets: 1,
      keyedMembershipTargets: 1,
    });
    expect(result.code).toContain("createCompilerKeyedCollectionUpdate");
    expect(result.code).toContain("applyCompilerKeyedCollectionMutation");
    expect(result.code).toContain('"set-add"');
    expect(result.code).toContain('"set-delete"');
    expect(result.code).toContain('"map-set"');
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedCollectionUpdateHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedCollectionUpdate"),
    });
  });

  it("keeps fresh direct replacements compatible with later proven updates", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Queue() {
        const [rows, setRows] = useState([{ id: "a" }]);
        const [queue, setQueue] = useState(() => new Map());
        return <main>
          <button onClick={() => setQueue(new Map())}>Reset</button>
          <button onClick={() => setQueue((current) => new Map(current).set("a", "ready"))}>Set</button>
          <ul>{rows.map((row) => <li data-queue={queue.get(row.id)} key={row.id}>{row.id}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Queue"]);
    expect(result.optimizations.keyedCollectionUpdateHints).toBe(1);
  });

  it.each([
    {
      name: "an externally owned initializer",
      initializer: "seed",
      before: "const seed = new Map();",
      update: 'setQueue((current) => new Map(current).set("a", "ready"))',
      extra: "",
    },
    {
      name: "an unknown setter result",
      initializer: "() => new Map()",
      before: "",
      update: "setQueue(buildQueue())",
      extra: "function buildQueue() { return new Map(); }",
    },
    {
      name: "a directly mutated state collection",
      initializer: "() => new Map()",
      before: "",
      update: 'queue.set("a", "unsafe"); setQueue((current) => new Map(current).set("b", "ready"))',
      extra: "",
    },
    {
      name: "a collection that escapes to another function",
      initializer: "() => new Map()",
      before: "",
      update: 'inspect(queue); setQueue((current) => new Map(current).set("b", "ready"))',
      extra: "function inspect(_value) {}",
    },
    {
      name: "an updater that aliases its draft",
      initializer: "() => new Map()",
      before: "",
      update:
        'setQueue((current) => { const next = new Map(current); inspect(next); next.set("a", "ready"); return next; })',
      extra: "function inspect(_value) {}",
    },
    {
      name: "a shadowed collection constructor",
      initializer: "() => new Map()",
      before: "",
      update:
        'setQueue((current) => { const Map = class extends globalThis.Map {}; return new Map(current).set("a", "ready"); })',
      extra: "",
    },
  ])("does not emit delta metadata for $name", async ({ initializer, before, update, extra }) => {
    const result = await compile(`
      import { useState } from "react";
      ${before}
      ${extra}
      export function Queue() {
        const [rows, setRows] = useState([{ id: "a" }, { id: "b" }]);
        const [queue, setQueue] = useState(${initializer});
        return <main>
          <button onClick={() => { ${update}; }}>Update</button>
          <ul>{rows.map((row) => <li data-queue={queue.get(row.id)} key={row.id}>{row.id}</li>)}</ul>
        </main>;
      }
    `);

    expect(result.compiled).toEqual(["Queue"]);
    expect(result.optimizations.keyedMapLookupTargets).toBe(1);
    expect(result.optimizations.keyedCollectionUpdateHints).toBe(0);
    expect(result.code).not.toContain("createCompilerKeyedCollectionUpdate");
  });
});
