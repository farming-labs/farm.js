import React, { StrictMode, useState } from "react";
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  createCompilerKeyedArrayMapReorder,
  createCompilerKeyedArrayQueuedMapPipeline,
  createCompilerKeyedArrayReorder,
  createCompilerKeyedArraySort,
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

type SortableArray = Item[] & {
  toSorted(compare?: (left: Item, right: Item) => number): Item[];
};

type ReorderPipelineOperation =
  | { readonly kind: "reverse" }
  | {
      readonly compare: (left: Item, right: Item) => number;
      readonly kind: "sort";
    };

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

function hintedSort(previous: Item[], compare?: (left: Item, right: Item) => number): Item[] {
  const source = previous as SortableArray;
  return createCompilerKeyedArraySort(source, source.toSorted, compare) as Item[];
}

function hintedReverse(previous: Item[]): Item[] {
  return createCompilerKeyedArrayReorder(previous, previous.toReversed) as Item[];
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

function createSortHarness(
  initialItems: Item[],
  readsCollection = false,
  reactivity?: "static" | "hybrid",
  delegateEvents = false,
) {
  const calls: string[] = [];
  const counters = {
    executions: 0,
    renders: 0,
    keys: 0,
    descriptors: 0,
    bindings: 0,
  };
  let sort: (compare: (left: Item, right: Item) => number) => void = () => undefined;
  let editAndSort: (compare: (left: Item, right: Item) => number) => void = () => undefined;
  let queueSorts: (compares: Array<(left: Item, right: Item) => number>) => void = () => undefined;
  let queueTwo: () => void = () => undefined;
  let plainThenSort: () => void = () => undefined;
  let reverseThenSort: () => void = () => undefined;
  let sortThenReverse: () => void = () => undefined;
  let reverseThenSortPipeline: () => void = () => undefined;
  let sortThenReversePipeline: () => void = () => undefined;
  let reorderPipeline: (operations: readonly ReorderPipelineOperation[]) => void = () => undefined;
  let customSort: () => void = () => undefined;
  let customSortThenReversePipeline: () => void = () => undefined;
  let mismatchedSort: () => void = () => undefined;
  const Table = createCompiledComponent({
    displayName: "SortTable",
    reactivity,
    initialize: () => [initialItems],
    render(props: { onRowClick?: (item: Item, index: number) => void }, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      sort = (compare) => state[0].set((previous) => hintedSort(previous as Item[], compare));
      editAndSort = (compare) => {
        state[0].set((previous) => {
          const source = previous as Item[];
          return createCompilerKeyedArrayQueuedMapPipeline(source, (current, applyMap) =>
            applyMap(current, source.map, (item: Item) =>
              item.id === "row-0" ? { ...item, label: `${item.label}!` } : item,
            ),
          );
        });
        state[0].set((previous) => {
          const source = previous as SortableArray;
          return createCompilerKeyedArrayMapReorder(source, source.toSorted, compare);
        });
      };
      queueSorts = (compares) => {
        for (const compare of compares) {
          state[0].set((previous) => hintedSort(previous as Item[], compare));
        }
      };
      queueTwo = () => {
        state[0].set((previous) =>
          hintedSort(previous as Item[], (left, right) => left.rank - right.rank),
        );
        state[0].set((previous) =>
          hintedSort(previous as Item[], (left, right) => right.rank - left.rank),
        );
      };
      plainThenSort = () => {
        state[0].set((previous) => [...(previous as Item[])]);
        state[0].set((previous) =>
          hintedSort(previous as Item[], (left, right) => left.rank - right.rank),
        );
      };
      reverseThenSort = () => {
        state[0].set((previous) => hintedReverse(previous as Item[]));
        state[0].set((previous) =>
          hintedSort(previous as Item[], (left, right) => left.rank - right.rank),
        );
      };
      sortThenReverse = () => {
        state[0].set((previous) =>
          hintedSort(previous as Item[], (left, right) => left.rank - right.rank),
        );
        state[0].set((previous) => hintedReverse(previous as Item[]));
      };
      reverseThenSortPipeline = () =>
        state[0].set((previous) =>
          hintedSort(hintedReverse(previous as Item[]), (left, right) => left.rank - right.rank),
        );
      sortThenReversePipeline = () =>
        state[0].set((previous) =>
          hintedReverse(hintedSort(previous as Item[], (left, right) => left.rank - right.rank)),
        );
      reorderPipeline = (operations) =>
        state[0].set((previous) => {
          let next = previous as Item[];
          for (const operation of operations) {
            next =
              operation.kind === "reverse"
                ? hintedReverse(next)
                : hintedSort(next, operation.compare);
          }
          return next;
        });
      customSort = () =>
        state[0].set((previous) => {
          const source = previous as Item[];
          const method = function (this: Item[], compare: (left: Item, right: Item) => number) {
            return [...this].sort(compare);
          };
          return createCompilerKeyedArraySort(
            source,
            method,
            (left: Item, right: Item) => left.rank - right.rank,
          );
        });
      customSortThenReversePipeline = () =>
        state[0].set((previous) => {
          const source = previous as Item[];
          const custom = function (this: Item[], compare: (left: Item, right: Item) => number) {
            return [...this].sort(compare);
          };
          const sorted = createCompilerKeyedArraySort(
            source,
            custom,
            (left: Item, right: Item) => left.rank - right.rank,
          ) as Item[];
          return hintedReverse(sorted);
        });
      mismatchedSort = () =>
        state[0].set((previous) => {
          const sorted = hintedSort(previous as Item[], (left, right) => left.rank - right.rank);
          sorted[0] = { ...sorted[0], id: `${sorted[0].id}-replacement` };
          return sorted;
        });
      const text = (item: Item) =>
        readsCollection ? `${items().length}: ${item.label}` : item.label;
      return (
        <section>
          <blocks.KeyedRows
            collectionDependency={0}
            delegateEvents={delegateEvents}
            dependencies={[0]}
            events={
              delegateEvents
                ? [
                    {
                      name: "onClick",
                      path: [],
                      invoke: (item, index) => {
                        const row = item as Item;
                        calls.push(`${row.id}:${row.label}:${index}`);
                        props.onRowClick?.(row, index);
                      },
                    },
                  ]
                : undefined
            }
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
                      {text(item)}
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
                dependencies: readsCollection ? [0] : [],
                read: (item) => {
                  counters.bindings += 1;
                  return [text(item as Item)];
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
    calls,
    counters,
    captureSort: () => sort,
    editAndSort: (compare: (left: Item, right: Item) => number) => editAndSort(compare),
    customSort: () => customSort(),
    customSortThenReversePipeline: () => customSortThenReversePipeline(),
    mismatchedSort: () => mismatchedSort(),
    plainThenSort: () => plainThenSort(),
    queueSorts: (compares: Array<(left: Item, right: Item) => number>) => queueSorts(compares),
    queueTwo: () => queueTwo(),
    reorderPipeline: (operations: readonly ReorderPipelineOperation[]) =>
      reorderPipeline(operations),
    reverseThenSortPipeline: () => reverseThenSortPipeline(),
    reverseThenSort: () => reverseThenSort(),
    sort: (compare: (left: Item, right: Item) => number) => sort(compare),
    sortThenReversePipeline: () => sortThenReversePipeline(),
    sortThenReverse: () => sortThenReverse(),
  };
}

function itemLabels(container: Element): string[] {
  return [...container.querySelectorAll("li")].map((node) => node.textContent || "");
}

function lisLength(sequence: readonly number[]): number {
  const tails: number[] = [];
  for (const value of sequence) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < value) low = middle + 1;
      else high = middle;
    }
    tails[low] = value;
  }
  return tails.length;
}

function trackRowIndexWrites() {
  const writes = { count: 0 };
  const originalSet = WeakMap.prototype.set;
  vi.spyOn(WeakMap.prototype, "set").mockImplementation(function (
    this: WeakMap<object, unknown>,
    key: object,
    value: unknown,
  ) {
    if (
      value !== null &&
      typeof value === "object" &&
      "element" in value &&
      value.element === key
    ) {
      writes.count += 1;
    }
    return originalSet.call(this, key, value);
  });
  return writes;
}

describe("compiled keyed-array sort hints", () => {
  for (const reactivity of ["static", "hybrid"] as const) {
    it.each(["batched", "parent-first", "local-first"] as const)(
      `keeps delegated callbacks current across %s parent updates in ${reactivity}`,
      async (ordering) => {
        const initialItems = Array.from(
          { length: 16 },
          (_, index): Item => ({
            id: `row-${index}`,
            label: `Row ${index}`,
            rank: (index * 5) % 16,
          }),
        );
        const harness = createSortHarness(initialItems, false, reactivity, true);
        const compiledCalls: string[] = [];
        const normalCalls: string[] = [];
        let setVersion: React.Dispatch<React.SetStateAction<number>> = () => undefined;
        let updateNormal: (compare: (left: Item, right: Item) => number) => void = () => undefined;
        function NormalTable({ version }: { version: number }) {
          const [items, setItems] = useState(initialItems);
          updateNormal = (compare) => {
            setItems((previous) =>
              previous.map((item) =>
                item.id === "row-0" ? { ...item, label: `${item.label}!` } : item,
              ),
            );
            setItems((previous) => previous.toSorted(compare));
          };
          return (
            <ul>
              {items.map((item, index) => (
                <li
                  data-key={item.id}
                  key={item.id}
                  onClick={() => normalCalls.push(`${version}:${item.id}:${item.label}:${index}`)}
                >
                  {item.label}
                </li>
              ))}
            </ul>
          );
        }
        function Parent() {
          const [version, updateVersion] = useState(0);
          setVersion = updateVersion;
          return (
            <>
              <div data-compiled>
                <harness.Table
                  onRowClick={(item, index) =>
                    compiledCalls.push(`${version}:${item.id}:${item.label}:${index}`)
                  }
                />
              </div>
              <div data-control>
                <NormalTable version={version} />
              </div>
            </>
          );
        }
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        roots.push(root);
        await act(async () =>
          root.render(
            <StrictMode>
              <Parent />
            </StrictMode>,
          ),
        );
        const compiledContainer = container.querySelector("[data-compiled]")!;
        const normalContainer = container.querySelector("[data-control]")!;
        const rows = new Map(
          [...compiledContainer.querySelectorAll("li")].map((row) => [
            row.getAttribute("data-key"),
            row,
          ]),
        );
        const moves = vi.spyOn(compiledContainer.querySelector("ul")!, "insertBefore");
        const writes = trackRowIndexWrites();
        const renders = harness.counters.renders;
        let expectedItems = initialItems;
        for (const version of [1, 2]) {
          const compare =
            version === 1
              ? (left: Item, right: Item) => right.rank - left.rank
              : (left: Item, right: Item) => left.rank - right.rank;
          // The second commit has no parent update and must retain the fast path.
          for (const parentUpdate of [true, false]) {
            const previousIndices = new Map(expectedItems.map((item, index) => [item.id, index]));
            const localCompare = parentUpdate
              ? compare
              : (left: Item, right: Item) => -compare(left, right);
            expectedItems = expectedItems
              .map((item) => (item.id === "row-0" ? { ...item, label: `${item.label}!` } : item))
              .toSorted(localCompare);
            const before = { ...harness.counters };
            moves.mockClear();
            writes.count = 0;
            const updateRows = () => {
              harness.editAndSort(localCompare);
              updateNormal(localCompare);
            };
            await act(async () => {
              if (!parentUpdate) updateRows();
              else if (ordering === "parent-first") {
                flushSync(() => setVersion(version));
                updateRows();
              } else if (ordering === "local-first") {
                updateRows();
                flushSync(() => setVersion(version));
              } else {
                setVersion(version);
                updateRows();
              }
              await flushCompilerUpdates();
            });
            expect(itemLabels(compiledContainer)).toEqual(expectedItems.map((item) => item.label));
            expect(itemLabels(compiledContainer)).toEqual(itemLabels(normalContainer));
            const currentRows = [...compiledContainer.querySelectorAll("li")];
            currentRows.forEach((row, index) =>
              expect(row).toBe(rows.get(expectedItems[index].id)),
            );
            expect(moves).toHaveBeenCalledTimes(
              expectedItems.length -
                lisLength(expectedItems.map((item) => previousIndices.get(item.id)!)),
            );
            expect(harness.counters.renders).toBe(renders);
            expect(harness.counters.descriptors).toBe(before.descriptors);
            if (parentUpdate) {
              expect(harness.counters.executions).toBeGreaterThan(before.executions);
            } else {
              expect(harness.counters).toEqual({
                ...before,
                keys: before.keys + 1,
                bindings: before.bindings + 1,
              });
              expect(writes.count).toBe(0);
            }
            compiledCalls.length = 0;
            normalCalls.length = 0;
            await act(async () => {
              currentRows.forEach((row) => row.click());
              normalContainer.querySelectorAll("li").forEach((row) => row.click());
            });
            expect(compiledCalls).toEqual(
              expectedItems.map((item, index) => `${version}:${item.id}:${item.label}:${index}`),
            );
            expect(compiledCalls).toEqual(normalCalls);
          }
        }
      },
    );

    it.each(["hydration", "remount"] as const)(
      `preserves retained delegated lookups through StrictMode %s in ${reactivity}`,
      async (lifecycle) => {
        const initialItems = Array.from(
          { length: 16 },
          (_, index): Item => ({
            id: `row-${index}`,
            label: `Row ${index}`,
            rank: (index * 5) % 16,
          }),
        );
        const harness = createSortHarness(initialItems, false, reactivity, true);
        const container = document.createElement("div");
        document.body.append(container);
        const initialTree = (
          <StrictMode>
            <harness.Table key="initial" />
          </StrictMode>
        );
        const recoverableError = vi.fn();
        let initialRows: Element[] = [];
        if (lifecycle === "hydration") {
          container.innerHTML = renderToString(initialTree);
          initialRows = [...container.querySelectorAll("li")];
        }
        let root!: Root;
        await act(async () => {
          root =
            lifecycle === "hydration"
              ? hydrateRoot(container, initialTree, { onRecoverableError: recoverableError })
              : createRoot(container);
          roots.push(root);
          if (lifecycle === "remount") root.render(initialTree);
          await flushCompilerUpdates();
        });
        expect(recoverableError).not.toHaveBeenCalled();
        if (lifecycle === "hydration") {
          [...container.querySelectorAll("li")].forEach((row, index) => {
            expect(row).toBe(initialRows[index]);
          });
        } else {
          initialRows = [...container.querySelectorAll("li")];
          const previousList = container.querySelector("ul")!;
          const oldMoves = vi.spyOn(previousList, "insertBefore");
          const staleSort = harness.captureSort();
          await act(async () => {
            // Replace the owner synchronously before its queued compiler flush.
            harness.editAndSort((left, right) => right.rank - left.rank);
            flushSync(() =>
              root.render(
                <StrictMode>
                  <harness.Table key="replacement" />
                </StrictMode>,
              ),
            );
            await flushCompilerUpdates();
          });
          expect(itemLabels(container)).toEqual(initialItems.map((item) => item.label));
          [...container.querySelectorAll("li")].forEach((row, index) => {
            expect(row).not.toBe(initialRows[index]);
            expect(initialRows[index].isConnected).toBe(false);
          });
          const afterRemount = { ...harness.counters };
          await act(async () => {
            staleSort((left, right) => right.rank - left.rank);
            for (const row of initialRows) (row as HTMLElement).click();
            await flushCompilerUpdates();
          });
          expect(oldMoves).not.toHaveBeenCalled();
          expect(harness.counters).toEqual(afterRemount);
          expect(harness.calls).toEqual([]);
          expect(itemLabels(container)).toEqual(initialItems.map((item) => item.label));
        }

        const rows = new Map(
          [...container.querySelectorAll("li")].map((row) => [row.getAttribute("data-key"), row]),
        );
        const moves = vi.spyOn(container.querySelector("ul")!, "insertBefore");
        const writes = trackRowIndexWrites();
        const executions = harness.counters.executions;
        const renders = harness.counters.renders;
        let expectedItems = initialItems;
        for (const action of ["sort", "editAndSort", "sort"] as const) {
          const compare =
            action === "editAndSort"
              ? (left: Item, right: Item) => left.rank - right.rank
              : (left: Item, right: Item) => right.rank - left.rank;
          const previousIndices = new Map(expectedItems.map((item, index) => [item.id, index]));
          if (action === "editAndSort") {
            expectedItems = expectedItems.map((item) =>
              item.id === "row-0" ? { ...item, label: `${item.label}!` } : item,
            );
          }
          expectedItems = expectedItems.toSorted(compare);
          const expectedMoves =
            expectedItems.length -
            lisLength(expectedItems.map((item) => previousIndices.get(item.id)!));
          moves.mockClear();
          writes.count = 0;
          harness.counters.keys = 0;
          harness.counters.bindings = 0;
          harness.counters.descriptors = 0;
          harness.calls.length = 0;
          await act(async () => {
            harness[action](compare);
            await flushCompilerUpdates();
          });
          expect(itemLabels(container)).toEqual(expectedItems.map((item) => item.label));
          const currentRows = [...container.querySelectorAll("li")];
          currentRows.forEach((row, index) => expect(row).toBe(rows.get(expectedItems[index].id)));
          expect(moves).toHaveBeenCalledTimes(expectedMoves);
          expect(writes.count).toBe(0);
          expect(harness.counters).toEqual({
            executions,
            renders,
            keys: action === "editAndSort" ? 1 : 0,
            bindings: action === "editAndSort" ? 1 : 0,
            descriptors: 0,
          });
          await act(async () => currentRows.forEach((row) => row.click()));
          expect(harness.calls).toEqual(
            expectedItems.map((item, index) => `${item.id}:${item.label}:${index}`),
          );
          expect(recoverableError).not.toHaveBeenCalled();
        }
      },
    );

    it.each(["sort", "queueSorts", "reorderPipeline", "editAndSort"] as const)(
      `retains owned row maps and delegated lookups after %s in ${reactivity}`,
      async (action) => {
        const initialItems = Array.from(
          { length: 128 },
          (_, index): Item => ({
            id: `row-${index}`,
            label: `Row ${index}`,
            rank: (index * 37) % 128,
          }),
        );
        const harness = createSortHarness(initialItems, false, reactivity, true);
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        roots.push(root);
        await act(async () => root.render(<harness.Table />));
        const rows = new Map(
          [...container.querySelectorAll("li")].map((row) => [row.getAttribute("data-key"), row]),
        );
        const insertBefore = vi.spyOn(container.querySelector("ul")!, "insertBefore");
        const indexWrites = trackRowIndexWrites();
        let rowMapCopies = 0;
        const originalIterator = Map.prototype[Symbol.iterator];
        vi.spyOn(Map.prototype, Symbol.iterator).mockImplementation(
          function (this: Map<string, { element?: Element }>) {
            if (
              this.size === initialItems.length &&
              this.get("row-0")?.element === rows.get("row-0")
            ) {
              rowMapCopies += 1;
            }
            return originalIterator.call(this);
          },
        );

        const compares = [
          (left: Item, right: Item) => left.rank - right.rank,
          // Sorting an already sorted collection must not move or reindex rows.
          (left: Item, right: Item) => left.rank - right.rank,
          (left: Item, right: Item) => right.rank - left.rank,
          // Equal ranks must preserve the native stable ordering from the previous commit.
          (left: Item, right: Item) => (left.rank % 7) - (right.rank % 7),
        ];
        let expectedItems = initialItems;
        for (const compare of compares) {
          const previousIndices = new Map(expectedItems.map((item, index) => [item.id, index]));
          const opposite = (left: Item, right: Item) => -compare(left, right);
          if (action === "editAndSort") {
            expectedItems = expectedItems.map((item) =>
              item.id === "row-0" ? { ...item, label: `${item.label}!` } : item,
            );
          } else if (action === "queueSorts") {
            expectedItems = expectedItems.toSorted(opposite);
          } else if (action === "reorderPipeline") {
            expectedItems = expectedItems.toReversed();
          }
          expectedItems = expectedItems.toSorted(compare);
          const expectedMoves =
            expectedItems.length -
            lisLength(expectedItems.map((item) => previousIndices.get(item.id)!));
          rowMapCopies = 0;
          indexWrites.count = 0;
          harness.counters.keys = 0;
          harness.counters.descriptors = 0;
          harness.counters.bindings = 0;
          insertBefore.mockClear();

          await act(async () => {
            if (action === "queueSorts") harness.queueSorts([opposite, compare]);
            else if (action === "reorderPipeline") {
              harness.reorderPipeline([{ kind: "reverse" }, { kind: "sort", compare }]);
            } else harness[action](compare);
            await flushCompilerUpdates();
          });

          expect(itemLabels(container)).toEqual(expectedItems.map((item) => item.label));
          const currentRows = [...container.querySelectorAll("li")];
          currentRows.forEach((row, index) => expect(row).toBe(rows.get(expectedItems[index].id)));
          expect(insertBefore).toHaveBeenCalledTimes(expectedMoves);
          expect(harness.counters).toEqual({
            executions: 1,
            renders: 1,
            keys: action === "editAndSort" ? 1 : 0,
            descriptors: 0,
            bindings: action === "editAndSort" ? 1 : 0,
          });
          expect(rowMapCopies).toBe(0);
          expect(indexWrites.count).toBe(0);
          harness.calls.length = 0;
          const clickedIndices = [
            ...new Set([0, 63, 127, expectedItems.findIndex((item) => item.id === "row-0")]),
          ];
          await act(async () => {
            for (const index of clickedIndices) currentRows[index].click();
          });
          expect(harness.calls).toEqual(
            clickedIndices.map((index) => {
              const item = expectedItems[index];
              return `${item.id}:${item.label}:${index}`;
            }),
          );
        }
      },
    );

    it.each(["customSort", "mismatchedSort"] as const)(
      `rebuilds delegated lookups for %s between native sorts in ${reactivity}`,
      async (action) => {
        const initialItems = Array.from(
          { length: 16 },
          (_, index): Item => ({
            id: `row-${index}`,
            label: `Row ${index}`,
            rank: (index * 5) % 16,
          }),
        );
        const harness = createSortHarness(initialItems, false, reactivity, true);
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        roots.push(root);
        await act(async () => root.render(<harness.Table />));
        const writes = trackRowIndexWrites();
        await act(async () => {
          harness.sort((left, right) => right.rank - left.rank);
          await flushCompilerUpdates();
        });
        expect(writes.count).toBe(0);
        let expectedItems = initialItems.toSorted((left, right) => left.rank - right.rank);
        const previousRows = [...container.querySelectorAll("li")];
        harness.counters.keys = 0;

        await act(async () => {
          harness[action]();
          await flushCompilerUpdates();
        });
        expect(writes.count).toBe(initialItems.length);
        expect(harness.counters.keys).toBeGreaterThan(0);
        if (action === "mismatchedSort") {
          expectedItems[0] = { ...expectedItems[0], id: `${expectedItems[0].id}-replacement` };
          expect(previousRows.at(-1)!.isConnected).toBe(false);
          expect(container.querySelector("li")).not.toBe(previousRows.at(-1));
          await act(async () => previousRows.at(-1)!.click());
          expect(harness.calls).toEqual([]);
        }
        const fallbackRows = [...container.querySelectorAll("li")];
        fallbackRows.forEach((row, index) => {
          if (action === "customSort" || index > 0) expect(row).toBe(previousRows.at(-index - 1));
        });
        await act(async () => {
          for (const row of fallbackRows) row.click();
        });
        expect(harness.calls).toEqual(
          expectedItems.map((item, index) => `${item.id}:${item.label}:${index}`),
        );

        writes.count = 0;
        harness.counters.keys = 0;
        harness.calls.length = 0;
        await act(async () => {
          harness.sort((left, right) => right.rank - left.rank);
          await flushCompilerUpdates();
        });
        expectedItems = expectedItems.toSorted((left, right) => right.rank - left.rank);
        const currentRows = [...container.querySelectorAll("li")];
        currentRows.forEach((row, index) => expect(row).toBe(fallbackRows.at(-index - 1)));
        expect(itemLabels(container)).toEqual(expectedItems.map((item) => item.label));
        expect(writes.count).toBe(0);
        expect(harness.counters.keys).toBe(0);
        expect(harness.counters.executions).toBe(1);
        expect(harness.counters.renders).toBe(1);
        await act(async () => {
          for (const row of currentRows) row.click();
        });
        expect(harness.calls).toEqual(
          expectedItems.map((item, index) => `${item.id}:${item.label}:${index}`),
        );
      },
    );
  }

  stressIt(
    "sorts 4,096 rows with minimum DOM moves and no key, descriptor, or binding reads",
    async () => {
      const initialItems = Array.from(
        { length: 4_096 },
        (_, index): Item => ({
          id: `row-${index}`,
          label: `Row ${index}`,
          rank: (index * 2_053) % 4_096,
        }),
      );
      const target = [...initialItems].sort((left, right) => left.rank - right.rank);
      const oldIndices = new Map(initialItems.map((item, index) => [item, index]));
      const expectedMoves = target.length - lisLength(target.map((item) => oldIndices.get(item)!));
      const harness = createSortHarness(initialItems);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => root.render(<harness.Table />));
      const firstTarget = container.querySelector(`[data-key="${target[0].id}"]`);
      const lastTarget = container.querySelector(`[data-key="${target.at(-1)!.id}"]`);
      const list = container.querySelector("ul")!;
      const insertBefore = vi.spyOn(list, "insertBefore");
      harness.counters.keys = 0;
      harness.counters.descriptors = 0;
      harness.counters.bindings = 0;

      await act(async () => {
        harness.sort((left, right) => left.rank - right.rank);
        await flushCompilerUpdates();
      });

      expect(container.querySelector("li:first-child")).toBe(firstTarget);
      expect(container.querySelector("li:last-child")).toBe(lastTarget);
      expect(insertBefore).toHaveBeenCalledTimes(expectedMoves);
      expect(harness.counters.executions).toBe(1);
      expect(harness.counters.renders).toBe(1);
      expect(harness.counters.keys).toBe(0);
      expect(harness.counters.descriptors).toBe(0);
      expect(harness.counters.bindings).toBe(0);
    },
  );

  it("composes queued sorts as one validated final permutation", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ];
    const target = [initialItems[0], initialItems[2], initialItems[1]];
    const harness = createSortHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const rows = new Map(
      [...container.querySelectorAll("li")].map((row) => [row.getAttribute("data-key"), row]),
    );
    const list = container.querySelector("ul")!;
    const insertBefore = vi.spyOn(list, "insertBefore");
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.queueTwo();
      await flushCompilerUpdates();
    });

    expect(itemLabels(container)).toEqual(target.map((item) => item.label));
    expect(container.querySelector('[data-key="a"]')).toBe(rows.get("a"));
    expect(container.querySelector('[data-key="b"]')).toBe(rows.get("b"));
    expect(container.querySelector('[data-key="c"]')).toBe(rows.get("c"));
    expect(insertBefore).toHaveBeenCalledTimes(1);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(0);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(0);
  });

  it("composes mixed native sort and reverse setters", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ];
    for (const operation of ["reverse-sort", "sort-reverse"] as const) {
      const harness = createSortHarness(initialItems);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => root.render(<harness.Table />));
      harness.counters.keys = 0;
      await act(async () => {
        if (operation === "reverse-sort") harness.reverseThenSort();
        else harness.sortThenReverse();
        await flushCompilerUpdates();
      });
      expect(itemLabels(container)).toEqual(
        operation === "reverse-sort" ? ["Beta", "Gamma", "Alpha"] : ["Alpha", "Gamma", "Beta"],
      );
      expect(harness.counters.keys).toBe(0);
    }
  });

  it("composes a native sort and reverse pipeline inside one setter", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ];
    for (const operation of ["reverse-sort", "sort-reverse"] as const) {
      const harness = createSortHarness(initialItems);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => root.render(<harness.Table />));
      const rows = new Map(
        [...container.querySelectorAll("li")].map((row) => [row.getAttribute("data-key"), row]),
      );
      harness.counters.keys = 0;
      harness.counters.descriptors = 0;
      harness.counters.bindings = 0;

      await act(async () => {
        if (operation === "reverse-sort") harness.reverseThenSortPipeline();
        else harness.sortThenReversePipeline();
        await flushCompilerUpdates();
      });

      expect(itemLabels(container)).toEqual(
        operation === "reverse-sort" ? ["Beta", "Gamma", "Alpha"] : ["Alpha", "Gamma", "Beta"],
      );
      for (const [key, row] of rows) {
        expect(container.querySelector(`[data-key="${key}"]`)).toBe(row);
      }
      expect(harness.counters.executions).toBe(1);
      expect(harness.counters.renders).toBe(1);
      expect(harness.counters.keys).toBe(0);
      expect(harness.counters.descriptors).toBe(0);
      expect(harness.counters.bindings).toBe(0);
    }
  });

  it("falls back for custom methods, unhinted chains, changed identities, and collection bindings", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ];
    for (const operation of [
      "custom",
      "custom-pipeline",
      "unhinted",
      "mismatched",
      "dependent",
    ] as const) {
      const harness = createSortHarness(initialItems, operation === "dependent");
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => root.render(<harness.Table />));
      harness.counters.keys = 0;
      await act(async () => {
        if (operation === "custom") harness.customSort();
        else if (operation === "custom-pipeline") harness.customSortThenReversePipeline();
        else if (operation === "unhinted") harness.plainThenSort();
        else if (operation === "mismatched") harness.mismatchedSort();
        else harness.sort((left, right) => left.rank - right.rank);
        await flushCompilerUpdates();
      });
      expect(harness.counters.keys).toBeGreaterThan(0);
      expect(itemLabels(container).length).toBe(3);
    }
  });

  it("preserves native sort arguments, stable results, and errors", () => {
    const source = [
      { id: "a", label: "Alpha", rank: 1 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 0 },
    ] as SortableArray;
    const compare = vi.fn((left: Item, right: Item) => left.rank - right.rank);
    const result = createCompilerKeyedArraySort(source, source.toSorted, compare) as Item[];
    expect(result.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(compare).toHaveBeenCalled();

    const customResult = [source[2]];
    const custom = vi.fn(function (this: Item[], received: unknown) {
      expect(this).toBe(source);
      expect(received).toBe(compare);
      return customResult;
    });
    expect(createCompilerKeyedArraySort(source, custom, compare)).toBe(customResult);
    expect(custom).toHaveBeenCalledOnce();

    const error = new Error("sort failed");
    expect(() =>
      createCompilerKeyedArraySort(source, source.toSorted, () => {
        throw error;
      }),
    ).toThrow(error);
  });

  it("preserves focused controlled-input identity and selection through a reorder pipeline", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ];
    let reorderPipeline = () => undefined;
    const FormRows = createCompiledComponent({
      displayName: "SortFormRows",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        reorderPipeline = () =>
          state[0].set((previous) =>
            hintedReverse(hintedSort(previous as Item[], (left, right) => left.rank - right.rank)),
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
              bindings={[]}
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
      reorderPipeline();
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="b"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  });

  it("matches normal React through 2,000 randomized permutations", async () => {
    const initialItems = Array.from(
      { length: 64 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}`, rank: index }),
    );
    const compiled = createSortHarness(initialItems);
    let queueReactSorts: (compares: Array<(left: Item, right: Item) => number>) => void = () =>
      undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      queueReactSorts = (compares) => {
        for (const compare of compares) {
          setItems((previous) => (previous as SortableArray).toSorted(compare));
        }
      };
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
    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = createRoot(compiledContainer);
    const reactRoot = createRoot(reactContainer);
    roots.push(compiledRoot, reactRoot);
    await act(async () => {
      compiledRoot.render(<compiled.Table />);
      reactRoot.render(<NormalTable />);
    });
    compiled.counters.keys = 0;

    let seed = 0x51f15e;
    for (let update = 0; update < 2_000; update += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const repetitions = 2 + (seed % 3);
      const compares: Array<(left: Item, right: Item) => number> = [];
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        const ranks = new Map<string, number>();
        for (const item of initialItems) {
          seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
          ranks.set(item.id, seed);
        }
        compares.push((left, right) => ranks.get(left.id)! - ranks.get(right.id)!);
      }
      await act(async () => {
        compiled.queueSorts(compares);
        queueReactSorts(compares);
        await flushCompilerUpdates();
      });
      if (update % 100 === 0) {
        expect(itemLabels(compiledContainer)).toEqual(itemLabels(reactContainer));
      }
    }
    expect(itemLabels(compiledContainer)).toEqual(itemLabels(reactContainer));
    expect(compiled.counters.executions).toBe(1);
    expect(compiled.counters.keys).toBe(0);
  }, 20_000);

  it("matches normal React through 2,000 randomized native reorder pipelines", async () => {
    const initialItems = Array.from(
      { length: 64 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}`, rank: index }),
    );
    const compiled = createSortHarness(initialItems);
    let runReactPipeline: (operations: readonly ReorderPipelineOperation[]) => void = () =>
      undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      runReactPipeline = (operations) => {
        setItems((previous) => {
          let next = previous as SortableArray;
          for (const operation of operations) {
            next = (
              operation.kind === "reverse" ? next.toReversed() : next.toSorted(operation.compare)
            ) as SortableArray;
          }
          return next;
        });
      };
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
    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = createRoot(compiledContainer);
    const reactRoot = createRoot(reactContainer);
    roots.push(compiledRoot, reactRoot);
    await act(async () => {
      compiledRoot.render(<compiled.Table />);
      reactRoot.render(<NormalTable />);
    });
    compiled.counters.keys = 0;

    let seed = 0x4f1bbcdc;
    for (let update = 0; update < 2_000; update += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const stepCount = 2 + (seed % 3);
      const operations: ReorderPipelineOperation[] = [];
      for (let step = 0; step < stepCount; step += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        if ((seed & 1) === 0) {
          operations.push({ kind: "reverse" });
          continue;
        }
        const ranks = new Map<string, number>();
        for (const item of initialItems) {
          seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
          ranks.set(item.id, seed);
        }
        operations.push({
          compare: (left, right) => ranks.get(left.id)! - ranks.get(right.id)!,
          kind: "sort",
        });
      }
      await act(async () => {
        compiled.reorderPipeline(operations);
        runReactPipeline(operations);
        await flushCompilerUpdates();
      });
      if (update % 100 === 0) {
        expect(itemLabels(compiledContainer)).toEqual(itemLabels(reactContainer));
      }
    }
    expect(itemLabels(compiledContainer)).toEqual(itemLabels(reactContainer));
    expect(compiled.counters.executions).toBe(1);
    expect(compiled.counters.keys).toBe(0);
  }, 20_000);

  it("supports StrictMode hydration and ignores a flush after unmount", async () => {
    const items: Item[] = [
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ];
    const hydration = createSortHarness(items);
    const container = document.createElement("div");
    container.innerHTML = renderToString(<hydration.Table />);
    document.body.append(container);
    const root = hydrateRoot(
      container,
      <StrictMode>
        <hydration.Table />
      </StrictMode>,
    );
    roots.push(root);
    await act(async () => flushCompilerUpdates());
    const beta = container.querySelector('[data-key="b"]');
    await act(async () => {
      hydration.sortThenReversePipeline();
      await flushCompilerUpdates();
    });
    expect(itemLabels(container)).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(container.querySelector('[data-key="b"]')).toBe(beta);

    const unmounted = createSortHarness(items);
    const unmountContainer = document.createElement("div");
    document.body.append(unmountContainer);
    const unmountRoot = createRoot(unmountContainer);
    await act(async () => unmountRoot.render(<unmounted.Table />));
    unmounted.reverseThenSortPipeline();
    await act(async () => unmountRoot.unmount());
    await flushCompilerUpdates();
    expect(unmountContainer.childElementCount).toBe(0);
  });
});
