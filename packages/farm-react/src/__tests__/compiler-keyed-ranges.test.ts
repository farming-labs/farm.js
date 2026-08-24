// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedRanges.tsx", infer);
}

describe("React AOT keyed-range compiler", () => {
  it("compiles multiple keyed host ranges between static siblings", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Board() {
        const [primary, setPrimary] = useState([
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]);
        const [secondary, setSecondary] = useState([{ id: "c", label: "Gamma" }]);
        return (
          <main>
            <ul data-count={primary.length + secondary.length}>
              <li data-static="header">Primary</li>
              {primary.map((item, index) => (
                <li data-index={index} key={item.id}>{item.label}</li>
              ))}
              <li data-static="divider">Secondary</li>
              {secondary.map((item, index) => (
                <li data-index={index} key={item.id}>{item.label}</li>
              ))}
              <li data-static="footer">{primary.length + secondary.length} total</li>
            </ul>
            <button onClick={() => setPrimary((items) => [...items].reverse())}>Primary</button>
            <button onClick={() => setSecondary((items) => [...items].reverse())}>Secondary</button>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Board"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRanges");
    expect(result.code).toContain("ranges={[");
    expect(result.code.match(/before: 1/g)).toHaveLength(2);
    expect(result.code).toContain("trailing={1}");
    expect(result.code).toContain("farmBlocks.target");
    expect(result.code).toMatch(/rootRef=\{_?farmBlocks\.target\(/);
    expect(result.code).not.toContain("farmBlocks.KeyedList");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedRanges.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({ code: expect.stringContaining("farmBlocks.KeyedRanges") });
  });

  it("supports an explicit List as one range beside host siblings", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <ul>
              <li data-static="header">Tasks</li>
              <List each={items} by={(item) => item.id}>
                {(item) => <li>{item.label}</li>}
              </List>
              <li data-static="footer">End</li>
            </ul>
            <button onClick={() => setItems([])}>Clear</button>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRanges");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
  });

  it("keeps interactive sibling ranges on the React-owned keyed boundary", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <ul>
              <li data-static="header">Tasks</li>
              {items.map((item) => (
                <li key={item.id}>
                  <button onClick={() => setItems([])}>{item.label}</button>
                </li>
              ))}
              <li data-static="footer">End</li>
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRanges");
  });

  it("keeps a keyed map in the component root on the existing React boundary", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <ul>
            <li data-static="header">Tasks</li>
            {items.map((item) => <li key={item.id}>{item.label}</li>)}
            <li data-static="footer">End</li>
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRanges");
  });

  it("keeps a component sibling outside the range-owned contract", async () => {
    const result = await compile(`
      import { useState } from "react";
      function Heading() {
        return <li>Tasks</li>;
      }
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <ul>
              <Heading />
              {items.map((item) => <li key={item.id}>{item.label}</li>)}
              <li>End</li>
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toContain("Tasks");
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRanges");
  });
});
