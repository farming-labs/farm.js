import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  createCompilerKeyedArrayMapPipeline,
  createCompilerKeyedArrayMapReorder,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
  rank: number;
}

const roots: Root[] = [];
const stressIt = process.env.FARM_REACT_STRESS === "1" ? it : it.skip;

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

function hintedMap(
  items: Item[],
  callback: (item: Item, index: number, items: Item[]) => Item,
): Item[] {
  return createCompilerKeyedArrayMapPipeline(items, items.map, callback) as Item[];
}

function hintedMaps(
  items: Item[],
  firstCallback: (item: Item, index: number, items: Item[]) => Item,
  secondCallback: (item: Item, index: number, items: Item[]) => Item,
): Item[] {
  return createCompilerKeyedArrayMapPipeline(
    items,
    (
      current: unknown,
      applyMap: (collection: unknown, method: unknown, callback: unknown) => unknown,
    ) => {
      const firstItems = current as Item[];
      const firstMap = firstItems.map;
      const first = applyMap(firstItems, firstMap, firstCallback) as Item[];
      const secondMap = first.map;
      return applyMap(first, secondMap, secondCallback);
    },
  ) as Item[];
}

function hintedSort(items: Item[]): Item[] {
  return createCompilerKeyedArrayMapReorder(
    items,
    items.toSorted,
    (left: Item, right: Item) => left.rank - right.rank,
  ) as Item[];
}

function hintedReverse(items: Item[]): Item[] {
  return createCompilerKeyedArrayMapReorder(items, items.toReversed) as Item[];
}

function mappedSort(items: Item[], id: string, rank: number, label?: string): Item[] {
  return hintedSort(
    hintedMap(items, (item) =>
      item.id === id ? { ...item, rank, ...(label === undefined ? {} : { label }) } : item,
    ),
  );
}

function multiMappedSort(items: Item[], id: string, rank: number, label: string): Item[] {
  return hintedSort(
    hintedMaps(
      items,
      (item) => (item.id === id ? { ...item, label } : item),
      (item) => (item.id === id ? { ...item, rank } : item),
    ),
  );
}

function multiMappedReverse(items: Item[], id: string, rank: number, label: string): Item[] {
  return hintedReverse(
    hintedMaps(
      items,
      (item) => (item.id === id ? { ...item, label } : item),
      (item) => (item.id === id ? { ...item, rank } : item),
    ),
  );
}

function multiMappedReversals(
  items: Item[],
  id: string,
  rank: number,
  label: string,
  repetitions: number,
): Item[] {
  let value = hintedMaps(
    items,
    (item) => (item.id === id ? { ...item, label } : item),
    (item) => (item.id === id ? { ...item, rank } : item),
  );
  for (let count = 0; count < repetitions; count += 1) value = hintedReverse(value);
  return value;
}

function rowDescriptor(item: Item): CompilerKeyedRowElement {
  return {
    kind: "element",
    tag: "li",
    attributes: [{ name: "data-key", value: item.id }],
    styles: [],
    children: [`${item.label}:${item.rank}`],
  };
}

function labels(container: Element): string[] {
  return [...container.querySelectorAll("li")].map((row) => row.textContent || "");
}

function createHarness(initialItems: Item[]) {
  const counters = {
    bindings: 0,
    descriptors: 0,
    executions: 0,
    keys: 0,
    renders: 0,
  };
  let editAndSort: (id: string, rank: number, label?: string) => void = () => undefined;
  let editTwoAndSort: (labelId: string, rankId: string) => void = () => undefined;
  let editTwiceAndSort: (id: string, rank: number, label: string) => void = () => undefined;
  let editTwiceAndReverse: (id: string, rank: number, label: string) => void = () => undefined;
  let editTwiceAndReverseMany: (
    id: string,
    rank: number,
    label: string,
    repetitions: number,
  ) => void = () => undefined;
  let editSortReverse: (id: string, rank: number) => void = () => undefined;
  let queueEdits: (edits: readonly { id: string; rank: number; label: string }[]) => void = () =>
    undefined;
  let queueSortThenMapReverse: () => void = () => undefined;
  let invalidateKey: () => void = () => undefined;
  let customMap: () => void = () => undefined;
  let customSecondMap: () => void = () => undefined;
  const Table = createCompiledComponent({
    displayName: "MapReorderTable",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      editAndSort = (id, rank, label) =>
        state[0].set((previous) => mappedSort(previous as Item[], id, rank, label));
      editTwoAndSort = (labelId, rankId) =>
        state[0].set((previous) =>
          hintedSort(
            hintedMaps(
              previous as Item[],
              (item) => (item.id === labelId ? { ...item, label: `${item.label} labeled` } : item),
              (item) => (item.id === rankId ? { ...item, rank: 4 } : item),
            ),
          ),
        );
      editTwiceAndSort = (id, rank, label) =>
        state[0].set((previous) => multiMappedSort(previous as Item[], id, rank, label));
      editTwiceAndReverse = (id, rank, label) =>
        state[0].set((previous) => multiMappedReverse(previous as Item[], id, rank, label));
      editTwiceAndReverseMany = (id, rank, label, repetitions) =>
        state[0].set((previous) =>
          multiMappedReversals(previous as Item[], id, rank, label, repetitions),
        );
      editSortReverse = (id, rank) =>
        state[0].set((previous) => hintedReverse(mappedSort(previous as Item[], id, rank)));
      queueEdits = (edits) => {
        for (const edit of edits) {
          state[0].set((previous) =>
            multiMappedSort(previous as Item[], edit.id, edit.rank, edit.label),
          );
        }
      };
      queueSortThenMapReverse = () => {
        state[0].set((previous) =>
          hintedSort(
            hintedMap(previous as Item[], (item) =>
              item.id === "a" ? { ...item, label: "Alpha sorted" } : item,
            ),
          ),
        );
        state[0].set((previous) =>
          hintedReverse(
            hintedMap(previous as Item[], (item) =>
              item.id === "c" ? { ...item, label: "Gamma reversed" } : item,
            ),
          ),
        );
      };
      invalidateKey = () =>
        state[0].set((previous) =>
          hintedReverse(
            hintedReverse(
              hintedMap(previous as Item[], (item) =>
                item.id === "b" ? { ...item, id: "replacement", label: "Replacement" } : item,
              ),
            ),
          ),
        );
      customMap = () =>
        state[0].set((previous) => {
          const source = previous as Item[];
          const map = function (
            this: Item[],
            callback: (item: Item, index: number, items: Item[]) => Item,
          ) {
            return Array.prototype.map.call(this, callback);
          };
          const mapped = createCompilerKeyedArrayMapPipeline(source, map, (item: Item) =>
            item.id === "a" ? { ...item, label: "Custom" } : item,
          ) as Item[];
          return createCompilerKeyedArrayMapReorder(
            mapped,
            mapped.toSorted,
            (left: Item, right: Item) => left.rank - right.rank,
          );
        });
      customSecondMap = () =>
        state[0].set((previous) => {
          const second = createCompilerKeyedArrayMapPipeline(
            previous,
            (
              current: unknown,
              applyMap: (collection: unknown, method: unknown, callback: unknown) => unknown,
            ) => {
              const source = current as Item[];
              const firstMap = source.map;
              const first = applyMap(source, firstMap, (item: Item) =>
                item.id === "a" ? { ...item, label: "First map" } : item,
              ) as Item[];
              const customMap = function (
                this: Item[],
                callback: (item: Item, index: number, items: Item[]) => Item,
              ) {
                return Array.prototype.map.call(this, callback);
              };
              return applyMap(first, customMap, (item: Item) =>
                item.id === "b" ? { ...item, rank: 0 } : item,
              );
            },
          ) as Item[];
          return createCompilerKeyedArrayMapReorder(
            second,
            second.toSorted,
            (left: Item, right: Item) => left.rank - right.rank,
          );
        });
      return (
        <section>
          <blocks.KeyedRows
            collectionDependency={0}
            dependencies={[0]}
            id={0}
            items={items}
            reorderIndexIndependent
            structureDependencies={[0]}
            render={() => {
              counters.renders += 1;
              return (
                <ul>
                  {items().map((item) => (
                    <li data-key={item.id} key={item.id}>
                      {item.label}:{item.rank}
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
              return rowDescriptor(item as Item);
            }}
            bindings={[
              {
                kind: "text",
                path: [],
                read: (item) => {
                  counters.bindings += 1;
                  const row = item as Item;
                  return [`${row.label}:${row.rank}`];
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
    Table,
    counters,
    customMap: () => customMap(),
    customSecondMap: () => customSecondMap(),
    editAndSort: (id: string, rank: number, label?: string) => editAndSort(id, rank, label),
    editTwoAndSort: (labelId: string, rankId: string) => editTwoAndSort(labelId, rankId),
    editTwiceAndSort: (id: string, rank: number, label: string) =>
      editTwiceAndSort(id, rank, label),
    editTwiceAndReverse: (id: string, rank: number, label: string) =>
      editTwiceAndReverse(id, rank, label),
    editTwiceAndReverseMany: (id: string, rank: number, label: string, repetitions: number) =>
      editTwiceAndReverseMany(id, rank, label, repetitions),
    editSortReverse: (id: string, rank: number) => editSortReverse(id, rank),
    invalidateKey: () => invalidateKey(),
    queueEdits: (edits: readonly { id: string; rank: number; label: string }[]) =>
      queueEdits(edits),
    queueSortThenMapReverse: () => queueSortThenMapReverse(),
  };
}

describe("compiled keyed-array map and reorder hints", () => {
  it("patches one changed row and reorders the existing DOM in one transaction", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 2 },
      { id: "c", label: "Gamma", rank: 3 },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const rows = new Map(
      [...container.querySelectorAll("li")].map((row) => [row.dataset.key, row]),
    );
    harness.counters.bindings = 0;
    harness.counters.descriptors = 0;
    harness.counters.keys = 0;

    await act(async () => {
      harness.editAndSort("a", 4, "Alpha edited");
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Beta:2", "Gamma:3", "Alpha edited:4"]);
    for (const [key, row] of rows) {
      expect(container.querySelector(`[data-key="${key}"]`)).toBe(row);
    }
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(1);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(1);
  });

  it("composes map, sort, and reverse steps without rerunning the owner", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 2 },
      { id: "c", label: "Gamma", rank: 3 },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));

    await act(async () => {
      harness.editSortReverse("b", 5);
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Beta:5", "Gamma:3", "Alpha:1"]);
    expect(harness.counters.executions).toBe(1);
  });

  it("composes multiple map stages and patches the final row only once", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 2 },
      { id: "c", label: "Gamma", rank: 3 },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const rows = new Map(
      [...container.querySelectorAll("li")].map((row) => [row.dataset.key, row]),
    );
    harness.counters.bindings = 0;
    harness.counters.descriptors = 0;
    harness.counters.keys = 0;

    await act(async () => {
      harness.editTwiceAndSort("a", 4, "Alpha twice");
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Beta:2", "Gamma:3", "Alpha twice:4"]);
    for (const [key, row] of rows) {
      expect(container.querySelector(`[data-key="${key}"]`)).toBe(row);
    }
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(1);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(1);
  });

  it("patches mapped rows and takes the exact reverse path", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 2 },
      { id: "c", label: "Gamma", rank: 3 },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const rows = new Map(
      [...container.querySelectorAll("li")].map((row) => [row.dataset.key, row]),
    );
    const insertBefore = vi.spyOn(container.querySelector("ul")!, "insertBefore");
    harness.counters.bindings = 0;
    harness.counters.descriptors = 0;
    harness.counters.keys = 0;

    await act(async () => {
      harness.editTwiceAndReverse("a", 4, "Alpha reversed");
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Gamma:3", "Beta:2", "Alpha reversed:4"]);
    for (const [key, row] of rows) {
      expect(container.querySelector(`[data-key="${key}"]`)).toBe(row);
    }
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(1);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(1);
    expect(insertBefore).toHaveBeenCalledTimes(2);
  });

  it("tracks mapped reverse parity without generic item lookup or unnecessary moves", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 2 },
      { id: "c", label: "Gamma", rank: 3 },
    ];
    const harness = createHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const rows = [...container.querySelectorAll("li")];
    const list = container.querySelector("ul")!;
    const insertBefore = vi.spyOn(list, "insertBefore");
    const mapSet = vi.spyOn(Map.prototype, "set");
    harness.counters.bindings = 0;
    harness.counters.descriptors = 0;
    harness.counters.keys = 0;

    await act(async () => {
      harness.editTwiceAndReverseMany("a", 4, "Alpha even", 2);
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Alpha even:4", "Beta:2", "Gamma:3"]);
    expect([...container.querySelectorAll("li")]).toEqual(rows);
    expect(insertBefore).not.toHaveBeenCalled();
    expect(harness.counters.keys).toBe(1);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(1);
    expect(mapSet.mock.calls.filter(([key]) => initialItems.includes(key as Item))).toHaveLength(0);

    insertBefore.mockClear();
    mapSet.mockClear();
    await act(async () => {
      harness.editTwiceAndReverseMany("b", 5, "Beta odd", 3);
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Gamma:3", "Beta odd:5", "Alpha even:4"]);
    expect(insertBefore).toHaveBeenCalledTimes(2);
    expect(mapSet.mock.calls.filter(([key]) => initialItems.includes(key as Item))).toHaveLength(0);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
  });

  it("records consecutive map lineage with one source-to-result scan", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 2 },
      { id: "c", label: "Gamma", rank: 3 },
    ];
    const harness = createHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));

    let finalItems: Item[] | undefined;
    let descriptorReads = 0;
    const readDescriptor = Object.getOwnPropertyDescriptor;
    vi.spyOn(Object, "getOwnPropertyDescriptor").mockImplementation((target, key) => {
      if (target === initialItems || target === finalItems) descriptorReads += 1;
      return readDescriptor(target, key);
    });
    const mapped = createCompilerKeyedArrayMapPipeline(
      initialItems,
      (
        current: unknown,
        applyMap: (collection: unknown, method: unknown, callback: unknown) => unknown,
      ) => {
        const source = current as Item[];
        const first = applyMap(source, source.map, (item: Item) =>
          item.id === "a" ? { ...item, label: "Alpha newest" } : item,
        ) as Item[];
        finalItems = applyMap(first, first.map, (item: Item) =>
          item.id === "a" ? { ...item, rank: 4 } : item,
        ) as Item[];
        return finalItems;
      },
    );

    expect(mapped).toBe(finalItems);
    expect(descriptorReads).toBe(initialItems.length * 2);
  });

  it("keeps source lineage for different rows changed by separate map stages", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 2 },
      { id: "c", label: "Gamma", rank: 3 },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const rows = new Map(
      [...container.querySelectorAll("li")].map((row) => [row.dataset.key, row]),
    );
    harness.counters.bindings = 0;
    harness.counters.descriptors = 0;
    harness.counters.keys = 0;

    await act(async () => {
      harness.editTwoAndSort("c", "a");
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Beta:2", "Gamma labeled:3", "Alpha:4"]);
    for (const [key, row] of rows) {
      expect(container.querySelector(`[data-key="${key}"]`)).toBe(row);
    }
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.keys).toBe(2);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(2);
  });

  it("composes queued multi-map reorders against the last committed rows", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 2 },
      { id: "c", label: "Gamma", rank: 3 },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));

    await act(async () => {
      harness.queueEdits([
        { id: "a", rank: 6, label: "Alpha newest" },
        { id: "c", rank: 0, label: "Gamma newest" },
      ]);
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Gamma newest:0", "Beta:2", "Alpha newest:6"]);
    expect(harness.counters.executions).toBe(1);
  });

  it("keeps a map after a queued reorder on the general permutation path", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const rows = new Map(
      [...container.querySelectorAll("li")].map((row) => [row.dataset.key, row]),
    );
    harness.counters.bindings = 0;
    harness.counters.descriptors = 0;
    harness.counters.keys = 0;

    await act(async () => {
      harness.queueSortThenMapReverse();
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Alpha sorted:3", "Gamma reversed:2", "Beta:1"]);
    for (const [key, row] of rows) {
      expect(container.querySelector(`[data-key="${key}"]`)).toBe(row);
    }
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.keys).toBe(2);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(2);
  });

  it("falls back before DOM writes for custom map methods and changed keys", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 2 },
      { id: "b", label: "Beta", rank: 1 },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const bindingsBeforeFallback = harness.counters.bindings;
    await act(async () => {
      harness.customMap();
      await flushCompilerUpdates();
    });
    expect(labels(container)).toEqual(["Beta:1", "Custom:2"]);
    expect(harness.counters.bindings - bindingsBeforeFallback).toBe(2);

    await act(async () => {
      harness.invalidateKey();
      await flushCompilerUpdates();
    });
    expect(labels(container)).toEqual(["Replacement:1", "Custom:2"]);
  });

  it("discards earlier map lineage when a later map method is custom", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 2 },
      { id: "b", label: "Beta", rank: 1 },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    harness.counters.bindings = 0;

    await act(async () => {
      harness.customSecondMap();
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Beta:0", "First map:2"]);
    expect(harness.counters.bindings).toBe(2);
  });

  it("falls back for Array subclasses while preserving native results and keyed identity", async () => {
    class ItemList extends Array<Item> {}
    const initialItems = new ItemList();
    initialItems.push({ id: "a", label: "Alpha", rank: 2 }, { id: "b", label: "Beta", rank: 1 });
    const harness = createHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const rows = new Map(
      [...container.querySelectorAll("li")].map((row) => [row.dataset.key, row]),
    );
    harness.counters.bindings = 0;

    await act(async () => {
      harness.editTwiceAndReverseMany("a", 3, "Alpha subclass", 2);
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Alpha subclass:3", "Beta:1"]);
    expect(container.querySelector('[data-key="a"]')).toBe(rows.get("a"));
    expect(container.querySelector('[data-key="b"]')).toBe(rows.get("b"));
    expect(harness.counters.bindings).toBe(2);
  });

  it("preserves a native error thrown by a later map stage", () => {
    const items: Item[] = [{ id: "a", label: "Alpha", rank: 1 }];
    expect(() =>
      hintedMaps(
        items,
        (item) => item,
        () => {
          throw new Error("second map failed");
        },
      ),
    ).toThrow("second map failed");
  });

  it("reads accessor-backed source items only through the native map before falling back", async () => {
    const alpha: Item = { id: "a", label: "Alpha", rank: 2 };
    const initialItems: Item[] = [alpha, { id: "b", label: "Beta", rank: 1 }];
    let reads = 0;
    Object.defineProperty(initialItems, 0, {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return alpha;
      },
    });
    const harness = createHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    reads = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.editAndSort("b", 3, "Beta newest");
      await flushCompilerUpdates();
    });

    expect(reads).toBe(1);
    expect(labels(container)).toEqual(["Alpha:2", "Beta newest:3"]);
    expect(harness.counters.bindings).toBe(2);
  });

  it("preserves focus and selection while a controlled row moves", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 2 },
      { id: "c", label: "Gamma", rank: 3 },
    ];
    let update = () => undefined;
    const Form = createCompiledComponent({
      displayName: "MapReorderForm",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        update = () =>
          state[0].set((previous) =>
            hintedReverse(
              hintedMap(previous as Item[], (item) =>
                item.id === "a" ? { ...item, label: "Alpha newest" } : item,
              ),
            ),
          );
        return (
          <section>
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              id={0}
              items={items}
              reorderIndexIndependent
              structureDependencies={[0]}
              render={() => (
                <div>
                  {items().map((item) => (
                    <input data-key={item.id} key={item.id} readOnly value={item.label} />
                  ))}
                </div>
              )}
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
                  name: "value",
                  path: [],
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
    await act(async () => root.render(<Form />));
    const input = container.querySelector('[data-key="a"]') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(1, 3);

    await act(async () => {
      update();
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="a"]')).toBe(input);
    expect(input.value).toBe("Alpha newest");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  });

  it("dispatches a moved row event with the newest item and index", async () => {
    const calls: string[] = [];
    let update = () => undefined;
    const Interactive = createCompiledComponent({
      displayName: "MapReorderInteractive",
      initialize: () => [
        [
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        update = () =>
          state[0].set((previous) =>
            hintedReverse(
              hintedMap(previous as Item[], (item) =>
                item.id === "b" ? { ...item, rank: 0, label: "Beta newest" } : item,
              ),
            ),
          );
        return (
          <section>
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              events={[
                {
                  name: "onClick",
                  invoke: (item, index) => calls.push(`${(item as Item).label}:${index}`),
                },
              ]}
              id={0}
              items={items}
              reorderIndexIndependent
              structureDependencies={[0]}
              render={(rowEvent) => (
                <ul onClick={() => calls.push("bubble")}>
                  {items().map((item, index) => (
                    <li data-key={item.id} key={item.id}>
                      <span>
                        {item.label}:{item.rank}
                      </span>
                      <button onClick={rowEvent(item, index, 0)} type="button">
                        Select
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [{ name: "data-key", value: (item as Item).id }],
                styles: [],
                children: [
                  {
                    kind: "element",
                    tag: "span",
                    attributes: [],
                    styles: [],
                    children: [`${(item as Item).label}:${(item as Item).rank}`],
                  },
                  {
                    kind: "element",
                    tag: "button",
                    attributes: [{ name: "type", value: "button" }],
                    styles: [],
                    children: ["Select"],
                  },
                ],
              })}
              bindings={[
                {
                  kind: "text",
                  path: [0],
                  read: (item) => {
                    const row = item as Item;
                    return [`${row.label}:${row.rank}`];
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
    await act(async () => root.render(<Interactive />));

    await act(async () => {
      update();
      await flushCompilerUpdates();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-key="b"] button')!.click();
    });

    expect(labels(container)).toEqual(["Beta newest:0Select", "Alpha:1Select"]);
    expect(calls).toEqual(["Beta newest:0", "bubble"]);
  });

  stressIt(
    "matches React through 2,000 deterministic mapped reorder updates",
    async () => {
      const initialItems = Array.from(
        { length: 501 },
        (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}`, rank: index }),
      );
      const harness = createHarness(initialItems);
      let updateReact: (id: string, rank: number, label: string) => void = () => undefined;
      function Normal() {
        const [items, setItems] = useState(initialItems);
        updateReact = (id, rank, label) =>
          setItems((previous) =>
            previous
              .map((item) => (item.id === id ? { ...item, label } : item))
              .map((item) => (item.id === id ? { ...item, rank } : item))
              .toSorted((left, right) => left.rank - right.rank),
          );
        return (
          <ol>
            {items.map((item) => (
              <li data-key={item.id} key={item.id}>
                {item.label}:{item.rank}
              </li>
            ))}
          </ol>
        );
      }
      const compiledContainer = document.createElement("div");
      const reactContainer = document.createElement("div");
      document.body.append(compiledContainer, reactContainer);
      const compiledRoot = createRoot(compiledContainer);
      const reactRoot = createRoot(reactContainer);
      roots.push(compiledRoot, reactRoot);
      await act(async () => {
        compiledRoot.render(<harness.Table />);
        reactRoot.render(<Normal />);
      });

      let seed = 0x84f2d31b;
      for (let update = 0; update < 2_000; update += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        const index = seed % initialItems.length;
        const id = `row-${index}`;
        const rank = (seed ^ (seed >>> 16)) % 4_003;
        const label = `Updated ${update}`;
        await act(async () => {
          harness.editTwiceAndSort(id, rank, label);
          updateReact(id, rank, label);
          await flushCompilerUpdates();
        });
        expect(labels(compiledContainer)).toEqual(labels(reactContainer));
      }
      expect(harness.counters.executions).toBe(1);
    },
    120_000,
  );

  stressIt(
    "matches React through 2,000 deterministic mapped reversal parity updates",
    async () => {
      const initialItems = Array.from(
        { length: 31 },
        (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}`, rank: index }),
      );
      const harness = createHarness(initialItems);
      let updateReact: (
        id: string,
        rank: number,
        label: string,
        repetitions: number,
      ) => void = () => undefined;
      function Normal() {
        const [items, setItems] = useState(initialItems);
        updateReact = (id, rank, label, repetitions) =>
          setItems((previous) => {
            let next = previous
              .map((item) => (item.id === id ? { ...item, label } : item))
              .map((item) => (item.id === id ? { ...item, rank } : item));
            for (let count = 0; count < repetitions; count += 1) next = next.toReversed();
            return next;
          });
        return (
          <ol>
            {items.map((item) => (
              <li data-key={item.id} key={item.id}>
                {item.label}:{item.rank}
              </li>
            ))}
          </ol>
        );
      }
      const compiledContainer = document.createElement("div");
      const reactContainer = document.createElement("div");
      document.body.append(compiledContainer, reactContainer);
      const compiledRoot = createRoot(compiledContainer);
      const reactRoot = createRoot(reactContainer);
      roots.push(compiledRoot, reactRoot);
      await act(async () => {
        compiledRoot.render(<harness.Table />);
        reactRoot.render(<Normal />);
      });

      let seed = 0x1b873593;
      for (let update = 0; update < 2_000; update += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        const id = `row-${seed % initialItems.length}`;
        const rank = (seed ^ (seed >>> 16)) % 4_003;
        const label = `Reversed ${update}`;
        const repetitions = 1 + (seed % 4);
        await act(async () => {
          harness.editTwiceAndReverseMany(id, rank, label, repetitions);
          updateReact(id, rank, label, repetitions);
          await flushCompilerUpdates();
        });
        expect(labels(compiledContainer)).toEqual(labels(reactContainer));
      }
      expect(harness.counters.executions).toBe(1);
    },
    120_000,
  );

  it("hydrates in StrictMode and drops a queued update after unmount", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 2 },
      { id: "c", label: "Gamma", rank: 3 },
    ];
    const hydration = createHarness(initialItems);
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
    await act(async () => {
      hydration.editTwiceAndReverseMany("a", 5, "Alpha hydrated", 2);
      await flushCompilerUpdates();
    });
    expect(labels(container)).toEqual(["Alpha hydrated:5", "Beta:2", "Gamma:3"]);
    expect(recoverable).toEqual([]);

    const unmounted = createHarness(initialItems);
    const unmountContainer = document.createElement("div");
    document.body.append(unmountContainer);
    const unmountRoot = createRoot(unmountContainer);
    await act(async () => unmountRoot.render(<unmounted.Table />));
    act(() => {
      unmounted.editTwiceAndReverseMany("b", 8, "Never committed", 3);
      unmountRoot.unmount();
    });
    await flushCompilerUpdates();
    expect(unmountContainer.innerHTML).toBe("");
  });
});
