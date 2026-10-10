import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent as createCompleteCompiledComponent,
  createCompiledComponentWithFeatures,
  createCompilerKeyedArrayAppend,
  createCompilerKeyedArrayFilter,
  createCompilerKeyedArraySlice,
  createCompilerKeyedMapUpdate,
  keyedRowsIdentityFilterHintedRuntimeFeature,
  keyedRowsIdentityFilterOnlyRuntimeFeature,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
}

interface Counters {
  executions: number;
  listRenders: number;
  keyReads: number;
  descriptorReads: number;
  bindingReads: number;
}

const roots: Root[] = [];
let createCompiledComponent: typeof createCompleteCompiledComponent;

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
        // Only count copies of row-instance maps (including an empty result),
        // not unrelated maps allocated while React flushes the update.
        if (source.size === 0 || first?.element instanceof Element) sizes.push(source.size);
      }
    },
  );
  try {
    await act(async () => {
      update();
      await flushCompilerUpdates();
    });
  } finally {
    vi.unstubAllGlobals();
  }
  return sizes;
}

function hintedFilter(items: Item[], removed: ReadonlySet<string>): Item[] {
  return createCompilerKeyedArrayFilter(
    items,
    items.filter,
    (item: Item) => !removed.has(item.id),
  ) as Item[];
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

function createFilterHarness(initialItems: Item[], readsCollection = false) {
  const counters: Counters = {
    executions: 0,
    listRenders: 0,
    keyReads: 0,
    descriptorReads: 0,
    bindingReads: 0,
  };
  let remove: (ids: readonly string[]) => void = () => undefined;
  let slice: (start: number, end?: number) => void = () => undefined;
  let reset: () => void = () => undefined;
  let plainThenFilter: (id: string) => void = () => undefined;
  let update: (next: (items: Item[]) => unknown) => void = () => undefined;
  const Inventory = createCompiledComponent({
    displayName: "FilterInventory",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      update = (next) => state[0].set((previous) => next(previous as Item[]));
      remove = (ids) => state[0].set((previous) => hintedFilter(previous as Item[], new Set(ids)));
      slice = (start, end) =>
        state[0].set((previous) =>
          createCompilerKeyedArraySlice(previous, (previous as Item[]).slice, start, end),
        );
      reset = () => state[0].set([...initialItems]);
      plainThenFilter = (id) => {
        state[0].set((previous) => [...(previous as Item[])]);
        state[0].set((previous) => hintedFilter(previous as Item[], new Set([id])));
      };
      const text = (item: Item) =>
        readsCollection ? `${items().length}: ${item.label}` : item.label;
      return (
        <section>
          <blocks.KeyedRows
            collectionDependency={0}
            dependencies={[0]}
            filterIndexIndependent
            id={0}
            items={items}
            structureDependencies={[0]}
            render={() => {
              counters.listRenders += 1;
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
              counters.keyReads += 1;
              return (item as Item).id;
            }}
            create={(item) => {
              counters.descriptorReads += 1;
              return rowDescriptor(item as Item);
            }}
            bindings={[
              {
                kind: "text",
                path: [],
                dependencies: readsCollection ? [0] : [],
                read: (item) => {
                  counters.bindingReads += 1;
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
    Inventory,
    counters,
    plainThenFilter: (id: string) => plainThenFilter(id),
    remove: (ids: readonly string[]) => remove(ids),
    slice: (start: number, end?: number) => slice(start, end),
    reset: () => reset(),
    update: (next: (items: Item[]) => unknown) => update(next),
  };
}

describe.each([
  undefined,
  keyedRowsIdentityFilterHintedRuntimeFeature,
  keyedRowsIdentityFilterOnlyRuntimeFeature,
])("filter hints (feature: %s)", (feature) => {
  beforeEach(() => {
    createCompiledComponent = feature
      ? (definition) => createCompiledComponentWithFeatures(definition, [feature])
      : createCompleteCompiledComponent;
  });

  it.each(["remove", "keep-all", "queued", "slice", "clear"] as const)(
    "does not copy the owned row map after %s",
    async (operation) => {
      const initialItems = Array.from(
        { length: 1_000 },
        (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
      );
      const harness = createFilterHarness(initialItems);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => root.render(<harness.Inventory />));
      const before = [...container.querySelectorAll("li")];
      harness.counters.keyReads = 0;
      harness.counters.descriptorReads = 0;
      harness.counters.bindingReads = 0;
      let expected = before;

      const copiedSizes = await copiedRowMapSizes(() => {
        switch (operation) {
          case "remove":
            harness.remove(["row-500"]);
            expected = before.filter((_, index) => index !== 500);
            break;
          case "keep-all":
            harness.remove([]);
            break;
          case "queued":
            harness.remove(["row-1"]);
            harness.remove(["row-998"]);
            expected = before.filter((_, index) => index !== 1 && index !== 998);
            break;
          case "slice":
            harness.slice(10, -10);
            expected = before.slice(10, -10);
            break;
          case "clear":
            harness.remove(initialItems.map((item) => item.id));
            expected = [];
            break;
        }
      });

      const after = [...container.querySelectorAll("li")];
      expect(after).toHaveLength(expected.length);
      after.forEach((row, index) => expect(row).toBe(expected[index]));
      expect(harness.counters.executions).toBe(1);
      expect(harness.counters.listRenders).toBe(1);
      expect(harness.counters.keyReads).toBe(operation === "slice" ? 0 : expected.length);
      expect(harness.counters.descriptorReads).toBe(0);
      expect(harness.counters.bindingReads).toBe(0);
      expect(copiedSizes).toEqual([]);
    },
  );

  it("keeps row maps independent across mounted lists and clear/reset cycles", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    const first = createFilterHarness(initialItems);
    const second = createFilterHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <>
          <first.Inventory />
          <second.Inventory />
        </>,
      ),
    );
    const [firstList, secondList] = container.querySelectorAll("ul");
    const secondRows = [...secondList.children];

    await act(async () => {
      first.remove(["b"]);
      await flushCompilerUpdates();
    });
    await act(async () => {
      first.remove(["a", "c"]);
      await flushCompilerUpdates();
    });
    expect(firstList.children).toHaveLength(0);
    await act(async () => {
      first.reset();
      await flushCompilerUpdates();
    });
    const resetRows = [...firstList.children];
    await act(async () => {
      first.remove(["a"]);
      await flushCompilerUpdates();
    });

    expect([...firstList.children]).toHaveLength(2);
    expect(firstList.children[0]).toBe(resetRows[1]);
    expect(firstList.children[1]).toBe(resetRows[2]);
    expect(secondList.children).toHaveLength(3);
    secondRows.forEach((row, index) => expect(secondList.children[index]).toBe(row));
    await act(async () => {
      second.remove(["c"]);
      await flushCompilerUpdates();
    });
    expect(secondList.children).toHaveLength(2);
    expect(secondList.children[0]).toBe(secondRows[0]);
    expect(secondList.children[1]).toBe(secondRows[1]);
    expect([...firstList.children].map((row) => row.textContent)).toEqual(["Beta", "Gamma"]);
  });

  it("removes only rejected rows and preserves every surviving DOM identity", async () => {
    const initialItems = Array.from(
      { length: 2_048 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createFilterHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));
    const first = container.querySelector('[data-key="row-0"]');
    const middle = container.querySelector('[data-key="row-1024"]');
    const last = container.querySelector('[data-key="row-2047"]');
    harness.counters.keyReads = 0;
    harness.counters.descriptorReads = 0;
    harness.counters.bindingReads = 0;

    await act(async () => {
      harness.remove(["row-100", "row-1500"]);
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="row-0"]')).toBe(first);
    expect(container.querySelector('[data-key="row-1024"]')).toBe(middle);
    expect(container.querySelector('[data-key="row-2047"]')).toBe(last);
    expect(container.querySelectorAll("li")).toHaveLength(2_046);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.listRenders).toBe(1);
    expect(harness.counters.keyReads).toBe(2_046);
    expect(harness.counters.descriptorReads).toBe(0);
    expect(harness.counters.bindingReads).toBe(0);
  });

  it("composes queued removals and rejects a chain after an unhinted update", async () => {
    const harness = createFilterHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));

    await act(async () => {
      harness.remove(["b"]);
      harness.remove(["d"]);
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha",
      "Gamma",
    ]);

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.plainThenFilter("a");
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("Gamma");
    expect(harness.counters.bindingReads).toBeGreaterThan(0);
  });

  it.each(["plain-map", "hinted-map", "hinted-append"] as const)(
    "preserves %s updates followed by removals",
    async (operation) => {
      const harness = createFilterHarness([
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ]);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => root.render(<harness.Inventory />));
      const before = [...container.querySelectorAll("li")];
      await act(async () => {
        harness.update((items) => {
          if (operation === "hinted-append") {
            return createCompilerKeyedArrayAppend(items, [...items, { id: "d", label: "Delta" }]);
          }
          const mapped = items.map((item, index) =>
            index === 1 ? { ...item, label: "Updated" } : item,
          );
          return operation === "hinted-map"
            ? createCompilerKeyedMapUpdate(items, mapped, [1])
            : mapped;
        });
        await flushCompilerUpdates();
      });
      const updated = [...container.querySelectorAll("li")];
      before.forEach((row, index) => expect(updated[index]).toBe(row));
      expect(updated.map((row) => row.textContent)).toEqual(
        operation === "hinted-append"
          ? ["Alpha", "Beta", "Gamma", "Delta"]
          : ["Alpha", "Updated", "Gamma"],
      );
      await act(async () => {
        harness.remove(["a"]);
        await flushCompilerUpdates();
      });
      expect([...container.querySelectorAll("li")]).toEqual(updated.slice(1));
      expect(container.querySelector("li")?.textContent).toBe(
        operation === "hinted-append" ? "Beta" : "Updated",
      );
    },
  );

  it("keeps collection-reading rows on complete reconciliation", async () => {
    const harness = createFilterHarness(
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ],
      true,
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));

    await act(async () => {
      harness.remove(["b"]);
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "2: Alpha",
      "2: Gamma",
    ]);
    expect(harness.counters.bindingReads).toBeGreaterThan(3);
  });

  it("updates delegated event indexes after earlier rows are removed", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    let removeFirst = () => undefined;
    const calls: string[] = [];
    const Inventory = createCompiledComponent({
      displayName: "FilterEventInventory",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        removeFirst = () =>
          state[0].set((previous) => hintedFilter(previous as Item[], new Set(["a"])));
        return (
          <section>
            <blocks.KeyedRows
              collectionDependency={0}
              delegateEvents
              dependencies={[0]}
              events={[
                {
                  invoke: (item, index) => calls.push(`${(item as Item).id}:${index}`),
                  name: "onClick",
                  path: [0],
                },
              ]}
              filterIndexIndependent
              id={0}
              items={items}
              structureDependencies={[0]}
              render={(event) => (
                <ul>
                  {items().map((item, index) => (
                    <li data-key={item.id} key={item.id}>
                      <button data-row-button={item.id} onClick={event(item, index, 0)}>
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
              create={(item) => {
                const row = item as Item;
                return {
                  kind: "element",
                  tag: "li",
                  attributes: [{ name: "data-key", value: row.id }],
                  styles: [],
                  children: [
                    {
                      kind: "element",
                      tag: "button",
                      attributes: [{ name: "data-row-button", value: row.id }],
                      styles: [],
                      children: [row.label],
                    },
                  ],
                };
              }}
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
    await act(async () => root.render(<Inventory />));

    await act(async () => {
      removeFirst();
      await flushCompilerUpdates();
    });
    await act(async () => {
      (container.querySelector('[data-row-button="c"]') as HTMLButtonElement).click();
    });
    expect(calls).toEqual(["c:1"]);
  });

  it("preserves custom filter behavior and predicate errors", () => {
    const items = [{ id: "a", label: "Alpha" }];
    const custom = function (this: Item[], predicate: (item: Item) => boolean) {
      expect(predicate(this[0])).toBe(true);
      return [{ id: "custom", label: "Custom" }];
    };
    expect(createCompilerKeyedArrayFilter(items, custom, (item: Item) => item.id === "a")).toEqual([
      { id: "custom", label: "Custom" },
    ]);
    const failure = new Error("predicate failed");
    expect(() =>
      createCompilerKeyedArrayFilter(items, items.filter, () => {
        throw failure;
      }),
    ).toThrow(failure);
  });

  it("matches React through 2,000 deterministic randomized removals", async () => {
    const initialItems = Array.from(
      { length: 2_001 },
      (_, index): Item => ({ id: `row-${index}`, label: `Value ${index}` }),
    );
    const harness = createFilterHarness(initialItems);
    let removeReact: (id: string) => void = () => undefined;
    function Normal() {
      const [items, setItems] = useState(initialItems);
      removeReact = (id) => setItems((previous) => previous.filter((item) => item.id !== id));
      return (
        <ol data-owner="react">
          {items.map((item) => (
            <li data-key={item.id} key={item.id}>
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
          <div data-owner="compiled">
            <harness.Inventory />
          </div>
          <Normal />
        </>,
      ),
    );

    let random = 0x9e3779b9;
    const active = initialItems.map((item) => item.id);
    for (let batch = 0; batch < 100; batch += 1) {
      await act(async () => {
        for (let update = 0; update < 20; update += 1) {
          random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
          const index = random % active.length;
          const [id] = active.splice(index, 1);
          harness.remove([id]);
          removeReact(id);
        }
        await flushCompilerUpdates();
      });
      expect(
        [...container.querySelectorAll('[data-owner="compiled"] li')].map((row) => row.outerHTML),
      ).toEqual(
        [...container.querySelectorAll('[data-owner="react"] li')].map((row) => row.outerHTML),
      );
    }
    expect(harness.counters.executions).toBe(1);
  }, 15_000);

  it("hydrates in StrictMode and drops a queued removal after unmount", async () => {
    const harness = createFilterHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]);
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <StrictMode>
        <harness.Inventory />
      </StrictMode>,
    );
    document.body.append(container);
    const recoverable: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(
        container,
        <StrictMode>
          <harness.Inventory />
        </StrictMode>,
        { onRecoverableError: (error) => recoverable.push(error) },
      );
    });
    roots.push(root);

    await act(async () => {
      harness.remove(["a"]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("Beta");
    expect(recoverable).toEqual([]);

    roots.pop();
    act(() => {
      harness.remove(["b"]);
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
