// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/ComposableBlocks.tsx", infer);
}

describe("React AOT composable block compiler", () => {
  it("builds one globally identified graph for sibling and nested block kinds", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";

      function Summary({ total }: { total: number }) {
        return <output data-summary>{total}</output>;
      }

      function Row({ item }: { item: { id: string; label: string } }) {
        return <li>{item.label}</li>;
      }

      export function ComposableDashboard() {
        const [open, setOpen] = useState(true);
        const [nested, setNested] = useState(false);
        const [left, setLeft] = useState([{ id: "a", label: "Alpha" }]);
        const [right, setRight] = useState([{ id: "b", label: "Beta" }]);
        const [count, setCount] = useState(0);
        return (
          <main>
            <button onClick={() => setOpen(!open)}>Open</button>
            <h1>Static heading</h1>
            {open && (
              <section>
                <Summary total={count} />
                <ul>
                  <li>Static row</li>
                  {left.map((item) => <li key={item.id}>{item.label}</li>)}
                  {nested && <li data-nested>{count}</li>}
                </ul>
                <List each={right} by={(item) => item.id}>
                  {(item) => <Row item={item} />}
                </List>
              </section>
            )}
            <aside>
              <p>Second list</p>
              {right.map((item) => <span key={item.id}>{item.label}</span>)}
            </aside>
            {nested ? <strong>Nested on</strong> : <span>Nested off</span>}
            <footer>Static footer</footer>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["ComposableDashboard"]);
    expect(
      result.diagnostics.find((diagnostic) => diagnostic.component === "ComposableDashboard"),
    ).toBeUndefined();
    expect(result.code.match(/farmBlocks\.Conditional/g)).toHaveLength(3);
    expect(result.code.match(/farmBlocks\.KeyedList/g)).toHaveLength(2);
    expect(result.code.match(/farmBlocks\.KeyedRanges/g)).toHaveLength(1);
    expect(result.code.match(/farmBlocks\.Component/g)).toHaveLength(1);

    const ids = [...result.code.matchAll(/id=\{(\d+)\}/g)].map((match) => Number(match[1]));
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.code.match(/parent: 0/g)).toHaveLength(4);

    await expect(
      transformWithEsbuild(result.code, "/app/ComposableBlocks.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("farmBlocks.Component"),
    });
  });

  it("keeps list callback contents under React ownership", async () => {
    const result = await compile(`
      import { useState } from "react";
      function StatefulRow({ label }: { label: string }) {
        const [selected, setSelected] = useState(false);
        return <button onClick={() => setSelected(!selected)}>{label}</button>;
      }
      export function Rows() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <h2>Rows</h2>
            <div>
              {items.map((item) => <StatefulRow key={item.id} label={item.label} />)}
            </div>
          </section>
        );
      }
    `);

    expect(result.compiled).toContain("Rows");
    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/\.KeyedList/g)).toHaveLength(1);
    expect(result.code).not.toContain(".Component");
  });
});
