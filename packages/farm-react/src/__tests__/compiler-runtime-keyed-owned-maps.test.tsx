import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  createCompiledComponentWithFeatures,
  createCompilerKeyedArrayBatchInsert,
  createCompilerKeyedArrayFilter,
  createCompilerKeyedArrayPositionUpdate,
  createCompilerKeyedArrayPrepend,
  createCompilerKeyedArrayStructuralPrepend,
  createCompilerKeyedArrayStructuralPrependMapPipeline,
  createCompilerKeyedArrayWindowReplace,
  keyedRowsBatchPositionHintedRuntimeFeature,
  keyedRowsPositionHintedRuntimeFeature,
  keyedRowsPrependHintedRuntimeFeature,
  keyedRowsStructuralPrependHintedRuntimeFeature,
  keyedRowsStructuralPrependMapHintedRuntimeFeature,
  keyedRowsWindowPositionHintedRuntimeFeature,
  type CompilerRuntimeFeature,
} from "../compiler-runtime";

interface Item {
  id: string;
  label: string;
}
type Items = Item[] & {
  toSpliced(start: number, deleteCount: number, ...items: Item[]): Items;
  with(index: number, item: Item): Items;
};
type Update = (items: Items) => Items;
const roots: Root[] = [];
const item = (id: string): Item => ({ id, label: id });
const position = (
  items: Items,
  kind: "insert" | "remove" | "replace",
  start: number,
  ...args: unknown[]
) => createCompilerKeyedArrayPositionUpdate(items, items.toSpliced, kind, start, ...args) as Items;
const window = (items: Items, start: number, count: number, ...incoming: Item[]) =>
  createCompilerKeyedArrayWindowReplace(items, items.toSpliced, start, count, ...incoming) as Items;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

async function copiedRowMapSizes(update: () => void): Promise<number[]> {
  const NativeMap = Map;
  const sizes: number[] = [];
  vi.stubGlobal(
    "Map",
    class extends NativeMap {
      constructor(...args: ConstructorParameters<typeof Map>) {
        super(...args);
        const source = args[0];
        if (!(source instanceof NativeMap)) return;
        const first = source.values().next().value;
        if (source.size === 0 || first?.element instanceof Element) sizes.push(source.size);
      }
    },
  );
  try {
    await act(async () => {
      update();
      await Promise.resolve();
      await Promise.resolve();
    });
  } finally {
    vi.unstubAllGlobals();
  }
  return sizes;
}

async function mount(initial: Items, feature?: CompilerRuntimeFeature, delegated = true) {
  let update: (fn: Update) => void = () => undefined;
  let seen: { id: string; index: number } | undefined;
  let renders = 0;
  const create: typeof createCompiledComponent = feature
    ? (definition) => createCompiledComponentWithFeatures(definition, [feature])
    : createCompiledComponent;
  const List = create({
    displayName: "OwnedMapsList",
    initialize: () => [initial],
    render(_props: Record<string, never>, state, blocks) {
      const items = () => state[0].get() as Items;
      update = (fn) => state[0].set((previous) => fn(previous as Items));
      return (
        <section>
          <blocks.KeyedRows
            id={0}
            items={items}
            dependencies={[0]}
            structureDependencies={[0]}
            collectionDependency={0}
            positionIndexIndependent
            prependIndexIndependent
            filterIndexIndependent
            delegateEvents={delegated}
            rowKey={(row) => (row as Item).id}
            events={[
              {
                name: "onClick",
                path: [],
                invoke: (row, index) => {
                  seen = { id: (row as Item).id, index };
                },
              },
            ]}
            bindings={[
              { kind: "text", path: [], dependencies: [], read: (row) => [(row as Item).label] },
            ]}
            create={(row) => ({
              kind: "element",
              tag: "li",
              attributes: [{ name: "data-key", value: (row as Item).id }],
              styles: [],
              children: [(row as Item).label],
            })}
            render={(event) => {
              renders += 1;
              return (
                <ul>
                  {items().map((row, index) => (
                    <li key={row.id} data-key={row.id} onClick={event(row, index, 0)}>
                      {row.label}
                    </li>
                  ))}
                </ul>
              );
            }}
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
  await act(async () => root.render(<List />));
  return {
    container,
    update: (fn: Update) => update(fn),
    renders: () => renders,
    seen: () => seen,
  };
}

interface Scenario {
  name: string;
  feature: CompilerRuntimeFeature;
  updates: Update[];
  expected: (items: Items) => Item[];
}
const scenarios: Scenario[] = [
  {
    name: "insert",
    feature: keyedRowsPositionHintedRuntimeFeature,
    updates: [(rows) => position(rows, "insert", 1, 0, item("new"))],
    expected: (rows) => rows.toSpliced(1, 0, item("new")),
  },
  {
    name: "remove",
    feature: keyedRowsPositionHintedRuntimeFeature,
    updates: [(rows) => position(rows, "remove", 1, 1)],
    expected: (rows) => rows.toSpliced(1, 1),
  },
  {
    name: "remove all",
    feature: keyedRowsPositionHintedRuntimeFeature,
    updates: [(rows) => position(rows, "remove", 0, rows.length)],
    expected: () => [],
  },
  {
    name: "replace",
    feature: keyedRowsPositionHintedRuntimeFeature,
    updates: [(rows) => position(rows, "replace", 1, 1, item("new"))],
    expected: (rows) => rows.toSpliced(1, 1, item("new")),
  },
  {
    name: "same-key replace",
    feature: keyedRowsPositionHintedRuntimeFeature,
    updates: [(rows) => position(rows, "replace", 1, 1, { ...rows[1], label: "changed" })],
    expected: (rows) => rows.toSpliced(1, 1, { ...rows[1], label: "changed" }),
  },
  {
    name: "batch insert",
    feature: keyedRowsBatchPositionHintedRuntimeFeature,
    updates: [
      (rows) =>
        createCompilerKeyedArrayBatchInsert(
          rows,
          rows.toSpliced,
          1,
          item("new-a"),
          item("new-b"),
        ) as Items,
    ],
    expected: (rows) => rows.toSpliced(1, 0, item("new-a"), item("new-b")),
  },
  {
    name: "window replace",
    feature: keyedRowsWindowPositionHintedRuntimeFeature,
    updates: [(rows) => window(rows, 1, 2, item("new"))],
    expected: (rows) => rows.toSpliced(1, 2, item("new")),
  },
  {
    name: "same-key window",
    feature: keyedRowsWindowPositionHintedRuntimeFeature,
    updates: [(rows) => window(rows, 1, 2, { ...rows[1], label: "changed" }, rows[2])],
    expected: (rows) => rows.toSpliced(1, 2, { ...rows[1], label: "changed" }, rows[2]),
  },
  {
    name: "queued windows",
    feature: keyedRowsWindowPositionHintedRuntimeFeature,
    updates: [
      (rows) => window(rows, 1, 2, item("new-a")),
      (rows) => window(rows, 5, 1, item("new-b"), item("new-c")),
    ],
    expected: (rows) =>
      rows.toSpliced(1, 2, item("new-a")).toSpliced(5, 1, item("new-b"), item("new-c")),
  },
  {
    name: "prepend",
    feature: keyedRowsPrependHintedRuntimeFeature,
    updates: [(rows) => createCompilerKeyedArrayPrepend(rows, [item("new"), ...rows]) as Items],
    expected: (rows) => [item("new"), ...rows],
  },
  {
    name: "structural prepend",
    feature: keyedRowsStructuralPrependHintedRuntimeFeature,
    updates: [
      (rows) =>
        createCompilerKeyedArrayFilter(
          rows,
          rows.filter,
          (row: Item) => row.id !== "row-1",
        ) as Items,
      (rows) => createCompilerKeyedArrayStructuralPrepend(rows, [item("new"), ...rows]) as Items,
    ],
    expected: (rows) => [item("new"), ...rows.filter((row) => row.id !== "row-1")],
  },
  {
    name: "mapped structural prepend",
    feature: keyedRowsStructuralPrependMapHintedRuntimeFeature,
    updates: [
      (rows) =>
        createCompilerKeyedArrayFilter(
          rows,
          rows.filter,
          (row: Item) => row.id !== "row-1",
        ) as Items,
      (rows) => createCompilerKeyedArrayStructuralPrepend(rows, [item("new"), ...rows]) as Items,
      (rows) =>
        createCompilerKeyedArrayStructuralPrependMapPipeline(rows, (current, applyMap) =>
          applyMap(current, (current as Items).map, (row: Item) =>
            row.id === "row-2" ? { ...row, label: "changed" } : row,
          ),
        ) as Items,
    ],
    expected: (rows) => [
      item("new"),
      ...rows
        .filter((row) => row.id !== "row-1")
        .map((row) => (row.id === "row-2" ? { ...row, label: "changed" } : row)),
    ],
  },
];

describe.each(["complete", "specialized"])("owned row maps (%s)", (runtime) => {
  it.each(scenarios)("does not copy maps after $name", async ({ feature, updates, expected }) => {
    const initial = Array.from({ length: 1_000 }, (_, i) => item(`row-${i}`)) as Items;
    const harness = await mount(initial, runtime === "specialized" ? feature : undefined);
    const before = new Map(
      [...harness.container.querySelectorAll("li")].map((row) => [row.dataset.key, row]),
    );
    const copies = await copiedRowMapSizes(() => {
      for (const update of updates) harness.update(update);
    });
    const rows = [...harness.container.querySelectorAll("li")];
    expect(rows.map((row) => ({ id: row.dataset.key, label: row.textContent }))).toEqual(
      expected(initial),
    );
    for (const row of rows)
      if (before.has(row.dataset.key)) expect(row).toBe(before.get(row.dataset.key));
    if (rows.length) {
      rows.at(-1)!.click();
      expect(harness.seen()).toEqual({ id: rows.at(-1)!.dataset.key, index: rows.length - 1 });
    }
    expect(harness.renders()).toBe(1);
    expect(copies).toEqual([]);
  });
});

it.each([true, false])(
  "keeps consecutive updates isolated across lists (delegated: %s)",
  async (delegated) => {
    const initial = Array.from({ length: 10 }, (_, i) => item(`row-${i}`)) as Items;
    const first = await mount(initial, undefined, delegated);
    const second = await mount(initial, undefined, delegated);
    const untouched = [...second.container.querySelectorAll("li")];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (const update of [
        (rows: Items) => position(rows, "remove", 1, 1),
        (rows: Items) =>
          createCompilerKeyedArrayPrepend(rows, [item(`new-${cycle}`), ...rows]) as Items,
        (rows: Items) => window(rows, 2, 1, { ...rows[2], label: "changed" }),
        (rows: Items) => position(rows, "remove", 0, rows.length),
        (rows: Items) => createCompilerKeyedArrayPrepend(rows, [...initial]) as Items,
      ]) {
        expect(await copiedRowMapSizes(() => first.update(update))).toEqual([]);
        expect([...second.container.querySelectorAll("li")]).toEqual(untouched);
        const rows = [...first.container.querySelectorAll("li")];
        if (rows.length) {
          rows.at(-1)!.click();
          expect(first.seen()).toEqual({ id: rows.at(-1)!.dataset.key, index: rows.length - 1 });
        }
      }
      expect([...first.container.querySelectorAll("li")].map((row) => row.textContent)).toEqual(
        initial.map((row) => row.label),
      );
    }
  },
);
