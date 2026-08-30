import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponentWithFeatures,
  createCompilerKeyedArrayBatchInsert,
  keyedRowsBatchPositionHintedRuntimeFeature,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
}

type BatchArray = Item[] & {
  toSpliced(start: number, deleteCount: number, ...items: Item[]): Item[];
};

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

function hintedBatchInsert(previous: Item[], position: number, items: readonly Item[]): Item[] {
  const source = previous as BatchArray;
  return createCompilerKeyedArrayBatchInsert(
    source,
    source.toSpliced,
    position,
    ...items,
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

function createBatchHarness(initialItems: Item[]) {
  const counters = { executions: 0, renders: 0, keys: 0, descriptors: 0, bindings: 0 };
  let insert: (position: number, items: readonly Item[]) => void = () => undefined;
  let remove: (position: number, count: number) => void = () => undefined;
  let queueTwo: (first: readonly Item[], second: readonly Item[]) => void = () => undefined;
  let customInsert: (position: number, items: readonly Item[]) => void = () => undefined;
  const Table = createCompiledComponentWithFeatures(
    {
      displayName: "BatchPositionTable",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        counters.executions += 1;
        const items = () => state[0].get() as Item[];
        insert = (position, incoming) =>
          state[0].set((previous) => hintedBatchInsert(previous as Item[], position, incoming));
        remove = (position, count) =>
          state[0].set((previous) => (previous as BatchArray).toSpliced(position, count));
        queueTwo = (first, second) => {
          state[0].set((previous) => hintedBatchInsert(previous as Item[], 1, first));
          state[0].set((previous) => hintedBatchInsert(previous as Item[], 2, second));
        };
        customInsert = (position, incoming) =>
          state[0].set((previous) => {
            const source = previous as Item[];
            const method = function (
              this: Item[],
              start: number,
              _remove: number,
              ...next: Item[]
            ) {
              return [...this.slice(0, start), ...next, ...this.slice(start)].reverse();
            };
            return createCompilerKeyedArrayBatchInsert(source, method, position, ...incoming);
          });
        return (
          <section>
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              id={0}
              items={items}
              positionIndexIndependent
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
    },
    [keyedRowsBatchPositionHintedRuntimeFeature],
  );
  return {
    Table,
    counters,
    customInsert: (position: number, items: readonly Item[]) => customInsert(position, items),
    insert: (position: number, items: readonly Item[]) => insert(position, items),
    remove: (position: number, count: number) => remove(position, count),
    queueTwo: (first: readonly Item[], second: readonly Item[]) => queueTwo(first, second),
  };
}

describe("compiled keyed-array batch insertion hints", () => {
  it("preserves custom method arguments, return values, and errors", () => {
    const source = [{ id: "a", label: "Alpha" }];
    const first = { id: "b", label: "Beta" };
    const second = { id: "c", label: "Gamma" };
    const calls: unknown[][] = [];
    const custom = function (this: Item[], ...args: unknown[]) {
      calls.push([this, ...args]);
      return { custom: true };
    };

    expect(createCompilerKeyedArrayBatchInsert(source, custom, -1, first, second)).toEqual({
      custom: true,
    });
    expect(calls).toEqual([[source, -1, 0, first, second]]);

    const error = new Error("custom batch failure");
    expect(() =>
      createCompilerKeyedArrayBatchInsert(
        source,
        () => {
          throw error;
        },
        0,
        first,
        second,
      ),
    ).toThrow(error);
  });

  it("inserts one fragment without reading or replacing existing rows", async () => {
    const initialItems = Array.from(
      { length: 4_096 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createBatchHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const before = container.querySelector('[data-key="row-2047"]');
    const after = container.querySelector('[data-key="row-2048"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;
    const incoming = Array.from(
      { length: 64 },
      (_, index): Item => ({ id: `insert-${index}`, label: `Insert ${index}` }),
    );

    await act(async () => {
      harness.insert(2_048, incoming);
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll("li")];
    expect(rows[2_047]).toBe(before);
    expect(rows[2_048]?.textContent).toBe("Insert 0");
    expect(rows[2_111]?.textContent).toBe("Insert 63");
    expect(rows[2_112]).toBe(after);
    expect(rows).toHaveLength(4_160);
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 64,
      descriptors: 64,
      bindings: 64,
    });
  });

  it("fully falls back before mutation for a key that collides with an existing row", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createBatchHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    harness.counters.keys = 0;

    await act(async () => {
      harness.insert(1, [
        { id: "b", label: "Beta duplicate" },
        { id: "d", label: "Delta" },
      ]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Alpha",
      "Beta duplicate",
      "Delta",
      "Beta",
      "Gamma",
    ]);
    expect(harness.counters.keys).toBeGreaterThan(2);
    expect(console.error).toHaveBeenCalled();
  });

  it("fully falls back for duplicate keys inside the incoming batch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createBatchHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    harness.counters.keys = 0;

    await act(async () => {
      harness.insert(1, [
        { id: "c", label: "Gamma one" },
        { id: "c", label: "Gamma two" },
      ]);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("AlphaGamma oneGamma twoBeta");
    expect(harness.counters.keys).toBeGreaterThan(2);
    expect(console.error).toHaveBeenCalled();
  });

  it("falls back when a spread produces fewer than two rows", async () => {
    const harness = createBatchHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    harness.counters.keys = 0;

    await act(async () => {
      harness.insert(1, [{ id: "c", label: "Gamma" }]);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("AlphaGammaBeta");
    expect(harness.counters.keys).toBeGreaterThan(1);
  });

  it("normalizes negative and oversized native positions", async () => {
    const harness = createBatchHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    harness.counters.keys = 0;

    await act(async () => {
      harness.insert(-1, [
        { id: "d", label: "Delta" },
        { id: "e", label: "Epsilon" },
      ]);
      await flushCompilerUpdates();
    });
    await act(async () => {
      harness.insert(100, [
        { id: "f", label: "Phi" },
        { id: "g", label: "Gamma two" },
      ]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Epsilon",
      "Gamma",
      "Phi",
      "Gamma two",
    ]);
    expect(harness.counters.keys).toBe(4);
    expect(harness.counters.executions).toBe(1);
  });

  it("preserves native custom-method behavior and rejects queued metadata", async () => {
    const harness = createBatchHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));

    await act(async () => {
      harness.customInsert(1, [
        { id: "c", label: "Gamma" },
        { id: "d", label: "Delta" },
      ]);
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Beta",
      "Delta",
      "Gamma",
      "Alpha",
    ]);

    await act(async () => {
      harness.queueTwo(
        [
          { id: "e", label: "Epsilon" },
          { id: "f", label: "Phi" },
        ],
        [
          { id: "g", label: "Gamma two" },
          { id: "h", label: "Eta" },
        ],
      );
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("BetaEpsilonGamma twoEtaPhiDeltaGammaAlpha");
  });

  it("preserves controlled-input focus and updates delegated suffix event indexes", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    const calls: string[] = [];
    let insert = () => undefined;
    const InteractiveRows = createCompiledComponentWithFeatures(
      {
        displayName: "BatchInteractiveRows",
        initialize: () => [initialItems],
        render(_props: Record<string, never>, state, blocks) {
          const items = () => state[0].get() as Item[];
          insert = () =>
            state[0].set((previous) =>
              hintedBatchInsert(previous as Item[], 1, [
                { id: "d", label: "Delta" },
                { id: "e", label: "Epsilon" },
              ]),
            );
          return (
            <main>
              <blocks.KeyedRows
                collectionDependency={0}
                delegateEvents
                dependencies={[0]}
                events={[
                  {
                    invoke: (item, index) => calls.push(`${(item as Item).id}:${index}`),
                    name: "onClick",
                    path: [1],
                  },
                ]}
                id={0}
                items={items}
                positionIndexIndependent
                structureDependencies={[0]}
                render={(event) => (
                  <ul>
                    {items().map((item, index) => (
                      <li data-key={item.id} key={item.id}>
                        <input aria-label={`Edit ${item.id}`} value={item.label} readOnly />
                        <button data-row-button={item.id} onClick={event(item, index, 0)}>
                          Select
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
                        tag: "input",
                        attributes: [
                          { name: "aria-label", value: `Edit ${row.id}` },
                          { name: "value", value: row.label },
                          { name: "readOnly", value: true },
                        ],
                        styles: [],
                        children: [],
                      },
                      {
                        kind: "element",
                        tag: "button",
                        attributes: [{ name: "data-row-button", value: row.id }],
                        styles: [],
                        children: ["Select"],
                      },
                    ],
                  };
                }}
                bindings={[]}
              />
            </main>
          );
        },
        bindings: [{ kind: "block", id: 0, dependencies: [0] }],
      },
      [keyedRowsBatchPositionHintedRuntimeFeature],
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<InteractiveRows />));
    const input = container.querySelector('[aria-label="Edit c"]') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(1, 3);

    await act(async () => {
      insert();
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[aria-label="Edit c"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);

    await act(async () => {
      (container.querySelector('[data-row-button="d"]') as HTMLButtonElement).click();
      (container.querySelector('[data-row-button="c"]') as HTMLButtonElement).click();
    });
    expect(calls).toEqual(["d:1", "c:4"]);
  });

  it("matches normal React through 1,000 deterministic batch insertions", async () => {
    const initialItems = Array.from(
      { length: 16 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createBatchHarness(initialItems);
    let updateReact: (position: number, incoming: readonly Item[]) => void = () => undefined;
    let removeReact: (position: number, count: number) => void = () => undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      updateReact = (position, incoming) =>
        setItems((previous) => [
          ...previous.slice(0, position),
          ...incoming,
          ...previous.slice(position),
        ]);
      removeReact = (position, count) =>
        setItems((previous) => [
          ...previous.slice(0, position),
          ...previous.slice(position + count),
        ]);
      return (
        <ol>
          {items.map((item) => (
            <li key={item.id}>{item.label}</li>
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
      reactRoot.render(<NormalTable />);
    });

    for (let step = 0; step < 1_000; step += 1) {
      const position = (step * 37) % (initialItems.length + 1);
      const incoming = Array.from(
        { length: (step % 5) + 2 },
        (_, offset): Item => ({
          id: `insert-${step}-${offset}`,
          label: `Insert ${step}.${offset}`,
        }),
      );
      await act(async () => {
        harness.insert(position, incoming);
        updateReact(position, incoming);
        await flushCompilerUpdates();
      });
      expect(compiledContainer.querySelector("ul")?.textContent).toBe(
        reactContainer.querySelector("ol")?.textContent,
      );
      await act(async () => {
        harness.remove(position, incoming.length);
        removeReact(position, incoming.length);
        await flushCompilerUpdates();
      });
      expect(compiledContainer.querySelector("ul")?.textContent).toBe(
        reactContainer.querySelector("ol")?.textContent,
      );
    }
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
  }, 15_000);

  it("hydrates in StrictMode and drops a queued batch after unmount", async () => {
    const harness = createBatchHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]);
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <StrictMode>
        <harness.Table />
      </StrictMode>,
    );
    document.body.append(container);
    const recoverable: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(
        container,
        <StrictMode>
          <harness.Table />
        </StrictMode>,
        { onRecoverableError: (error) => recoverable.push(error) },
      );
    });
    roots.push(root);

    await act(async () => {
      harness.insert(1, [
        { id: "c", label: "Gamma" },
        { id: "d", label: "Delta" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("AlphaGammaDeltaBeta");
    expect(recoverable).toEqual([]);

    roots.pop();
    act(() => {
      harness.insert(0, [
        { id: "e", label: "Epsilon" },
        { id: "f", label: "Phi" },
      ]);
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
