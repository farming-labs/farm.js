import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  createCompilerKeyedArrayFilter,
  createCompilerKeyedArrayMapPipeline,
  createCompilerKeyedArraySlice,
  createCompilerKeyedArrayStructuralReorder,
  createCompilerKeyedArrayStructuralSort,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
  rank: number;
  visible: boolean;
}

const roots: Root[] = [];

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

function hintedFilter(items: Item[], predicate: (item: Item) => boolean): Item[] {
  return createCompilerKeyedArrayFilter(items, items.filter, predicate) as Item[];
}

function hintedMap(items: Item[], mapper: (item: Item) => Item): Item[] {
  return createCompilerKeyedArrayMapPipeline(items, items.map, mapper) as Item[];
}

function hintedSlice(items: Item[], start: number, end?: number): Item[] {
  return createCompilerKeyedArraySlice(
    items,
    items.slice,
    ...([start, end].filter((value) => value !== undefined) as number[]),
  ) as Item[];
}

function hintedSort(items: Item[], compare: (left: Item, right: Item) => number): Item[] {
  return createCompilerKeyedArrayStructuralSort(items, items.toSorted, compare) as Item[];
}

function hintedReverse(items: Item[]): Item[] {
  return createCompilerKeyedArrayStructuralReorder(items, items.toReversed) as Item[];
}

function rowDescriptor(item: Item): CompilerKeyedRowElement {
  return {
    kind: "element",
    tag: "li",
    attributes: [{ name: "data-key", value: item.id }],
    styles: [],
    children: [item.label],
  };
}

function createHarness(initialItems: Item[]) {
  const counters = {
    bindings: 0,
    descriptors: 0,
    executions: 0,
    keys: 0,
    renders: 0,
  };
  let filterSortReverse: (removed: ReadonlySet<string>) => void = () => undefined;
  let filterThenQueuedSort: (removed: ReadonlySet<string>) => void = () => undefined;
  let filterSliceReverse: (removed: ReadonlySet<string>, limit: number) => void = () => undefined;
  let mapFilterSortReverse: (
    editedId: string,
    nextLabel: string,
    nextRank: number,
    removed: ReadonlySet<string>,
  ) => void = () => undefined;
  let mapFilterDoubleReverse: (
    editedId: string,
    nextLabel: string,
    removed: ReadonlySet<string>,
  ) => void = () => undefined;
  let invalidIdentity: () => void = () => undefined;
  let invalidMappedIdentity: () => void = () => undefined;
  let customMapStructural: () => void = () => undefined;
  let customSortAfterFilter: (removed: ReadonlySet<string>) => void = () => undefined;
  const Table = createCompiledComponent({
    displayName: "StructuralReorderTable",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      filterSortReverse = (removed) =>
        state[0].set((previous) =>
          hintedReverse(
            hintedSort(
              hintedFilter(previous as Item[], (item) => !removed.has(item.id)),
              (left, right) => left.rank - right.rank,
            ),
          ),
        );
      filterThenQueuedSort = (removed) => {
        state[0].set((previous) =>
          hintedFilter(previous as Item[], (item) => !removed.has(item.id)),
        );
        state[0].set((previous) =>
          hintedSort(previous as Item[], (left, right) => right.rank - left.rank),
        );
      };
      filterSliceReverse = (removed, limit) =>
        state[0].set((previous) =>
          hintedReverse(
            hintedSlice(
              hintedFilter(previous as Item[], (item) => !removed.has(item.id)),
              0,
              limit,
            ),
          ),
        );
      mapFilterSortReverse = (editedId, nextLabel, nextRank, removed) =>
        state[0].set((previous) =>
          hintedReverse(
            hintedSort(
              hintedFilter(
                hintedMap(previous as Item[], (item) =>
                  item.id === editedId ? { ...item, label: nextLabel, rank: nextRank } : item,
                ),
                (item) => !removed.has(item.id),
              ),
              (left, right) => left.rank - right.rank,
            ),
          ),
        );
      mapFilterDoubleReverse = (editedId, nextLabel, removed) =>
        state[0].set((previous) =>
          hintedReverse(
            hintedReverse(
              hintedFilter(
                hintedMap(previous as Item[], (item) =>
                  item.id === editedId ? { ...item, label: nextLabel } : item,
                ),
                (item) => !removed.has(item.id),
              ),
            ),
          ),
        );
      invalidIdentity = () =>
        state[0].set((previous) => {
          const next = hintedReverse(hintedFilter(previous as Item[], (item) => item.id !== "b"));
          next[0] = { ...next[0], id: "replacement", label: "Replacement" };
          return next;
        });
      invalidMappedIdentity = () =>
        state[0].set((previous) =>
          hintedReverse(
            hintedFilter(
              hintedMap(previous as Item[], (item) =>
                item.id === "b" ? { ...item, id: "replacement", label: "Replacement" } : item,
              ),
              (item) => item.id !== "c",
            ),
          ),
        );
      customMapStructural = () =>
        state[0].set((previous) => {
          const source = previous as Item[];
          const customMap = function (
            this: Item[],
            callback: (item: Item, index: number, items: Item[]) => Item,
          ) {
            return Array.prototype.map.call(this, callback);
          };
          const mapped = createCompilerKeyedArrayMapPipeline(source, customMap, (item: Item) =>
            item.id === "a" ? { ...item, label: "Custom map" } : item,
          ) as Item[];
          return hintedSort(
            hintedFilter(mapped, (item) => item.id !== "c"),
            (left, right) => left.rank - right.rank,
          );
        });
      customSortAfterFilter = (removed) =>
        state[0].set((previous) => {
          const filtered = hintedFilter(previous as Item[], (item) => !removed.has(item.id));
          const custom = function (this: Item[], compare: (left: Item, right: Item) => number) {
            return [...this].sort(compare);
          };
          return createCompilerKeyedArrayStructuralSort(
            filtered,
            custom,
            (left: Item, right: Item) => left.rank - right.rank,
          );
        });
      return (
        <section>
          <blocks.KeyedRows
            collectionDependency={0}
            dependencies={[0]}
            filterIndexIndependent
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
              return rowDescriptor(item as Item);
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
    Table,
    counters,
    customSortAfterFilter: (removed: ReadonlySet<string>) => customSortAfterFilter(removed),
    customMapStructural: () => customMapStructural(),
    filterSliceReverse: (removed: ReadonlySet<string>, limit: number) =>
      filterSliceReverse(removed, limit),
    filterSortReverse: (removed: ReadonlySet<string>) => filterSortReverse(removed),
    filterThenQueuedSort: (removed: ReadonlySet<string>) => filterThenQueuedSort(removed),
    invalidIdentity: () => invalidIdentity(),
    invalidMappedIdentity: () => invalidMappedIdentity(),
    mapFilterDoubleReverse: (editedId: string, nextLabel: string, removed: ReadonlySet<string>) =>
      mapFilterDoubleReverse(editedId, nextLabel, removed),
    mapFilterSortReverse: (
      editedId: string,
      nextLabel: string,
      nextRank: number,
      removed: ReadonlySet<string>,
    ) => mapFilterSortReverse(editedId, nextLabel, nextRank, removed),
  };
}

function labels(container: Element): string[] {
  return [...container.querySelectorAll("li")].map((row) => row.textContent || "");
}

describe("compiled keyed-array structural reorder hints", () => {
  it("removes and reorders in one validated DOM transaction", async () => {
    const items: Item[] = [
      { id: "a", label: "Alpha", rank: 4, visible: true },
      { id: "b", label: "Beta", rank: 1, visible: false },
      { id: "c", label: "Gamma", rank: 3, visible: true },
      { id: "d", label: "Delta", rank: 2, visible: true },
    ];
    const harness = createHarness(items);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const alpha = container.querySelector('[data-key="a"]');
    const gamma = container.querySelector('[data-key="c"]');
    const delta = container.querySelector('[data-key="d"]');
    const insertBefore = vi.spyOn(container.querySelector("ul")!, "insertBefore");
    harness.counters.bindings = 0;
    harness.counters.descriptors = 0;
    harness.counters.keys = 0;

    await act(async () => {
      harness.filterSortReverse(new Set(["b"]));
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Alpha", "Gamma", "Delta"]);
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(container.querySelector('[data-key="d"]')).toBe(delta);
    expect(container.querySelector('[data-key="b"]')).toBeNull();
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(3);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(0);
    expect(insertBefore).not.toHaveBeenCalled();
  });

  it("composes a queued filter with a following native sort", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 2, visible: true },
      { id: "b", label: "Beta", rank: 4, visible: true },
      { id: "c", label: "Gamma", rank: 1, visible: true },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));

    await act(async () => {
      harness.filterThenQueuedSort(new Set(["a"]));
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Beta", "Gamma"]);
    expect(harness.counters.executions).toBe(1);
  });

  it("composes filter, slice, and reverse metadata", async () => {
    const harness = createHarness([
      { id: "a", label: "Alpha", rank: 1, visible: true },
      { id: "b", label: "Beta", rank: 2, visible: true },
      { id: "c", label: "Gamma", rank: 3, visible: true },
      { id: "d", label: "Delta", rank: 4, visible: true },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));

    await act(async () => {
      harness.filterSliceReverse(new Set(["b"]), 2);
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Gamma", "Alpha"]);
    expect(harness.counters.executions).toBe(1);
  });

  it("patches mapped survivors while removing a row and preserving exact order", async () => {
    const items: Item[] = [
      { id: "a", label: "Alpha", rank: 4, visible: true },
      { id: "b", label: "Beta", rank: 1, visible: false },
      { id: "c", label: "Gamma", rank: 3, visible: true },
      { id: "d", label: "Delta", rank: 2, visible: true },
    ];
    const harness = createHarness(items);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const alpha = container.querySelector('[data-key="a"]');
    const gamma = container.querySelector('[data-key="c"]');
    const delta = container.querySelector('[data-key="d"]');
    const insertBefore = vi.spyOn(container.querySelector("ul")!, "insertBefore");
    harness.counters.bindings = 0;
    harness.counters.descriptors = 0;
    harness.counters.keys = 0;

    await act(async () => {
      harness.mapFilterDoubleReverse("c", "Gamma updated", new Set(["b"]));
      await flushCompilerUpdates();
    });

    expect(labels(container)).toEqual(["Alpha", "Gamma updated", "Delta"]);
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(container.querySelector('[data-key="d"]')).toBe(delta);
    expect(container.querySelector('[data-key="b"]')).toBeNull();
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(3);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(1);
    expect(insertBefore).not.toHaveBeenCalled();
  });

  it("falls back safely for custom methods and identity mismatches", async () => {
    const items: Item[] = [
      { id: "a", label: "Alpha", rank: 2, visible: true },
      { id: "b", label: "Beta", rank: 1, visible: true },
      { id: "c", label: "Gamma", rank: 3, visible: true },
    ];
    const harness = createHarness(items);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    await act(async () => {
      harness.customSortAfterFilter(new Set(["c"]));
      await flushCompilerUpdates();
    });
    expect(labels(container)).toEqual(["Beta", "Alpha"]);
    expect(harness.counters.bindings).toBeGreaterThan(0);

    await act(async () => {
      harness.invalidIdentity();
      await flushCompilerUpdates();
    });
    expect(labels(container)).toEqual(["Replacement"]);
    expect(harness.counters.bindings).toBeGreaterThan(0);
  });

  it("falls back atomically for a custom map or changed mapped key", async () => {
    const items: Item[] = [
      { id: "a", label: "Alpha", rank: 2, visible: true },
      { id: "b", label: "Beta", rank: 1, visible: true },
      { id: "c", label: "Gamma", rank: 3, visible: true },
    ];
    const custom = createHarness(items);
    const customContainer = document.createElement("div");
    document.body.append(customContainer);
    const customRoot = createRoot(customContainer);
    roots.push(customRoot);
    await act(async () => customRoot.render(<custom.Table />));
    custom.counters.bindings = 0;
    custom.counters.descriptors = 0;
    await act(async () => {
      custom.customMapStructural();
      await flushCompilerUpdates();
    });
    expect(labels(customContainer)).toEqual(["Beta", "Custom map"]);
    expect(custom.counters.bindings).toBeGreaterThan(0);

    const changedKey = createHarness(items);
    const changedKeyContainer = document.createElement("div");
    document.body.append(changedKeyContainer);
    const changedKeyRoot = createRoot(changedKeyContainer);
    roots.push(changedKeyRoot);
    await act(async () => changedKeyRoot.render(<changedKey.Table />));
    changedKey.counters.bindings = 0;
    changedKey.counters.descriptors = 0;
    await act(async () => {
      changedKey.invalidMappedIdentity();
      await flushCompilerUpdates();
    });
    expect(labels(changedKeyContainer)).toEqual(["Replacement", "Alpha"]);
    expect(changedKey.counters.bindings).toBeGreaterThan(0);
    expect(changedKey.counters.descriptors).toBeGreaterThan(0);
  });

  it("preserves a surviving controlled input, focus, and selection", async () => {
    const items: Item[] = [
      { id: "a", label: "Alpha", rank: 3, visible: true },
      { id: "b", label: "Beta", rank: 1, visible: true },
      { id: "c", label: "Gamma", rank: 2, visible: true },
    ];
    let update = () => undefined;
    const FormRows = createCompiledComponent({
      displayName: "StructuralReorderFormRows",
      initialize: () => [items],
      render(_props: Record<string, never>, state, blocks) {
        const rows = () => state[0].get() as Item[];
        update = () =>
          state[0].set((previous) =>
            hintedReverse(
              hintedFilter(
                hintedMap(previous as Item[], (item) =>
                  item.id === "b" ? { ...item, label: "Beta newest" } : item,
                ),
                (item) => item.id !== "a",
              ),
            ),
          );
        return (
          <section>
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              filterIndexIndependent
              id={0}
              items={rows}
              reorderIndexIndependent
              structureDependencies={[0]}
              render={() => (
                <div>
                  {rows().map((item) => (
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
    await act(async () => root.render(<FormRows />));
    const input = container.querySelector('[data-key="b"]') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(1, 3);

    await act(async () => {
      update();
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="b"]')).toBe(input);
    expect(input.value).toBe("Beta newest");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  });

  it("matches React across 2,000 randomized removals plus reorderings", async () => {
    const initialItems = Array.from(
      { length: 2_001 },
      (_, index): Item => ({
        id: `row-${index}`,
        label: `Row ${index}`,
        rank: (index * 1_229) % 2_003,
        visible: true,
      }),
    );
    const harness = createHarness(initialItems);
    let updateReact: (removed: ReadonlySet<string>) => void = () => undefined;
    function Normal() {
      const [items, setItems] = useState(initialItems);
      updateReact = (removed) =>
        setItems((previous) =>
          previous
            .filter((item) => !removed.has(item.id))
            .toSorted((left, right) => left.rank - right.rank)
            .toReversed(),
        );
      return (
        <ol>
          {items.map((item) => (
            <li data-key={item.id} key={item.id}>
              {item.label}
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

    let seed = 0x7f4a7c15;
    const active = initialItems.map((item) => item.id);
    for (let batch = 0; batch < 100; batch += 1) {
      const removed = new Set<string>();
      for (let update = 0; update < 20; update += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        const index = seed % active.length;
        const [id] = active.splice(index, 1);
        removed.add(id);
      }
      await act(async () => {
        harness.filterSortReverse(removed);
        updateReact(removed);
        await flushCompilerUpdates();
      });
      expect(labels(compiledContainer)).toEqual(labels(reactContainer));
    }
    expect(harness.counters.executions).toBe(1);
  }, 20_000);

  it("matches React across 2,000 mapped structural removals", async () => {
    const initialItems = Array.from(
      { length: 2_001 },
      (_, index): Item => ({
        id: `row-${index}`,
        label: `Row ${index}`,
        rank: (index * 1_229) % 2_003,
        visible: true,
      }),
    );
    const harness = createHarness(initialItems);
    let updateReact: (
      editedId: string,
      nextLabel: string,
      nextRank: number,
      removed: ReadonlySet<string>,
    ) => void = () => undefined;
    function Normal() {
      const [items, setItems] = useState(initialItems);
      updateReact = (editedId, nextLabel, nextRank, removed) =>
        setItems((previous) =>
          previous
            .map((item) =>
              item.id === editedId ? { ...item, label: nextLabel, rank: nextRank } : item,
            )
            .filter((item) => !removed.has(item.id))
            .toSorted((left, right) => left.rank - right.rank)
            .toReversed(),
        );
      return (
        <ol>
          {items.map((item) => (
            <li data-key={item.id} key={item.id}>
              {item.label}
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

    let seed = 0xa341316c;
    const active = initialItems.map((item) => item.id);
    for (let batch = 0; batch < 100; batch += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const editedId = active[seed % active.length];
      const nextLabel = `Updated ${batch}`;
      const nextRank = seed % 2_003;
      const removed = new Set<string>();
      for (let update = 0; update < 20; update += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        const index = seed % active.length;
        const [id] = active.splice(index, 1);
        removed.add(id);
      }
      await act(async () => {
        harness.mapFilterSortReverse(editedId, nextLabel, nextRank, removed);
        updateReact(editedId, nextLabel, nextRank, removed);
        await flushCompilerUpdates();
      });
      expect(labels(compiledContainer)).toEqual(labels(reactContainer));
    }
    expect(harness.counters.executions).toBe(1);
  }, 20_000);

  it("hydrates in StrictMode and drops a queued pipeline after unmount", async () => {
    const items: Item[] = [
      { id: "a", label: "Alpha", rank: 3, visible: true },
      { id: "b", label: "Beta", rank: 1, visible: true },
      { id: "c", label: "Gamma", rank: 2, visible: true },
    ];
    const hydration = createHarness(items);
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
      hydration.mapFilterSortReverse("c", "Gamma hydrated", 2, new Set(["b"]));
      await flushCompilerUpdates();
    });
    expect(labels(container)).toEqual(["Alpha", "Gamma hydrated"]);
    expect(recoverable).toEqual([]);

    const unmounted = createHarness(items);
    const unmountContainer = document.createElement("div");
    document.body.append(unmountContainer);
    const unmountRoot = createRoot(unmountContainer);
    await act(async () => unmountRoot.render(<unmounted.Table />));
    act(() => {
      unmounted.mapFilterSortReverse("c", "Gamma queued", 2, new Set(["a"]));
      unmountRoot.unmount();
    });
    await flushCompilerUpdates();
    expect(unmountContainer.innerHTML).toBe("");
  });
});
