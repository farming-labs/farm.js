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
              <li className={primary.length > 1 ? "many" : "few"} data-static="header">
                Primary: {primary.length}
              </li>
              {primary.map((item, index) => (
                <li data-index={index} key={item.id}>{item.label}</li>
              ))}
              <li data-static="divider">Secondary</li>
              {secondary.map((item, index) => (
                <li data-index={index} key={item.id}>{item.label}</li>
              ))}
              <li
                data-static="footer"
                style={{ opacity: secondary.length > 0 ? 1 : 0.5 }}
              >
                {primary.length + secondary.length} total
              </li>
            </ul>
            <button onClick={() => setPrimary((items) => [...items].reverse())}>Primary</button>
            <button onClick={() => setSecondary((items) => [...items].reverse())}>Secondary</button>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Board"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("keyedRangesRuntimeFeature");
    expect(result.code).not.toContain("mixedRangesRuntimeFeature");
    expect(result.code).toContain("farmBlocks.KeyedRanges");
    expect(result.code).toContain("ranges={[");
    expect(result.code.match(/before: 1/g)).toHaveLength(2);
    expect(result.code).toContain("trailing={1}");
    expect(result.code).toContain("segment: 0");
    expect(result.code).toContain("segment: 2");
    expect(result.code).toContain('name: "className"');
    expect(result.code).toContain('name: "opacity"');
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

  it("keeps state-independent render instrumentation on React's initial static path", async () => {
    const result = await compile(`
      import { useState } from "react";
      let executions = 0;
      export function Board() {
        const [primary, setPrimary] = useState([{ id: "a", label: "Alpha" }]);
        const [secondary, setSecondary] = useState([{ id: "b", label: "Beta" }]);
        const total = primary.length + secondary.length;
        return (
          <article>
            <dl>
              <div><dt>Rows</dt><dd>{total}</dd></div>
              <div><dt>Executions</dt><dd>{typeof window === "undefined" ? 1 : ++executions}</dd></div>
            </dl>
            {primary.map((item) => <p key={item.id}>{item.label}</p>)}
            <i>SECONDARY</i>
            {secondary.map((item) => <p key={item.id}>{item.label}</p>)}
            <button onClick={() => setPrimary((items) => [...items].reverse())}>Reverse</button>
          </article>
        );
      }
    `);

    expect(result.compiled).toEqual(["Board"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRanges");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
    expect(result.code).toContain("++executions");
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

  it("keeps an interactive component-root range on the React-owned keyed boundary", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <ul>
            <li data-static="header">Tasks</li>
            {items.map((item) => (
              <li key={item.id}>
                <button onClick={() => setItems([])}>{item.label}</button>
              </li>
            ))}
            <li data-static="footer">End</li>
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRanges");
  });

  it("compiles a keyed range directly in the component root", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <ul data-count={items.length}>
            <li data-static="header">Tasks</li>
            {items.map((item) => <li key={item.id}>{item.label}</li>)}
            <li data-static="footer">{items.length} total</li>
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRanges");
    expect(result.code).toContain("before: 1");
    expect(result.code).toContain("trailing={1}");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedRanges.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({ code: expect.stringContaining("farmBlocks.KeyedRanges") });
  });

  it("compiles one keyed map as the only child of the component root", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <ul data-count={items.length}>
            {items.map((item) => <li key={item.id}>{item.label}</li>)}
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRanges");
    expect(result.code).toContain("before: 0");
    expect(result.code).toContain("trailing={0}");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
  });

  it("compiles an explicit List directly in the component root", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <ul>
            <List each={items} by={(item) => item.id}>
              {(item) => <li>{item.label}</li>}
            </List>
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRanges");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
  });

  it("keeps a component sibling in the root outside the range-owned contract", async () => {
    const result = await compile(`
      import { useState } from "react";
      function Heading() {
        return <li>Tasks</li>;
      }
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <ul>
            <Heading />
            {items.map((item) => <li key={item.id}>{item.label}</li>)}
            <li>End</li>
          </ul>
        );
      }
    `);

    expect(result.compiled).toContain("Tasks");
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRanges");
  });

  it("preserves existing block composition when a root sibling contains dynamic structure", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Dashboard() {
        const [open, setOpen] = useState(true);
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <main>
            <section>{open && <strong>{items.length} items</strong>}</section>
            {items.map((item) => <article key={item.id}>{item.label}</article>)}
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Dashboard"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.HostConditional");
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRanges");
  });
});
