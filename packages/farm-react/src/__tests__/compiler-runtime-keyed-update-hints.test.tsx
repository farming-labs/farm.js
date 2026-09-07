import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

type ApplyMap = (collection: unknown, method: unknown, callback: unknown) => unknown;

function hintedMaps(
  previous: Item[],
  updates: readonly ((item: Item, index: number) => Item)[],
): unknown {
  return createCompilerKeyedMapUpdate(previous, (current: unknown, applyMap: ApplyMap) => {
    let value = current as Item[];
    for (const update of updates) {
      const method = value.map;
      value = applyMap(value, method, update) as Item[];
    }
    return value;
  });
}

function hintedMap(previous: Item[], update: (item: Item, index: number) => Item): unknown {
  return hintedMaps(previous, [update]);
}

function createMapHarness(initialItems: Item[]) {
  let setItems: (update: (previous: Item[]) => unknown) => void = () => undefined;
  const counters = { bindings: 0, descriptors: 0, executions: 0, keys: 0, renders: 0 };
  const Table = createCompiledComponent({
    displayName: "MultiMapInventory",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      setItems = (update) => state[0].set((previous) => update(previous as Item[]));
      return (
        <section>
          <blocks.KeyedRows
            collectionDependency={0}
            dependencies={[0]}
            id={0}
            items={items}
            structureDependencies={[0]}
            render={() => {
              counters.renders += 1;
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
              counters.keys += 1;
              return (item as Item).id;
            }}
            create={(item) => {
              counters.descriptors += 1;
              return descriptor(item as Item);
            }}
            bindings={[
              {
                kind: "text",
                path: [],
                read: (item) => {
                  counters.bindings += 1;
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
  return {
    counters,
    setItems(update: (previous: Item[]) => unknown) {
      setItems(update);
    },
    Table,
  };
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
                  hintedMaps(previous as Item[], [
                    (item, index) => (index === 1_337 ? { ...item, label: "Updated 1337" } : item),
                    (item, index) => (index === 1_337 ? { ...item, selected: true } : item),
                  ]),
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

  it("patches different rows changed by separate map stages exactly once", async () => {
    const harness = createMapHarness([
      { id: "a", label: "Alpha", selected: false },
      { id: "b", label: "Beta", selected: false },
      { id: "c", label: "Gamma", selected: false },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const originalRows = new Map(
      [...container.querySelectorAll<HTMLElement>("li")].map((row) => [row.dataset.key, row]),
    );
    harness.counters.bindings = 0;
    harness.counters.descriptors = 0;
    harness.counters.keys = 0;

    await act(async () => {
      harness.setItems((previous) =>
        hintedMaps(previous, [
          (item) => (item.id === "a" ? { ...item, label: "Alpha newest" } : item),
          (item) => (item.id === "c" ? { ...item, label: "Gamma newest" } : item),
        ]),
      );
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha newest",
      "Beta",
      "Gamma newest",
    ]);
    for (const [key, row] of originalRows) {
      expect(container.querySelector(`[data-key="${key}"]`)).toBe(row);
    }
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(2);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(2);
  });

  it("drops the complete chain hint when a later map method is custom", async () => {
    const harness = createMapHarness([
      { id: "a", label: "Alpha", selected: false },
      { id: "b", label: "Beta", selected: false },
      { id: "c", label: "Gamma", selected: false },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    harness.counters.bindings = 0;
    harness.counters.keys = 0;
    const customMap = function (
      this: Item[],
      callback: (item: Item, index: number) => Item,
    ): Item[] {
      return Array.prototype.map.call(this, callback);
    };

    await act(async () => {
      harness.setItems((previous) =>
        createCompilerKeyedMapUpdate(previous, (current: unknown, applyMap: ApplyMap) => {
          const source = current as Item[];
          const firstMethod = source.map;
          const first = applyMap(source, firstMethod, (item: Item) =>
            item.id === "a" ? { ...item, label: "Alpha first" } : item,
          ) as Item[];
          return applyMap(first, customMap, (item: Item) =>
            item.id === "c" ? { ...item, label: "Gamma custom" } : item,
          );
        }),
      );
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha first",
      "Beta",
      "Gamma custom",
    ]);
    expect(harness.counters.keys).toBe(3);
    expect(harness.counters.bindings).toBe(3);
  });

  it("falls back after native map runs on an array subclass", async () => {
    class ItemRows extends Array<Item> {}
    const initialItems = new ItemRows();
    initialItems.push(
      { id: "a", label: "Alpha", selected: false },
      { id: "b", label: "Beta", selected: false },
      { id: "c", label: "Gamma", selected: false },
    );
    const harness = createMapHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    harness.counters.bindings = 0;
    harness.counters.keys = 0;

    await act(async () => {
      harness.setItems((previous) =>
        hintedMap(previous, (item) =>
          item.id === "b" ? { ...item, label: "Beta subclass" } : item,
        ),
      );
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha",
      "Beta subclass",
      "Gamma",
    ]);
    expect(harness.counters.keys).toBe(3);
    expect(harness.counters.bindings).toBe(3);
  });

  it("preserves errors thrown by a later native map stage", () => {
    const initialItems: Item[] = [{ id: "a", label: "Alpha", selected: false }];

    expect(() =>
      hintedMaps(initialItems, [
        (item) => ({ ...item, label: "First" }),
        () => {
          throw new Error("second map failed");
        },
      ]),
    ).toThrow("second map failed");
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
        hintedMaps(previous, [
          (item) => (item.id === "b" ? { ...item, label: "Beta first" } : item),
          (item) => (item.id === "b" ? { ...item, id: "z", label: "Zeta" } : item),
        ]),
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

  it("keeps the older precomputed value/index helper form compatible", () => {
    const previous: Item[] = [{ id: "a", label: "Alpha", selected: false }];
    const next = [{ ...previous[0], label: "Updated" }];

    expect(createCompilerKeyedMapUpdate(previous, next, [0])).toBe(next);
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
            hintedMaps(previous as Item[], [
              (item, index) => (index === target ? { ...item, label: `${item.label}!` } : item),
              (item, index) => (index === target ? { ...item, selected: !item.selected } : item),
            ]),
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
          previous
            .map((item, index) => (index === target ? { ...item, label: `${item.label}!` } : item))
            .map((item, index) =>
              index === target ? { ...item, selected: !item.selected } : item,
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

  it("hydrates consecutive map hints in StrictMode and drops a queued update after unmount", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", selected: false },
      { id: "b", label: "Beta", selected: false },
      { id: "c", label: "Gamma", selected: false },
    ];
    const hydration = createMapHarness(initialItems);
    const container = document.createElement("div");
    container.innerHTML = renderToString(<hydration.Table />);
    document.body.append(container);
    const recoverable: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(
        container,
        <StrictMode>
          <hydration.Table />
        </StrictMode>,
        { onRecoverableError: (error) => recoverable.push(error) },
      );
    });
    roots.push(root);
    const alpha = container.querySelector('[data-key="a"]');
    await act(async () => {
      hydration.setItems((previous) =>
        hintedMaps(previous, [
          (item) => (item.id === "a" ? { ...item, label: "Alpha hydrated" } : item),
          (item) => (item.id === "a" ? { ...item, selected: true } : item),
        ]),
      );
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha hydrated",
      "Beta",
      "Gamma",
    ]);
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(recoverable).toEqual([]);

    const unmounted = createMapHarness(initialItems);
    const unmountContainer = document.createElement("div");
    document.body.append(unmountContainer);
    const unmountRoot = createRoot(unmountContainer);
    await act(async () => unmountRoot.render(<unmounted.Table />));
    act(() => {
      unmounted.setItems((previous) =>
        hintedMaps(previous, [
          (item) => (item.id === "b" ? { ...item, label: "Never" } : item),
          (item) => (item.id === "b" ? { ...item, selected: true } : item),
        ]),
      );
      unmountRoot.unmount();
    });
    await flushCompilerUpdates();
    expect(unmountContainer.innerHTML).toBe("");
  });
});
