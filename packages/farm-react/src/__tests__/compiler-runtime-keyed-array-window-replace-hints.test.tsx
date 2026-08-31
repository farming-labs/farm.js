import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponentWithFeatures,
  createCompilerKeyedArrayWindowReplace,
  keyedRowsWindowPositionHintedRuntimeFeature,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
}

type WindowArray = Item[] & {
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

function hintedWindowReplace(
  previous: Item[],
  position: number,
  deleteCount: number,
  items: readonly Item[],
): Item[] {
  const source = previous as WindowArray;
  return createCompilerKeyedArrayWindowReplace(
    source,
    source.toSpliced,
    position,
    deleteCount,
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

function createWindowHarness(initialItems: Item[]) {
  const counters = { executions: 0, renders: 0, keys: 0, descriptors: 0, bindings: 0 };
  let bindingFailure: string | undefined;
  let bindingTrace: string[] | undefined;
  let replace: (position: number, deleteCount: number, items: readonly Item[]) => void = () =>
    undefined;
  let queueTwo: (first: readonly Item[], second: readonly Item[]) => void = () => undefined;
  let customReplace: (items: readonly Item[]) => void = () => undefined;
  const Table = createCompiledComponentWithFeatures(
    {
      displayName: "WindowReplaceTable",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        counters.executions += 1;
        const items = () => state[0].get() as Item[];
        replace = (position, deleteCount, incoming) =>
          state[0].set((previous) =>
            hintedWindowReplace(previous as Item[], position, deleteCount, incoming),
          );
        queueTwo = (first, second) => {
          state[0].set((previous) => hintedWindowReplace(previous as Item[], 1, 2, first));
          state[0].set((previous) => hintedWindowReplace(previous as Item[], 2, 1, second));
        };
        customReplace = (incoming) =>
          state[0].set((previous) => {
            const source = previous as Item[];
            const method = function (this: Item[], start: number, remove: number, ...next: Item[]) {
              return [...this.slice(0, start), ...next, ...this.slice(start + remove)].reverse();
            };
            return createCompilerKeyedArrayWindowReplace(source, method, 1, 2, ...incoming);
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
                    const row = item as Item;
                    bindingTrace?.push(`read:${row.id}`);
                    if (bindingFailure === row.id) {
                      bindingFailure = undefined;
                      throw new Error(`binding failure for ${row.id}`);
                    }
                    return [row.label];
                  },
                },
              ]}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    },
    [keyedRowsWindowPositionHintedRuntimeFeature],
  );
  return {
    Table,
    counters,
    customReplace: (items: readonly Item[]) => customReplace(items),
    failNextBindingFor: (key: string) => {
      bindingFailure = key;
    },
    queueTwo: (first: readonly Item[], second: readonly Item[]) => queueTwo(first, second),
    replace: (position: number, deleteCount: number, items: readonly Item[]) =>
      replace(position, deleteCount, items),
    traceBindings: (trace: string[] | undefined) => {
      bindingTrace = trace;
    },
  };
}

describe("compiled keyed-array window replacement hints", () => {
  it("preserves native method arguments, return values, and errors", () => {
    const source = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    const first = { id: "c", label: "Gamma" };
    const second = { id: "d", label: "Delta" };
    const calls: unknown[][] = [];
    const custom = function (this: Item[], ...args: unknown[]) {
      calls.push([this, ...args]);
      return { custom: true };
    };

    expect(createCompilerKeyedArrayWindowReplace(source, custom, -1, 9, first, second)).toEqual({
      custom: true,
    });
    expect(calls).toEqual([[source, -1, 9, first, second]]);

    const error = new Error("custom window failure");
    expect(() =>
      createCompilerKeyedArrayWindowReplace(
        source,
        () => {
          throw error;
        },
        0,
        1,
        first,
      ),
    ).toThrow(error);
  });

  it("replaces one exact window without reading or replacing retained rows", async () => {
    const initialItems = Array.from(
      { length: 4_096 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const before = container.querySelector('[data-key="row-2047"]');
    const firstRemoved = container.querySelector('[data-key="row-2048"]');
    const lastRemoved = container.querySelector('[data-key="row-2111"]');
    const after = container.querySelector('[data-key="row-2112"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;
    const incoming = Array.from(
      { length: 64 },
      (_, index): Item => ({ id: `replace-${index}`, label: `Replace ${index}` }),
    );

    await act(async () => {
      harness.replace(2_048, 64, incoming);
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll("li")];
    expect(rows[2_047]).toBe(before);
    expect(rows[2_048]?.textContent).toBe("Replace 0");
    expect(rows[2_111]?.textContent).toBe("Replace 63");
    expect(rows[2_112]).toBe(after);
    expect(firstRemoved?.isConnected).toBe(false);
    expect(lastRemoved?.isConnected).toBe(false);
    expect(rows).toHaveLength(4_096);
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 64,
      descriptors: 64,
      bindings: 64,
    });
  });

  it("refreshes a same-key exact window without descriptors or DOM replacement", async () => {
    const initialItems = Array.from(
      { length: 4_096 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const before = container.querySelector('[data-key="row-2047"]');
    const refreshed = Array.from({ length: 64 }, (_, offset) =>
      container.querySelector(`[data-key="row-${2_048 + offset}"]`),
    );
    const after = container.querySelector('[data-key="row-2112"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;
    const incoming = initialItems.slice(2_048, 2_112).map((item, index) => ({
      ...item,
      label: `Refreshed ${index}`,
    }));

    await act(async () => {
      harness.replace(2_048, 64, incoming);
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll("li")];
    expect(rows[2_047]).toBe(before);
    for (let offset = 0; offset < 64; offset += 1) {
      expect(rows[2_048 + offset]).toBe(refreshed[offset]);
      expect(rows[2_048 + offset]?.textContent).toBe(`Refreshed ${offset}`);
    }
    expect(rows[2_112]).toBe(after);
    expect(rows).toHaveLength(4_096);
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 64,
      descriptors: 0,
      bindings: 64,
    });
  });

  it("prepares the complete same-key window before committing any binding", async () => {
    const harness = createWindowHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const trace: string[] = [];
    const textContent = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    vi.spyOn(Node.prototype, "textContent", "set").mockImplementation(function (
      this: Node,
      value: string | null,
    ) {
      trace.push(`write:${value}`);
      textContent.set!.call(this, value);
    });
    harness.traceBindings(trace);
    harness.failNextBindingFor("b");

    await act(async () => {
      harness.replace(0, 3, [
        { id: "a", label: "Alpha refreshed" },
        { id: "b", label: "Beta refreshed" },
        { id: "c", label: "Gamma refreshed" },
      ]);
      await flushCompilerUpdates();
    });

    const failedRead = trace.indexOf("read:b");
    const firstWrite = trace.findIndex((entry) => entry.startsWith("write:"));
    expect(failedRead).toBeGreaterThanOrEqual(0);
    expect(firstWrite === -1 || firstWrite > failedRead).toBe(true);
    expect(container.textContent).toBe("Alpha refreshedBeta refreshedGamma refreshed");
  });

  it("supports empty incoming spreads, negative positions, and clamped delete counts", async () => {
    const harness = createWindowHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
      { id: "e", label: "Epsilon" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const alpha = container.querySelector('[data-key="a"]');
    const beta = container.querySelector('[data-key="b"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.replace(-3, 99, []);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("AlphaBeta");
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(harness.counters.keys).toBe(0);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(0);
  });

  it("takes complete reconciliation for reordered, mixed, or duplicate reused keys", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createWindowHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const gamma = container.querySelector('[data-key="c"]');
    harness.counters.keys = 0;

    await act(async () => {
      harness.replace(1, 2, [
        { id: "c", label: "Gamma retained" },
        { id: "e", label: "Epsilon" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(gamma?.textContent).toBe("Gamma retained");
    expect(harness.counters.keys).toBeGreaterThan(2);

    harness.counters.keys = 0;
    await act(async () => {
      harness.replace(1, 2, [
        { id: "f", label: "Phi one" },
        { id: "f", label: "Phi two" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("AlphaPhi onePhi twoDelta");
    expect(harness.counters.keys).toBeGreaterThan(2);
    expect(console.error).toHaveBeenCalled();
  });

  it("falls back for custom methods and two queued window updates", async () => {
    const harness = createWindowHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));

    await act(async () => {
      harness.customReplace([
        { id: "e", label: "Epsilon" },
        { id: "f", label: "Phi" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("DeltaPhiEpsilonAlpha");

    await act(async () => {
      harness.queueTwo(
        [
          { id: "g", label: "Gamma two" },
          { id: "h", label: "Eta" },
        ],
        [
          { id: "i", label: "Iota" },
          { id: "j", label: "Jota" },
        ],
      );
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("DeltaGamma twoIotaJotaAlpha");
  });

  it("preserves controlled-input focus and delegated indexes across the window", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ];
    const calls: string[] = [];
    let replace = () => undefined;
    let refresh = () => undefined;
    const InteractiveRows = createCompiledComponentWithFeatures(
      {
        displayName: "WindowInteractiveRows",
        initialize: () => [initialItems],
        render(_props: Record<string, never>, state, blocks) {
          const items = () => state[0].get() as Item[];
          replace = () =>
            state[0].set((previous) =>
              hintedWindowReplace(previous as Item[], 1, 2, [{ id: "e", label: "Epsilon" }]),
            );
          refresh = () =>
            state[0].set((previous) =>
              hintedWindowReplace(previous as Item[], 1, 2, [
                { id: "e", label: "Epsilon refreshed" },
                { id: "d", label: "Delta refreshed" },
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
                    invoke: (item, index) =>
                      calls.push(`${(item as Item).id}:${(item as Item).label}:${index}`),
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
                          Select {item.label}
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
                        children: [`Select ${row.label}`],
                      },
                    ],
                  };
                }}
                bindings={[
                  {
                    kind: "attribute",
                    name: "value",
                    path: [0],
                    read: (item) => (item as Item).label,
                  },
                  {
                    kind: "text",
                    path: [1],
                    read: (item) => ["Select ", (item as Item).label],
                  },
                ]}
              />
            </main>
          );
        },
        bindings: [{ kind: "block", id: 0, dependencies: [0] }],
      },
      [keyedRowsWindowPositionHintedRuntimeFeature],
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<InteractiveRows />));
    const input = container.querySelector('[aria-label="Edit d"]') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(1, 3);

    await act(async () => {
      replace();
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[aria-label="Edit d"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
    const epsilonRow = container.querySelector('[data-key="e"]');
    const deltaRow = container.querySelector('[data-key="d"]');

    await act(async () => {
      refresh();
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="e"]')).toBe(epsilonRow);
    expect(container.querySelector('[data-key="d"]')).toBe(deltaRow);
    expect(container.querySelector('[aria-label="Edit d"]')).toBe(input);
    expect(input.value).toBe("Delta refreshed");
    expect(container.querySelector('[data-row-button="e"]')?.textContent).toBe(
      "Select Epsilon refreshed",
    );
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);

    await act(async () => {
      (container.querySelector('[data-row-button="e"]') as HTMLButtonElement).click();
      (container.querySelector('[data-row-button="d"]') as HTMLButtonElement).click();
    });
    expect(calls).toEqual(["e:Epsilon refreshed:1", "d:Delta refreshed:2"]);
  });

  it("matches normal React through 1,000 deterministic bounded replacements", async () => {
    const initialItems = Array.from(
      { length: 24 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    let replaceReact: (position: number, count: number, incoming: readonly Item[]) => void = () =>
      undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      replaceReact = (position, count, incoming) =>
        setItems((previous) => (previous as WindowArray).toSpliced(position, count, ...incoming));
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

    // Each cycle performs and verifies two replacements. Even cycles refresh
    // the same keys in place; odd cycles replace fresh keys. Their matching
    // restorations exercise both paths again for 1,000 differential updates.
    for (let step = 0; step < 500; step += 1) {
      const count = (step % 5) + 1;
      const position = (step * 37) % (initialItems.length - count + 1);
      const incoming =
        step % 2 === 0
          ? initialItems.slice(position, position + count).map((item, offset) => ({
              ...item,
              label: `Refresh ${step}.${offset}`,
            }))
          : Array.from(
              { length: (step % 4) + 1 },
              (_, offset): Item => ({
                id: `replace-${step}-${offset}`,
                label: `Replace ${step}.${offset}`,
              }),
            );
      const removed = initialItems.slice(position, position + count);
      await act(async () => {
        harness.replace(position, count, incoming);
        replaceReact(position, count, incoming);
        await flushCompilerUpdates();
      });
      expect(compiledContainer.querySelector("ul")?.textContent).toBe(
        reactContainer.querySelector("ol")?.textContent,
      );
      await act(async () => {
        harness.replace(position, incoming.length, removed);
        replaceReact(position, incoming.length, removed);
        await flushCompilerUpdates();
      });
      expect(compiledContainer.querySelector("ul")?.textContent).toBe(
        reactContainer.querySelector("ol")?.textContent,
      );
    }
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
  }, 15_000);

  it("hydrates in StrictMode and drops a queued replacement after unmount", async () => {
    const harness = createWindowHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
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
    const beta = container.querySelector('[data-key="b"]');
    const gamma = container.querySelector('[data-key="c"]');

    await act(async () => {
      harness.replace(1, 2, [
        { id: "b", label: "Beta hydrated" },
        { id: "c", label: "Gamma hydrated" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("AlphaBeta hydratedGamma hydrated");
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(recoverable).toEqual([]);

    roots.pop();
    act(() => {
      harness.replace(0, 2, [{ id: "f", label: "Phi" }]);
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
