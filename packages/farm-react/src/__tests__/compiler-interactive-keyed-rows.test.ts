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
  it("delegates compiler-proven row events through the stable React container", async () => {
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
    expect(result.code).toContain("structureDependencies={[0]}");
    expect(result.code).toMatch(
      /kind: "attribute",\s*path: \[\],\s*dependencies: \[1\],\s*name: "aria-selected"/,
    );
    expect(result.code).toContain('name: "onClickCapture"');
    expect(result.code).toContain('name: "onClick"');
    expect(result.code).toContain("path: []");
    expect(result.code).toContain("path: [1]");
    expect(result.code).toContain("events={[");
    expect(result.code).toContain("delegateEvents={true}");
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
    expect(result.code).toContain("delegateEvents={true}");
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

  it("compiles controlled host form fields while React keeps their events", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([
          { id: "a", label: "Alpha", note: "Ready", done: false, priority: "high" },
        ]);
        return (
          <section>
            <ul>
              {items.map((item, index) => (
                <li key={item.id}>
                  <input
                    onChange={(event) => setItems((current) => current.map((row) => row.id === item.id ? { ...row, label: event.currentTarget.value } : row))}
                    value={item.label}
                  />
                  <textarea
                    onInput={(event) => setItems((current) => current.map((row) => row.id === item.id ? { ...row, note: event.currentTarget.value } : row))}
                    value={item.note}
                  />
                  <input
                    checked={item.done}
                    onChange={(event) => setItems((current) => current.map((row) => row.id === item.id ? { ...row, done: event.currentTarget.checked } : row))}
                    type="checkbox"
                  />
                  <select
                    onChange={(event) => setItems((current) => current.map((row) => row.id === item.id ? { ...row, priority: event.currentTarget.value } : row))}
                    value={item.priority}
                  >
                    <option value="low">Low</option>
                    <option value="high">High</option>
                  </select>
                  <output>{index}:{item.label}:{item.note}:{item.done ? "done" : "open"}:{item.priority}</output>
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
    expect(result.code).toContain('name: "value"');
    expect(result.code).toContain('name: "checked"');
    expect(result.code).toContain('name: "onChange"');
    expect(result.code).toContain('name: "onInput"');
    expect(result.code).toContain("const _farmCurrentTargetValue = event.currentTarget.value");
    expect(result.code).toContain("const _farmCurrentTargetChecked = event.currentTarget.checked");
    expect(result.code).toContain("label: _farmCurrentTargetValue");
    expect(result.code).toContain("done: _farmCurrentTargetChecked");
    expect(result.code).not.toContain("addEventListener");
    await expect(
      transformWithEsbuild(result.code, "/app/InteractiveRows.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({ code: expect.stringContaining("farmBlocks.KeyedRows") });
  });

  it("supports controlled keyed-row inputs through the public List boundary", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <ul>
              <List each={items} by={(item) => item.id}>
                {(item) => (
                  <li>
                    <input
                      onChange={(event) => setItems((current) => current.map((row) => row.id === item.id ? { ...row, label: event.currentTarget.value } : row))}
                      value={item.label}
                    />
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
    expect(result.code).toContain("delegateEvents={true}");
    expect(result.code).toContain("_farmRowEvent(item, 0, 0)");
  });

  it("keeps non-bubbling enter events on the React-owned row path", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return <ul>{items.map((item) => (
          <li key={item.id} onMouseEnter={() => setItems([])}>{item.label}</li>
        ))}</ul>;
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRows");
    expect(result.code).not.toContain("delegateEvents={true}");
  });

  it.each([
    {
      name: "a file input value",
      control: '<input type="file" value={item.label} onChange={(event) => setItems([])} />',
    },
    {
      name: "a dynamic input type",
      control: "<input type={item.type} value={item.label} onChange={(event) => setItems([])} />",
    },
    {
      name: "dynamic select options",
      control:
        "<select value={item.label} onChange={(event) => setItems([])}><option value={item.label}>{item.label}</option></select>",
    },
    {
      name: "textarea children alongside value",
      control:
        "<textarea value={item.label} onChange={(event) => setItems([])}>{item.label}</textarea>",
    },
    {
      name: "content-editable state",
      control: "<div contentEditable onInput={(event) => setItems([])}>{item.label}</div>",
    },
  ])("keeps $name in the React-owned list fallback", async ({ control }) => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha", type: "text" }]);
        return (
          <section>
            <ul>{items.map((item) => <li key={item.id}>${control}</li>)}</ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Tasks"]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRows");
  });

  it("snapshots deferred form values even when the row falls back to React", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Tasks() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha", type: "text" }]);
        return (
          <section>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <input
                    type={item.type}
                    value={item.label}
                    onChange={(event) => setItems((current) => current.map((row) => row.id === item.id ? { ...row, label: event.currentTarget.value } : row))}
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
    expect(result.code).toContain("const _farmCurrentTargetValue = event.currentTarget.value");
    expect(result.code).toContain("label: _farmCurrentTargetValue");
  });
});
