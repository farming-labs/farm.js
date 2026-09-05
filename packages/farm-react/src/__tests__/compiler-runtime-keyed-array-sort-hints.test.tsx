import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
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

function createSortHarness(initialItems: Item[], readsCollection = false) {
  const counters = {
    executions: 0,
    renders: 0,
    keys: 0,
    descriptors: 0,
    bindings: 0,
  };
  let sort: (compare: (left: Item, right: Item) => number) => void = () => undefined;
  let queueSorts: (compares: Array<(left: Item, right: Item) => number>) => void = () => undefined;
  let queueTwo: () => void = () => undefined;
  let plainThenSort: () => void = () => undefined;
  let reverseThenSort: () => void = () => undefined;
  let sortThenReverse: () => void = () => undefined;
  let customSort: () => void = () => undefined;
  let mismatchedSort: () => void = () => undefined;
  const Table = createCompiledComponent({
    displayName: "SortTable",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      sort = (compare) => state[0].set((previous) => hintedSort(previous as Item[], compare));
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
    counters,
    customSort: () => customSort(),
    mismatchedSort: () => mismatchedSort(),
    plainThenSort: () => plainThenSort(),
    queueSorts: (compares: Array<(left: Item, right: Item) => number>) => queueSorts(compares),
    queueTwo: () => queueTwo(),
    reverseThenSort: () => reverseThenSort(),
    sort: (compare: (left: Item, right: Item) => number) => sort(compare),
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

describe("compiled keyed-array sort hints", () => {
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

  it("falls back for custom methods, unhinted chains, changed identities, and collection bindings", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ];
    for (const operation of ["custom", "unhinted", "mismatched", "dependent"] as const) {
      const harness = createSortHarness(initialItems, operation === "dependent");
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => root.render(<harness.Table />));
      harness.counters.keys = 0;
      await act(async () => {
        if (operation === "custom") harness.customSort();
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

  it("preserves focused controlled-input identity and selection while sorting", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ];
    let sortTwice = () => undefined;
    const FormRows = createCompiledComponent({
      displayName: "SortFormRows",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        sortTwice = () => {
          state[0].set((previous) =>
            hintedSort(previous as Item[], (left, right) => left.rank - right.rank),
          );
          state[0].set((previous) =>
            hintedSort(previous as Item[], (left, right) => left.rank - right.rank),
          );
        };
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
      sortTwice();
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

  it("supports StrictMode hydration and ignores a flush after unmount", async () => {
    const items: Item[] = [
      { id: "a", label: "Alpha", rank: 3 },
      { id: "b", label: "Beta", rank: 1 },
      { id: "c", label: "Gamma", rank: 2 },
    ];
    const compare = (left: Item, right: Item) => left.rank - right.rank;
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
      hydration.sort(compare);
      hydration.sort(compare);
      await flushCompilerUpdates();
    });
    expect(itemLabels(container)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(container.querySelector('[data-key="b"]')).toBe(beta);

    const unmounted = createSortHarness(items);
    const unmountContainer = document.createElement("div");
    document.body.append(unmountContainer);
    const unmountRoot = createRoot(unmountContainer);
    await act(async () => unmountRoot.render(<unmounted.Table />));
    unmounted.sort(compare);
    unmounted.sort(compare);
    await act(async () => unmountRoot.unmount());
    await flushCompilerUpdates();
    expect(unmountContainer.childElementCount).toBe(0);
  });
});
