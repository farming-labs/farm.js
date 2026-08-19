import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompilerKeyedRowElement,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
  selected?: boolean;
}

const roots: Array<{ unmount(): void }> = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function rowDescriptor(item: Item): CompilerKeyedRowElement {
  return {
    kind: "element",
    tag: "li",
    attributes: [
      { name: "data-key", value: item.id },
      { name: "aria-selected", value: Boolean(item.selected) },
    ],
    styles: [],
    children: [item.label],
  };
}

describe("compiled keyed-row runtime", () => {
  it("patches, inserts, removes, and reorders persistent row instances", async () => {
    let executions = 0;
    let listRenders = 0;
    const Inventory = createCompiledComponent({
      displayName: "CompiledRows",
      initialize: () => [
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        const KeyedRows = blocks.KeyedRows;
        const items = () => state[0].get() as Item[];
        return (
          <section>
            <button
              data-action="update"
              onClick={() =>
                state[0].set(() => [
                  { id: "c", label: "Gamma" },
                  { id: "b", label: "Bravo", selected: true },
                  { id: "d", label: "Delta" },
                ])
              }
            >
              Update
            </button>
            <KeyedRows
              id={0}
              render={() => {
                listRenders += 1;
                return (
                  <ul>
                    {items().map((item) => (
                      <li aria-selected={Boolean(item.selected)} data-key={item.id} key={item.id}>
                        {item.label}
                      </li>
                    ))}
                  </ul>
                );
              }}
              items={items}
              rowKey={(item) => (item as Item).id}
              create={(item) => rowDescriptor(item as Item)}
              bindings={[
                {
                  kind: "attribute",
                  path: [],
                  name: "data-key",
                  read: (item) => (item as Item).id,
                },
                {
                  kind: "attribute",
                  path: [],
                  name: "aria-selected",
                  read: (item) => Boolean((item as Item).selected),
                },
                {
                  kind: "text",
                  path: [],
                  read: (item) => [(item as Item).label],
                },
              ]}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Inventory />));

    const initial = new Map(
      [...container.querySelectorAll<HTMLLIElement>("li")].map((row) => [row.dataset.key, row]),
    );
    expect(executions).toBe(1);
    expect(listRenders).toBe(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll<HTMLLIElement>("li")];
    expect(rows.map((row) => [row.dataset.key, row.textContent])).toEqual([
      ["c", "Gamma"],
      ["b", "Bravo"],
      ["d", "Delta"],
    ]);
    expect(rows[0]).toBe(initial.get("c"));
    expect(rows[1]).toBe(initial.get("b"));
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    expect(initial.get("a")?.isConnected).toBe(false);
    expect(executions).toBe(1);
    expect(listRenders).toBe(1);
  });

  it("uses LIS to move only the rows outside the stable subsequence", async () => {
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    const Inventory = createCompiledComponent({
      displayName: "LisRows",
      initialize: () => [["a", "b", "c", "d"]],
      render(_props: Record<string, never>, state, blocks) {
        setItems = (next) => state[0].set(next);
        const items = () => state[0].get() as string[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <KeyedRows
              id={0}
              render={() => (
                <ol>
                  {items().map((item) => (
                    <li key={item}>{item.toUpperCase()}</li>
                  ))}
                </ol>
              )}
              items={items}
              rowKey={(item) => item as string}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [],
                styles: [],
                children: [String(item).toUpperCase()],
              })}
              bindings={[{ kind: "text", path: [], read: (item) => [String(item).toUpperCase()] }]}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Inventory />));
    const list = container.querySelector("ol")!;
    const insertBefore = vi.spyOn(list, "insertBefore");

    await act(async () => {
      setItems(["d", "a", "b", "c"]);
      await flushCompilerUpdates();
    });

    expect([...list.children].map((row) => row.textContent)).toEqual(["D", "A", "B", "C"]);
    expect(insertBefore).toHaveBeenCalledTimes(1);
  });

  it("remounts the list under React when runtime keys are duplicated", async () => {
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    let listRenders = 0;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Inventory = createCompiledComponent({
      displayName: "DuplicateRowsFallback",
      initialize: () => [[{ id: "a", label: "Alpha" }]],
      render(_props: Record<string, never>, state, blocks) {
        setItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              id={0}
              render={() => {
                listRenders += 1;
                return (
                  <ul>
                    {items().map((item) => (
                      <li key={item.id}>{item.label}</li>
                    ))}
                  </ul>
                );
              }}
              items={items}
              rowKey={(item) => (item as Item).id}
              create={(item) => rowDescriptor(item as Item)}
              bindings={[{ kind: "text", path: [], read: (item) => [(item as Item).label] }]}
            />
          </main>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Inventory />));

    await act(async () => {
      setItems([
        { id: "duplicate", label: "First" },
        { id: "duplicate", label: "Second" },
      ]);
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "First",
      "Second",
    ]);
    expect(listRenders).toBeGreaterThan(1);

    await act(async () => {
      setItems([{ id: "safe", label: "Safe again" }]);
      await flushCompilerUpdates();
    });
    expect(listRenders).toBeGreaterThan(2);
    expect(container.querySelector("li")?.textContent).toBe("Safe again");
  });

  it("combines parent props and local row updates without losing the newest values", async () => {
    let setPrefix: React.Dispatch<React.SetStateAction<string>> = () => undefined;
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    const Inventory = createCompiledComponent({
      displayName: "PropDrivenRows",
      initialize: () => [[{ id: "a", label: "Alpha" }]],
      render(props: { prefix: string }, state, blocks) {
        setItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <KeyedRows
              id={0}
              render={() => (
                <ul>
                  {items().map((item) => (
                    <li key={item.id}>
                      {props.prefix}:{item.label}
                    </li>
                  ))}
                </ul>
              )}
              items={items}
              rowKey={(item) => (item as Item).id}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [],
                styles: [],
                children: [[props.prefix, ":", (item as Item).label]],
              })}
              bindings={[
                {
                  kind: "text",
                  path: [],
                  read: (item) => [props.prefix, ":", (item as Item).label],
                },
              ]}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    function Parent() {
      const [prefix, updatePrefix] = useState("Old");
      setPrefix = updatePrefix;
      return <Inventory prefix={prefix} />;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Parent />));
    await act(async () => {
      setPrefix("New");
      setItems([{ id: "a", label: "Updated" }]);
      await flushCompilerUpdates();
    });
    await flushCompilerUpdates();
    expect(container.querySelector("li")?.textContent).toBe("New:Updated");
  });

  it("patches nested row text, attributes, and styles without replacing the row", async () => {
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    const Inventory = createCompiledComponent({
      displayName: "NestedCompiledRows",
      initialize: () => [[{ id: "a", label: "Alpha", selected: false }]],
      render(_props: Record<string, never>, state, blocks) {
        setItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <KeyedRows
              id={0}
              render={() => (
                <div>
                  {items().map((item) => (
                    <article key={item.id}>
                      <span
                        data-selected={Boolean(item.selected)}
                        style={{ opacity: item.selected ? 1 : 0.5 }}
                      >
                        {item.label}
                      </span>
                    </article>
                  ))}
                </div>
              )}
              items={items}
              rowKey={(item) => (item as Item).id}
              create={(item) => ({
                kind: "element",
                tag: "article",
                attributes: [],
                styles: [],
                children: [
                  {
                    kind: "element",
                    tag: "span",
                    attributes: [
                      { name: "data-selected", value: Boolean((item as Item).selected) },
                    ],
                    styles: [{ name: "opacity", value: (item as Item).selected ? 1 : 0.5 }],
                    children: [(item as Item).label],
                  },
                ],
              })}
              bindings={[
                {
                  kind: "attribute",
                  path: [0],
                  name: "data-selected",
                  read: (item) => Boolean((item as Item).selected),
                },
                {
                  kind: "style",
                  path: [0],
                  name: "opacity",
                  read: (item) => ((item as Item).selected ? 1 : 0.5),
                },
                { kind: "text", path: [0], read: (item) => [(item as Item).label] },
              ]}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Inventory />));
    const row = container.querySelector("article")!;

    await act(async () => {
      setItems([{ id: "a", label: "Selected", selected: true }]);
      await flushCompilerUpdates();
    });

    const span = container.querySelector("span")!;
    expect(container.querySelector("article")).toBe(row);
    expect(span.textContent).toBe("Selected");
    expect(span.getAttribute("data-selected")).toBe("true");
    expect(span.style.opacity).toBe("1");
  });

  it("preserves focused input identity and selection while rows reorder", async () => {
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    const Inventory = createCompiledComponent({
      displayName: "FocusedRows",
      initialize: () => [
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Bravo" },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        setItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <KeyedRows
              id={0}
              render={() => (
                <div>
                  {items().map((item) => (
                    <input data-key={item.id} key={item.id} readOnly value={item.label} />
                  ))}
                </div>
              )}
              items={items}
              rowKey={(item) => (item as Item).id}
              create={(item) => ({
                kind: "element",
                tag: "input",
                attributes: [
                  { name: "data-key", value: (item as Item).id },
                  { name: "readOnly", value: true },
                  { name: "value", value: (item as Item).label },
                ],
                styles: [],
                children: [],
              })}
              bindings={[
                {
                  kind: "attribute",
                  path: [],
                  name: "data-key",
                  read: (item) => (item as Item).id,
                },
                {
                  kind: "attribute",
                  path: [],
                  name: "value",
                  read: (item) => (item as Item).label,
                },
              ]}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Inventory />));
    const focused = container.querySelector<HTMLInputElement>("[data-key='b']")!;
    focused.focus();
    focused.setSelectionRange(1, 4, "forward");

    await act(async () => {
      setItems((value) => [...(value as Item[])].reverse());
      await flushCompilerUpdates();
    });
    expect(document.activeElement).toBe(focused);
    expect(focused.selectionStart).toBe(1);
    expect(focused.selectionEnd).toBe(4);
    expect([...container.querySelectorAll("input")].map((input) => input.dataset.key)).toEqual([
      "b",
      "a",
    ]);
  });

  it("cleans row subscriptions when an owning conditional unmounts", async () => {
    let setVisible: (next: CompilerStateUpdater) => void = () => undefined;
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    let listRenders = 0;
    const Inventory = createCompiledComponent({
      displayName: "ConditionalCompiledRows",
      initialize: () => [true, [{ id: "a", label: "Alpha" }]],
      render(_props: Record<string, never>, state, blocks) {
        setVisible = (next) => state[0].set(next);
        setItems = (next) => state[1].set(next);
        const items = () => state[1].get() as Item[];
        const Conditional = blocks.Conditional;
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <Conditional
              id={0}
              render={() =>
                Boolean(state[0].get()) && (
                  <section>
                    <KeyedRows
                      id={1}
                      render={() => {
                        listRenders += 1;
                        return (
                          <ul>
                            {items().map((item) => (
                              <li key={item.id}>{item.label}</li>
                            ))}
                          </ul>
                        );
                      }}
                      items={items}
                      rowKey={(item) => (item as Item).id}
                      create={(item) => rowDescriptor(item as Item)}
                      bindings={[
                        {
                          kind: "text",
                          path: [],
                          read: (item) => [(item as Item).label],
                        },
                      ]}
                    />
                  </section>
                )
              }
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Inventory />));
    expect(listRenders).toBe(1);

    await act(async () => {
      setVisible(false);
      await flushCompilerUpdates();
    });
    expect(container.querySelector("ul")).toBeNull();

    await act(async () => {
      setItems((value) => [...(value as Item[]), { id: "b", label: "Beta" }]);
      await flushCompilerUpdates();
    });
    expect(listRenders).toBe(1);

    await act(async () => {
      setVisible(true);
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(listRenders).toBe(2);
  });

  it("hydrates, survives StrictMode, and ignores a queued update after unmount", async () => {
    const errors: unknown[] = [];
    const Inventory = createCompiledComponent({
      displayName: "HydratedCompiledRows",
      initialize: () => [[{ id: "a", label: "Alpha" }]],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <button
              onClick={() =>
                state[0].set((value) => [...(value as Item[]), { id: "b", label: "Beta" }])
              }
            >
              Add
            </button>
            <KeyedRows
              id={0}
              render={() => (
                <ul>
                  {items().map((item) => (
                    <li key={item.id}>{item.label}</li>
                  ))}
                </ul>
              )}
              items={items}
              rowKey={(item) => (item as Item).id}
              create={(item) => rowDescriptor(item as Item)}
              bindings={[{ kind: "text", path: [], read: (item) => [(item as Item).label] }]}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <StrictMode>
        <Inventory />
      </StrictMode>,
    );
    document.body.append(container);
    await act(async () => {
      const root = hydrateRoot(
        container,
        <StrictMode>
          <Inventory />
        </StrictMode>,
        { onRecoverableError: (error) => errors.push(error) },
      );
      roots.push(root);
    });
    expect(errors).toEqual([]);

    const root = roots.pop()!;
    await act(async () => {
      container.querySelector("button")!.click();
      root.unmount();
      await flushCompilerUpdates();
    });
    expect(errors).toEqual([]);
  });

  it("matches React across 1,000 deterministic keyed operations", async () => {
    type Update = (items: Item[]) => Item[];
    let compiledSet: (next: CompilerStateUpdater) => void = () => undefined;
    let reactSet: React.Dispatch<React.SetStateAction<Item[]>> = () => undefined;
    let compiledRenders = 0;
    const initial: Item[] = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ];

    const Compiled = createCompiledComponent({
      displayName: "RandomCompiledRows",
      initialize: () => [initial],
      render(_props: Record<string, never>, state, blocks) {
        compiledSet = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              id={0}
              render={() => {
                compiledRenders += 1;
                return (
                  <ul>
                    {items().map((item) => (
                      <li data-key={item.id} key={item.id}>
                        {item.label}
                      </li>
                    ))}
                  </ul>
                );
              }}
              items={items}
              rowKey={(item) => (item as Item).id}
              create={(item) => rowDescriptor(item as Item)}
              bindings={[
                {
                  kind: "attribute",
                  path: [],
                  name: "data-key",
                  read: (item) => (item as Item).id,
                },
                { kind: "text", path: [], read: (item) => [(item as Item).label] },
              ]}
            />
          </main>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    function Normal() {
      const [items, setItems] = useState(initial);
      reactSet = setItems;
      return (
        <ul>
          {items.map((item) => (
            <li data-key={item.id} key={item.id}>
              {item.label}
            </li>
          ))}
        </ul>
      );
    }

    let seed = 0x5eed1234;
    let nextId = 0;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    const updates: Update[] = Array.from({ length: 1000 }, () => {
      const operation = random() % 6;
      const selector = random();
      const id = `n${nextId++}`;
      if (operation === 0) return (items) => [...items, { id, label: id.toUpperCase() }];
      if (operation === 1) return (items) => [{ id, label: id.toUpperCase() }, ...items];
      if (operation === 2) {
        return (items) =>
          items.length === 0
            ? items
            : items.filter((_, index) => index !== selector % items.length);
      }
      if (operation === 3) return (items) => [...items].reverse();
      if (operation === 4) {
        return (items) => {
          if (items.length < 2) return items;
          const next = [...items];
          const from = selector % next.length;
          const [moved] = next.splice(from, 1);
          next.splice(random() % (next.length + 1), 0, moved);
          return next;
        };
      }
      return (items) =>
        items.length === 0
          ? items
          : items.map((item, index) =>
              index === selector % items.length ? { ...item, label: `${item.label}!` } : item,
            );
    });

    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = createRoot(compiledContainer);
    const reactRoot = createRoot(reactContainer);
    roots.push(compiledRoot, reactRoot);
    await act(async () => {
      compiledRoot.render(<Compiled />);
      reactRoot.render(<Normal />);
    });

    for (let offset = 0; offset < updates.length; offset += 10) {
      await act(async () => {
        for (const update of updates.slice(offset, offset + 10)) {
          compiledSet((value) => update(value as Item[]));
          reactSet(update);
        }
        await flushCompilerUpdates();
      });
      const snapshot = (container: Element) =>
        [...container.querySelectorAll("li")].map((row) => [
          row.getAttribute("data-key"),
          row.textContent,
        ]);
      expect(snapshot(compiledContainer)).toEqual(snapshot(reactContainer));
    }
    expect(compiledRenders).toBe(1);
  });
});
