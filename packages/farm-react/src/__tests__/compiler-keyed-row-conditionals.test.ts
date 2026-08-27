// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/RowConditionals.tsx", infer);
}

describe("React AOT keyed-row conditional compiler", () => {
  it("isolates host conditionals inside keyed rows", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([
          { id: "a", label: "Alpha", done: false, expanded: true },
        ]);
        return (
          <main>
            <button onClick={() => setItems((rows) => rows)}>Refresh</button>
            <ul>
              {items.map((item, index) => (
                <li data-index={index} key={item.id}>
                  <span>{item.label}</span>
                  <div className="status">
                    {item.done && <strong data-state={item.label}>Completed</strong>}
                  </div>
                  <section className="details">
                    {item.expanded
                      ? <p title={item.label}>{item.label} details</p>
                      : <small>Collapsed</small>}
                  </section>
                </li>
              ))}
            </ul>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain("keyedRowsHostRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsConditionalRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsCompleteRuntimeFeature");
    expect(result.code).toContain("hostBlocks={true}");
    expect(result.code).toContain('kind: "conditional-ranges"');
    expect(result.code).toContain("parent: 0");
    expect(result.code).not.toContain("conditionals={[");
    expect(result.code).not.toContain("_farmRowConditional");
    expect(result.code).toContain("logical: true");
    expect(result.code).toContain("falsy: {");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
    await expect(
      transformWithEsbuild(result.code, "/app/RowConditionals.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({ code: expect.stringContaining("farmBlocks.KeyedRows") });
  });

  it("composes row events and conditionals through the public List boundary", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha", done: false }]);
        return (
          <main>
            <ul>
              <List each={items} by={(item) => item.id}>
                {(item) => (
                  <li>
                    <button onClick={() => setItems([{ ...item, done: !item.done }])}>Toggle</button>
                    <div>{item.done ? <strong>{item.label}</strong> : <span>Open</span>}</div>
                  </li>
                )}
              </List>
            </ul>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain("keyedRowsConditionalRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsHostRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsCompleteRuntimeFeature");
    expect(result.code).toContain("_farmRowEvent(item, 0, 0)");
    expect(result.code).toContain("_farmRowConditional(item, 0, 0");
    expect(result.code).toContain('name: "onClick"');
    expect(result.code).toContain("conditionals={[");
  });

  it.each([
    {
      name: "an event inside the conditional branch",
      content: "{item.done && <button onClick={() => setItems([])}>Done</button>}",
    },
    {
      name: "a component inside the conditional branch",
      content: "{item.done && <Status value={item.label} />}",
      declaration: "function Status({ value }) { return <strong>{value}</strong>; }",
    },
    {
      name: "a fragment conditional branch",
      content: "{item.done ? <><strong>Done</strong></> : <span>Open</span>}",
    },
  ])("keeps $name on the React-owned keyed boundary", async ({ content, declaration = "" }) => {
    const result = await compile(`
      import { useState } from "react";
      ${declaration}
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha", done: false }]);
        return (
          <main>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <div>${content}</div>
                </li>
              ))}
            </ul>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRows");
    expect(result.code).not.toContain("_farmRowConditional");
  });
});
