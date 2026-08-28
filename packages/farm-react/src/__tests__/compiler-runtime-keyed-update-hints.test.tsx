import React, { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCompiledComponent,
  createCompilerKeyedMapUpdate,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
  selected: boolean;
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
});

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function descriptor(item: Item): CompilerKeyedRowElement {
  return {
    kind: "element",
    tag: "li",
    attributes: [{ name: "data-key", value: item.id }],
    styles: [],
    children: [item.label],
  };
}

function hintedMap(previous: Item[], update: (item: Item, index: number) => Item): unknown {
  const changedIndices: number[] = [];
  const value = previous.map((item, index) => {
    const next = update(item, index);
    if (next !== item) changedIndices.push(index);
    return next;
  });
  return createCompilerKeyedMapUpdate(previous, value, changedIndices);
}

describe("compiled keyed update hints", () => {
  it("patches only proven changed rows while unrelated state updates share the flush", async () => {
    const initialItems = Array.from(
      { length: 2_048 },
      (_, index): Item => ({
        id: `row-${index}`,
        label: `Row ${index}`,
        selected: false,
      }),
    );
    let executions = 0;
    let listRenders = 0;
    let keyReads = 0;
    let descriptorReads = 0;
    let bindingReads = 0;
    const Inventory = createCompiledComponent({
      displayName: "HintedInventory",
      initialize: () => [initialItems, 0],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        const items = () => state[0].get() as Item[];
        return (
          <section>
            <button
              onClick={() => {
                state[0].set((previous) =>
                  hintedMap(previous as Item[], (item, index) =>
                    index === 1_337 ? { ...item, label: "Updated 1337", selected: true } : item,
                  ),
                );
                state[1].set((value) => Number(value) + 1);
              }}
            >
              Update
            </button>
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              id={0}
              items={items}
              structureDependencies={[0]}
              render={() => {
                listRenders += 1;
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
              rowKey={(item) => {
                keyReads += 1;
                return (item as Item).id;
              }}
              create={(item) => {
                descriptorReads += 1;
                return descriptor(item as Item);
              }}
              bindings={[
                {
                  kind: "text",
                  path: [],
                  read: (item) => {
                    bindingReads += 1;
                    return [(item as Item).label];
                  },
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
    const before = container.querySelector<HTMLElement>('[data-key="row-1337"]');
    keyReads = 0;
    descriptorReads = 0;
    bindingReads = 0;

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });

    const after = container.querySelector<HTMLElement>('[data-key="row-1337"]');
    expect(after).toBe(before);
    expect(after?.textContent).toBe("Updated 1337");
    expect(executions).toBe(1);
    expect(listRenders).toBe(1);
    expect(keyReads).toBe(1);
    expect(descriptorReads).toBe(0);
    expect(bindingReads).toBe(1);
  });

  it("falls back to complete keyed reconciliation when a hinted row changes its key", async () => {
    let setItems: (next: unknown) => void = () => undefined;
    const Inventory = createCompiledComponent({
      displayName: "KeyChangingInventory",
      initialize: () => [
        [
          { id: "a", label: "Alpha", selected: false },
          { id: "b", label: "Beta", selected: false },
          { id: "c", label: "Gamma", selected: false },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        setItems = (next) => state[0].set(next);
        return (
          <section>
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              id={0}
              items={items}
              structureDependencies={[0]}
              render={() => (
                <ul>
                  {items().map((item) => (
                    <li data-key={item.id} key={item.id}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
              create={(item) => descriptor(item as Item)}
              bindings={[{ kind: "text", path: [], read: (item) => [(item as Item).label] }]}
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
    const alpha = container.querySelector('[data-key="a"]');
    const gamma = container.querySelector('[data-key="c"]');

    await act(async () => {
      setItems((previous: Item[]) =>
        hintedMap(previous, (item) =>
          item.id === "b" ? { ...item, id: "z", label: "Zeta" } : item,
        ),
      );
      await flushCompilerUpdates();
    });

    expect(
      [...container.querySelectorAll<HTMLElement>("li")].map((row) => [
        row.dataset.key,
        row.textContent,
      ]),
    ).toEqual([
      ["a", "Alpha"],
      ["z", "Zeta"],
      ["c", "Gamma"],
    ]);
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
  });

  it("rejects a hint whose source follows an unhinted update in the same flush", async () => {
    let setItems: (next: unknown) => void = () => undefined;
    let keyReads = 0;
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", selected: false },
      { id: "b", label: "Beta", selected: false },
      { id: "c", label: "Gamma", selected: false },
    ];
    const Inventory = createCompiledComponent({
      displayName: "MixedHintInventory",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        setItems = (next) => state[0].set(next);
        return (
          <section>
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              id={0}
              items={items}
              structureDependencies={[0]}
              render={() => (
                <ul>
                  {items().map((item) => (
                    <li data-key={item.id} key={item.id}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => {
                keyReads += 1;
                return (item as Item).id;
              }}
              create={(item) => descriptor(item as Item)}
              bindings={[{ kind: "text", path: [], read: (item) => [(item as Item).label] }]}
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
    keyReads = 0;

    await act(async () => {
      setItems((previous: Item[]) =>
        previous.map((item) => (item.id === "a" ? { ...item, label: "Alpha plain" } : item)),
      );
      setItems((previous: Item[]) =>
        hintedMap(previous, (item) =>
          item.id === "c" ? { ...item, label: "Gamma hinted" } : item,
        ),
      );
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha plain",
      "Beta",
      "Gamma hinted",
    ]);
    expect(keyReads).toBe(initialItems.length);
  });

  it("shares one hinted collection update across multiple keyed boundaries", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", selected: false },
      { id: "b", label: "Beta", selected: false },
    ];
    let update: () => void = () => undefined;
    let keyReads = 0;
    const Inventory = createCompiledComponent({
      displayName: "SharedHintInventory",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        update = () =>
          state[0].set((previous) =>
            hintedMap(previous as Item[], (item) =>
              item.id === "b" ? { ...item, label: "Beta updated" } : item,
            ),
          );
        const list = (id: number, owner: string) => (
          <blocks.KeyedRows
            collectionDependency={0}
            dependencies={[0]}
            id={id}
            items={items}
            structureDependencies={[0]}
            render={() => (
              <ul data-owner={owner}>
                {items().map((item) => (
                  <li data-key={item.id} key={item.id}>
                    {item.label}
                  </li>
                ))}
              </ul>
            )}
            rowKey={(item) => {
              keyReads += 1;
              return (item as Item).id;
            }}
            create={(item) => descriptor(item as Item)}
            bindings={[{ kind: "text", path: [], read: (item) => [(item as Item).label] }]}
          />
        );
        return (
          <section>
            {list(0, "first")}
            {list(1, "second")}
          </section>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, dependencies: [0] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Inventory />));
    keyReads = 0;

    await act(async () => {
      update();
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-owner="first"]')?.textContent).toBe("AlphaBeta updated");
    expect(container.querySelector('[data-owner="second"]')?.textContent).toBe("AlphaBeta updated");
    expect(keyReads).toBe(2);
  });

  it("matches React across 2,000 deterministic queued same-key updates", async () => {
    const initialItems = Array.from(
      { length: 128 },
      (_, index): Item => ({
        id: `row-${index}`,
        label: `Row ${index}`,
        selected: false,
      }),
    );
    let compiledExecutions = 0;
    let updateCompiled: (index: number) => void = () => undefined;
    let updateReact: (index: number) => void = () => undefined;
    const Compiled = createCompiledComponent({
      displayName: "RandomHintedInventory",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        compiledExecutions += 1;
        const items = () => state[0].get() as Item[];
        updateCompiled = (target) =>
          state[0].set((previous) =>
            hintedMap(previous as Item[], (item, index) =>
              index === target
                ? { ...item, label: `${item.label}!`, selected: !item.selected }
                : item,
            ),
          );
        return (
          <section>
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              id={0}
              items={items}
              structureDependencies={[0]}
              render={() => (
                <ol data-owner="compiled">
                  {items().map((item) => (
                    <li data-key={item.id} data-selected={item.selected} key={item.id}>
                      {item.label}
                    </li>
                  ))}
                </ol>
              )}
              rowKey={(item) => (item as Item).id}
              create={(item) => descriptor(item as Item)}
              bindings={[
                {
                  kind: "attribute",
                  path: [],
                  name: "data-selected",
                  read: (item) => (item as Item).selected,
                },
                { kind: "text", path: [], read: (item) => [(item as Item).label] },
              ]}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    function Normal() {
      const [items, setItems] = useState(initialItems);
      updateReact = (target) =>
        setItems((previous) =>
          previous.map((item, index) =>
            index === target
              ? { ...item, label: `${item.label}!`, selected: !item.selected }
              : item,
          ),
        );
      return (
        <ol data-owner="react">
          {items.map((item) => (
            <li data-key={item.id} data-selected={item.selected} key={item.id}>
              {item.label}
            </li>
          ))}
        </ol>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <>
          <Compiled />
          <Normal />
        </>,
      ),
    );

    let random = 0x12345678;
    for (let batch = 0; batch < 100; batch += 1) {
      await act(async () => {
        for (let update = 0; update < 20; update += 1) {
          random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
          const index = random % initialItems.length;
          updateCompiled(index);
          updateReact(index);
        }
        await flushCompilerUpdates();
      });
      expect(container.querySelector('[data-owner="compiled"]')?.innerHTML).toBe(
        container.querySelector('[data-owner="react"]')?.innerHTML,
      );
    }
    expect(compiledExecutions).toBe(1);
  });
});
