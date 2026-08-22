// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/InteractiveRows.tsx", infer);
}

describe("React AOT interactive keyed-row compiler", () => {
  it("keeps row events in React while compiling row bindings", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([
          { id: "a", label: "Alpha", done: false },
          { id: "b", label: "Beta", done: false },
        ]);
        const [selected, setSelected] = useState("a");
        function select(id) {
          setSelected(id);
        }
        return (
          <section>
            <ul>
              {items.map((item, index) => (
                <li
                  aria-selected={selected === item.id}
                  className={item.done ? "done" : "open"}
                  key={item.id}
                  onClickCapture={(event) => event.currentTarget.dataset.index}
                >
                  <span>{item.label}</span>
                  <button
                    data-index={index}
                    onClick={(event) => {
                      event.stopPropagation();
                      select(item.id);
                    }}
                    type="button"
                  >
                    Select
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain('name: "onClickCapture"');
    expect(result.code).toContain('name: "onClick"');
    expect(result.code).toContain("events={[");
    expect(result.code).toMatch(/onClickCapture=\{_farmRowEvent\(item, index, 0\)\}/);
    expect(result.code).toMatch(/onClick=\{_farmRowEvent\(item, index, 1\)\}/);
    expect(result.code).toContain("farmState[1].set");
    expect(result.code).not.toContain("addEventListener");
    await expect(
      transformWithEsbuild(result.code, "/app/InteractiveRows.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({ code: expect.stringContaining("farmBlocks.KeyedRows") });
  });

  it("supports interactive host rows through the public List boundary", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <ul>
              <List each={items} by={(item) => item.id}>
                {(item, index) => (
                  <li>
                    <span>{item.label}</span>
                    <button onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}>
                      Remove {index}
                    </button>
                  </li>
                )}
              </List>
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain("_farmRowEvent(item, index, 0)");
    expect(result.code).toContain('name: "onClick"');
  });

  it.each([
    {
      name: "a non-inline handler prop",
      event: "onClick={onSelect}",
    },
    {
      name: "an async handler",
      event: "onClick={async () => setItems([])}",
    },
    {
      name: "arguments access",
      event: "onClick={function () { setItems(arguments.length ? [] : items); }}",
    },
  ])("keeps $name in the React-owned list boundary", async ({ event }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks({ onSelect }) {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <ul>{items.map((item) => <li key={item.id} ${event}>{item.label}</li>)}</ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRows");
  });

  it("keeps controlled interactive row inputs under React ownership", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <input
                    onChange={(event) => setItems([{ ...item, label: event.currentTarget.value }])}
                    value={item.label}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRows");
  });
});
