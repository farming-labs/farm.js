import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  createCompilerKeyedArrayReorder,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
}

type ReversibleArray = Item[] & { toReversed(): Item[] };

const roots: Root[] = [];

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

function hintedReverse(previous: Item[]): Item[] {
  const source = previous as ReversibleArray;
  return createCompilerKeyedArrayReorder(source, source.toReversed) as Item[];
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

function createReorderHarness(initialItems: Item[], readsCollection = false) {
  const counters = {
    executions: 0,
    renders: 0,
    keys: 0,
    descriptors: 0,
    bindings: 0,
  };
  let reverse: () => void = () => undefined;
  let queueTwo: () => void = () => undefined;
  let customReverse: () => void = () => undefined;
  const Table = createCompiledComponent({
    displayName: "ReorderTable",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      reverse = () => state[0].set((previous) => hintedReverse(previous as Item[]));
      queueTwo = () => {
        state[0].set((previous) => hintedReverse(previous as Item[]));
        state[0].set((previous) => hintedReverse(previous as Item[]));
      };
      customReverse = () =>
        state[0].set((previous) => {
          const source = previous as Item[];
          const method = function (this: Item[]) {
            return [...this].reverse();
          };
          return createCompilerKeyedArrayReorder(source, method) as Item[];
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
    customReverse: () => customReverse(),
    queueTwo: () => queueTwo(),
    reverse: () => reverse(),
  };
}

function itemLabels(container: Element): string[] {
  return [...container.querySelectorAll("li")].map((node) => node.textContent || "");
}

describe("compiled keyed-array reorder hints", () => {
  it("reverses 4,096 rows with minimum DOM moves and no key, descriptor, or binding reads", async () => {
    const initialItems = Array.from(
      { length: 4_096 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createReorderHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const first = container.querySelector('[data-key="row-0"]');
    const last = container.querySelector('[data-key="row-4095"]');
    const list = container.querySelector("ul")!;
    const insertBefore = vi.spyOn(list, "insertBefore");
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.reverse();
      await flushCompilerUpdates();
    });

    expect(container.querySelector("li:first-child")).toBe(last);
    expect(container.querySelector("li:last-child")).toBe(first);
    expect(insertBefore).toHaveBeenCalledTimes(4_095);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(0);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(0);
  });

  it("falls back safely for custom methods, queued hints, and collection-reading bindings", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    const custom = createReorderHarness(initialItems);
    const customContainer = document.createElement("div");
    document.body.append(customContainer);
    const customRoot = createRoot(customContainer);
    roots.push(customRoot);
    await act(async () => customRoot.render(<custom.Table />));
    custom.counters.keys = 0;
    await act(async () => {
      custom.customReverse();
      await flushCompilerUpdates();
    });
    expect(itemLabels(customContainer)).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(custom.counters.keys).toBeGreaterThan(0);

    const queued = createReorderHarness(initialItems);
    const queuedContainer = document.createElement("div");
    document.body.append(queuedContainer);
    const queuedRoot = createRoot(queuedContainer);
    roots.push(queuedRoot);
    await act(async () => queuedRoot.render(<queued.Table />));
    queued.counters.keys = 0;
    await act(async () => {
      queued.queueTwo();
      await flushCompilerUpdates();
    });
    expect(itemLabels(queuedContainer)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(queued.counters.keys).toBeGreaterThan(0);

    const dependent = createReorderHarness(initialItems, true);
    const dependentContainer = document.createElement("div");
    document.body.append(dependentContainer);
    const dependentRoot = createRoot(dependentContainer);
    roots.push(dependentRoot);
    await act(async () => dependentRoot.render(<dependent.Table />));
    dependent.counters.keys = 0;
    await act(async () => {
      dependent.reverse();
      await flushCompilerUpdates();
    });
    expect(itemLabels(dependentContainer)).toEqual(["3: Gamma", "3: Beta", "3: Alpha"]);
    expect(dependent.counters.keys).toBeGreaterThan(0);
  });

  it("preserves native call results and errors without recording custom behavior", () => {
    const source = [{ id: "a", label: "Alpha" }];
    const customResult = [{ id: "b", label: "Beta" }];
    const custom = vi.fn(function (this: Item[]) {
      expect(this).toBe(source);
      return customResult;
    });

    expect(createCompilerKeyedArrayReorder(source, custom)).toBe(customResult);
    expect(custom).toHaveBeenCalledOnce();
    const error = new Error("reverse failed");
    expect(() =>
      createCompilerKeyedArrayReorder(source, () => {
        throw error;
      }),
    ).toThrow(error);
  });

  it("preserves focused controlled-input identity and selection while moving rows", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    let reverse = () => undefined;
    const FormRows = createCompiledComponent({
      displayName: "ReorderFormRows",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        reverse = () => state[0].set((previous) => hintedReverse(previous as Item[]));
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
      reverse();
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="b"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  });

  it("matches normal React through 2,000 randomized reversals", async () => {
    const initialItems = Array.from(
      { length: 64 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const compiled = createReorderHarness(initialItems);
    let reverseReact: () => void = () => undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      reverseReact = () => setItems((previous) => (previous as ReversibleArray).toReversed());
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

    let seed = 0x9e3779b9;
    for (let update = 0; update < 2_000; update += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const repetitions = (seed & 3) + 1;
      await act(async () => {
        for (let count = 0; count < repetitions; count += 1) {
          compiled.reverse();
          reverseReact();
        }
        await flushCompilerUpdates();
      });
      if (update % 100 === 0) {
        expect(itemLabels(compiledContainer)).toEqual(itemLabels(reactContainer));
      }
    }
    expect(itemLabels(compiledContainer)).toEqual(itemLabels(reactContainer));
    expect(compiled.counters.executions).toBe(1);
  }, 15_000);

  it("supports StrictMode hydration and ignores a flush after unmount", async () => {
    const items: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    const hydration = createReorderHarness(items);
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
    const alpha = container.querySelector('[data-key="a"]');
    await act(async () => {
      hydration.reverse();
      await flushCompilerUpdates();
    });
    expect(itemLabels(container)).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);

    const unmounted = createReorderHarness(items);
    const unmountContainer = document.createElement("div");
    document.body.append(unmountContainer);
    const unmountRoot = createRoot(unmountContainer);
    await act(async () => unmountRoot.render(<unmounted.Table />));
    unmounted.reverse();
    await act(async () => unmountRoot.unmount());
    await flushCompilerUpdates();
    expect(unmountContainer.childElementCount).toBe(0);
  });
});
