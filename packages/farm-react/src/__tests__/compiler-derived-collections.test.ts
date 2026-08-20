// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/DerivedCollections.tsx", infer);
}

describe("React AOT derived collection compiler", () => {
  it("lowers a safe filter, sort, and slice pipeline into compiled keyed rows", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function VisibleInventory() {
        const [items, setItems] = useState([
          { id: "a", label: "Alpha", rank: 2, visible: true },
          { id: "b", label: "Beta", rank: 1, visible: false },
        ]);
        const [minimumRank, setMinimumRank] = useState(0);
        const [limit, setLimit] = useState(10);
        const [unrelated, setUnrelated] = useState(false);
        return (
          <section>
            <button onClick={() => setMinimumRank((value) => value + 1)}>Raise rank</button>
            <button onClick={() => setLimit((value) => value - 1)}>Shrink page</button>
            <button onClick={() => setItems([...items].reverse())}>Reverse</button>
            <button onClick={() => setUnrelated(!unrelated)}>{unrelated ? "On" : "Off"}</button>
            <ul>
              {items
                .filter((item) => item.visible && item.rank >= minimumRank)
                .toSorted((left, right) => left.rank - right.rank)
                .slice(0, limit)
                .map((item) => (
                  <li data-rank={item.rank} key={item.id}>{item.label}</li>
                ))}
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["VisibleInventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain(".filter(item => item.visible && item.rank >=");
    expect(result.code).toContain(".toSorted((left, right) => left.rank - right.rank)");
    expect(result.code).toContain(".slice(0,");
    expect(result.code).toContain("dependencies: [0, 1, 2]");
    expect(result.code).toContain('name: "data-rank"');
    await expect(
      transformWithEsbuild(result.code, "/app/DerivedCollections.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("farmBlocks.KeyedRows"),
    });
  });

  it("expands derived collection locals without losing their dependencies", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function PagedInventory() {
        const [items, setItems] = useState([
          { id: "a", rank: 1, visible: true },
          { id: "b", rank: 2, visible: false },
        ]);
        const [minimumRank, setMinimumRank] = useState(0);
        const [pageSize, setPageSize] = useState(1);
        const visible = items.filter((item) => item.visible && item.rank >= minimumRank);
        const ordered = visible.toSorted((left, right) => right.rank - left.rank);
        const page = ordered.slice(0, pageSize).toReversed();
        return (
          <section>
            <button onClick={() => setItems([...items].reverse())}>Reverse</button>
            <button onClick={() => setMinimumRank(minimumRank + 1)}>Filter</button>
            <button onClick={() => setPageSize(pageSize + 1)}>Grow page</button>
            <ol>{page.map((item) => <li key={item.id}>{item.rank}</li>)}</ol>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["PagedInventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain(".filter(item => item.visible && item.rank >=");
    expect(result.code).toContain(".toReversed()");
    expect(result.code).toContain("dependencies: [0, 1, 2]");
  });

  it("supports a safe pipeline as the collection of the public List boundary", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function ReversedInventory() {
        const [items, setItems] = useState([
          { id: "a", active: true },
          { id: "b", active: false },
        ]);
        const active = items.filter((item) => item.active).toReversed();
        return (
          <div>
            <button onClick={() => setItems([...items].reverse())}>Reverse</button>
            <ul>
              <List each={active} by={(item) => item.id}>
                {(item) => <li>{item.id}</li>}
              </List>
            </ul>
          </div>
        );
      }
    `);

    expect(result.compiled).toEqual(["ReversedInventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain(".filter(item => item.active).toReversed()");
  });

  it("keeps custom component rows under React while isolating their derived collection", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      import { Row } from "./row";
      export function FilteredComponents() {
        const [items, setItems] = useState([
          { id: "a", active: true },
          { id: "b", active: false },
        ]);
        const active = items.filter((item) => item.active).slice(0, 10);
        return (
          <section>
            <button onClick={() => setItems([...items].reverse())}>Reverse</button>
            <List each={active} by={(item) => item.id}>
              {(item) => <Row item={item} />}
            </List>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["FilteredComponents"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain(".filter(item => item.active).slice(0, 10)");
  });

  it("accepts a single-return filter body and the optional filter index", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function IndexedFilter() {
        const [items, setItems] = useState([{ id: "a", visible: true }]);
        const [offset, setOffset] = useState(0);
        return (
          <ul onClick={() => { setItems([...items]); setOffset(offset + 1); }}>
            {items
              .filter((item, index) => { return item.visible && index >= offset; })
              .map((item) => <li key={item.id}>{item.id}</li>)}
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual(["IndexedFilter"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).toContain("dependencies: [0, 1]");
  });

  it.each([
    {
      name: "a mutating sort",
      collection: "items.sort((left, right) => left.rank - right.rank)",
      reason: /collection cannot use function calls/i,
    },
    {
      name: "an external filter callback",
      prefix: "const visible = (item) => item.visible;",
      collection: "items.filter(visible)",
      reason: /filter requires one inline callback/i,
    },
    {
      name: "an async filter callback",
      collection: "items.filter(async (item) => item.visible)",
      reason: /filter callbacks must be synchronous/i,
    },
    {
      name: "an assigning filter callback",
      collection: "items.filter((item) => (item.visible = true))",
      reason: /filter callbacks cannot use assignments/i,
    },
    {
      name: "an unproven predicate call",
      collection: "items.filter((item) => item.label.includes(query))",
      reason: /filter callbacks cannot use function calls/i,
    },
    {
      name: "a spread slice argument",
      collection: "items.slice(...bounds)",
      reason: /slice does not support spread arguments/i,
    },
    {
      name: "arguments passed to toReversed",
      collection: "items.toReversed(1)",
      reason: /toReversed accepts at most 0/i,
    },
    {
      name: "an invalid comparator shape",
      collection: "items.toSorted((item) => item.rank)",
      reason: /toSorted callbacks must be synchronous and use two items/i,
    },
    {
      name: "an unproven collection source",
      collection: "getItems().filter((item) => item.visible)",
      reason: /collection cannot use function calls/i,
    },
  ])("falls back safely for $name", async ({ collection, prefix = "", reason }) => {
    const result = await compile(`
      import { useState } from "react";
      const getItems = () => [];
      const bounds = [0, 1];
      ${prefix}
      export function UnsupportedPipeline() {
        const [items, setItems] = useState([
          { id: "a", label: "Alpha", rank: 1, visible: true },
        ]);
        const [query, setQuery] = useState("A");
        return (
          <ul onClick={() => { setItems([...items]); setQuery(query + "x"); }}>
            {${collection}.map((item) => <li key={item.id}>{item.label}</li>)}
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(reason);
    expect(result.code).not.toContain("createCompiledComponent");
  });

  it("rejects an unsafe derived collection before it reaches JSX lowering", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function UnsafeDerivedPipeline() {
        const [items, setItems] = useState([{ id: "a", visible: true }]);
        const visible = items.filter((item) => {
          console.log(item);
          return item.visible;
        });
        return <ul onClick={() => setItems([...items])}>{visible.map((item) => <li key={item.id}>{item.id}</li>)}</ul>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/filter callbacks must return one expression/i);
  });
});
