import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCompiledComponentWithFeatures,
  createCompilerKeyedArrayAppend,
  createCompilerKeyedArrayFilter,
  createCompilerKeyedArraySlice,
  createCompilerKeyedArrayStructuralAppend,
  keyedRowsStructuralAppendHintedRuntimeFeature,
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

function hintedAppend(previous: Item[], additions: readonly Item[]): unknown {
  return createCompilerKeyedArrayAppend(previous, [...previous, ...additions]);
}

function hintedStructuralAppend(previous: Item[], additions: readonly Item[]): unknown {
  return createCompilerKeyedArrayStructuralAppend(previous, [...previous, ...additions]);
}

function hintedFilter(previous: Item[], removed: ReadonlySet<string>): unknown {
  return createCompilerKeyedArrayFilter(
    previous,
    previous.filter,
    (item: Item) => !removed.has(item.id),
  );
}

function hintedSlice(previous: Item[], start: number, end: number): unknown {
  return createCompilerKeyedArraySlice(previous, previous.slice, start, end);
}

function rowDescriptor(item: Item, text = item.label): CompilerKeyedRowElement {
  return {
    kind: "element",
    tag: "li",
    attributes: [{ name: "data-key", value: item.id }],
    styles: [],
    children: [text],
  };
}

function createAppendHarness(
  initialItems: Item[],
  readsCollection = false,
  structuralAppend = false,
) {
  const counters: Counters = {
    executions: 0,
    listRenders: 0,
    keyReads: 0,
    descriptorReads: 0,
    bindingReads: 0,
  };
  let append: (additions: readonly Item[]) => void = () => undefined;
  let filterThenAppend: (removed: ReadonlySet<string>, additions: readonly Item[]) => void = () =>
    undefined;
  let sliceThenAppend: (start: number, end: number, additions: readonly Item[]) => void = () =>
    undefined;
  let plainThenAppend: (addition: Item) => void = () => undefined;
  const Inventory = createCompiledComponentWithFeatures(
    {
      displayName: "AppendInventory",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        counters.executions += 1;
        const items = () => state[0].get() as Item[];
        append = (additions) =>
          state[0].set((previous) =>
            structuralAppend
              ? hintedStructuralAppend(previous as Item[], additions)
              : hintedAppend(previous as Item[], additions),
          );
        filterThenAppend = (removed, additions) => {
          state[0].set((previous) => hintedFilter(previous as Item[], removed));
          state[0].set((previous) => hintedStructuralAppend(previous as Item[], additions));
        };
        sliceThenAppend = (start, end, additions) => {
          state[0].set((previous) => hintedSlice(previous as Item[], start, end));
          state[0].set((previous) => hintedStructuralAppend(previous as Item[], additions));
        };
        plainThenAppend = (addition) => {
          state[0].set((previous) => [...(previous as Item[])]);
          state[0].set((previous) => hintedAppend(previous as Item[], [addition]));
        };
        const text = (item: Item) =>
          readsCollection ? `${items().length}: ${item.label}` : item.label;
        return (
          <section>
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              filterIndexIndependent={!readsCollection}
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
                const row = item as Item;
                return rowDescriptor(row, text(row));
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
    },
    [keyedRowsStructuralAppendHintedRuntimeFeature],
  );
  return {
    Inventory,
    counters,
    append: (additions: readonly Item[]) => append(additions),
    filterThenAppend: (removed: ReadonlySet<string>, additions: readonly Item[]) =>
      filterThenAppend(removed, additions),
    sliceThenAppend: (start: number, end: number, additions: readonly Item[]) =>
      sliceThenAppend(start, end, additions),
    plainThenAppend: (addition: Item) => plainThenAppend(addition),
  };
}

describe("compiled keyed-array append hints", () => {
  it("creates only appended rows while preserving every existing DOM identity", async () => {
    const initialItems = Array.from(
      { length: 2_048 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createAppendHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));
    const first = container.querySelector('[data-key="row-0"]');
    const last = container.querySelector('[data-key="row-2047"]');
    harness.counters.keyReads = 0;
    harness.counters.descriptorReads = 0;
    harness.counters.bindingReads = 0;

    await act(async () => {
      harness.append([
        { id: "row-2048", label: "Row 2048" },
        { id: "row-2049", label: "Row 2049" },
      ]);
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="row-0"]')).toBe(first);
    expect(container.querySelector('[data-key="row-2047"]')).toBe(last);
    expect(container.querySelectorAll("li")).toHaveLength(2_050);
    expect(container.querySelector("li:last-child")?.textContent).toBe("Row 2049");
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.listRenders).toBe(1);
    expect(harness.counters.keyReads).toBe(2);
    expect(harness.counters.descriptorReads).toBe(2);
    expect(harness.counters.bindingReads).toBe(2);
  });

  it("composes queued append hints before one compiler flush", async () => {
    const harness = createAppendHarness([{ id: "a", label: "Alpha" }]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));
    harness.counters.keyReads = 0;

    await act(async () => {
      harness.append([{ id: "b", label: "Beta" }]);
      harness.append([
        { id: "c", label: "Gamma" },
        { id: "d", label: "Delta" },
      ]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
    ]);
    expect(harness.counters.keyReads).toBe(3);
  });

  it("removes rejected rows and creates only the appended suffix in one queued commit", async () => {
    const initialItems = Array.from(
      { length: 2_048 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createAppendHarness(initialItems, false, true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));
    const first = container.querySelector('[data-key="row-0"]');
    const last = container.querySelector('[data-key="row-2047"]');
    const removed = container.querySelector('[data-key="row-1024"]');
    harness.counters.keyReads = 0;
    harness.counters.descriptorReads = 0;
    harness.counters.bindingReads = 0;

    await act(async () => {
      harness.filterThenAppend(new Set(["row-1024"]), [{ id: "row-2048", label: "Row 2048" }]);
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="row-0"]')).toBe(first);
    expect(container.querySelector('[data-key="row-2047"]')).toBe(last);
    expect(container.querySelector('[data-key="row-1024"]')).toBeNull();
    expect(removed?.isConnected).toBe(false);
    expect(container.querySelectorAll("li")).toHaveLength(2_048);
    expect(container.querySelector("li:last-child")?.textContent).toBe("Row 2048");
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.listRenders).toBe(1);
    expect(harness.counters.descriptorReads).toBe(1);
    expect(harness.counters.bindingReads).toBe(1);
  });

  it("composes multiple queued appends after one structural update", async () => {
    const harness = createAppendHarness(
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
        { id: "d", label: "Delta" },
      ],
      false,
      true,
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));
    const alpha = container.querySelector('[data-key="a"]');
    const delta = container.querySelector('[data-key="d"]');
    harness.counters.descriptorReads = 0;
    harness.counters.bindingReads = 0;

    await act(async () => {
      harness.filterThenAppend(new Set(["b", "c"]), [{ id: "e", label: "Epsilon" }]);
      harness.append([{ id: "f", label: "Phi" }]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha",
      "Delta",
      "Epsilon",
      "Phi",
    ]);
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="d"]')).toBe(delta);
    expect(harness.counters.descriptorReads).toBe(2);
    expect(harness.counters.bindingReads).toBe(2);
  });

  it("retains a sliced interval before appending a fresh suffix", async () => {
    const harness = createAppendHarness(
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
        { id: "d", label: "Delta" },
      ],
      false,
      true,
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));
    const beta = container.querySelector('[data-key="b"]');
    const gamma = container.querySelector('[data-key="c"]');
    harness.counters.keyReads = 0;
    harness.counters.descriptorReads = 0;
    harness.counters.bindingReads = 0;

    await act(async () => {
      harness.sliceThenAppend(1, 3, [{ id: "e", label: "Epsilon" }]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Beta",
      "Gamma",
      "Epsilon",
    ]);
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(harness.counters.keyReads).toBe(1);
    expect(harness.counters.descriptorReads).toBe(1);
    expect(harness.counters.bindingReads).toBe(1);
  });

  it("preserves focus and selection on a surviving controlled input", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    let replaceFirst: () => void = () => undefined;
    const Inventory = createCompiledComponentWithFeatures(
      {
        displayName: "StructuralAppendForm",
        initialize: () => [initialItems],
        render(_props: Record<string, never>, state, blocks) {
          const items = () => state[0].get() as Item[];
          replaceFirst = () => {
            state[0].set((previous) => hintedFilter(previous as Item[], new Set(["a"])));
            state[0].set((previous) =>
              hintedStructuralAppend(previous as Item[], [{ id: "d", label: "Delta" }]),
            );
          };
          return (
            <section>
              <blocks.KeyedRows
                collectionDependency={0}
                dependencies={[0]}
                filterIndexIndependent
                id={0}
                items={items}
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
      },
      [keyedRowsStructuralAppendHintedRuntimeFeature],
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Inventory />));
    const beta = container.querySelector('[data-key="b"]') as HTMLInputElement;
    beta.focus();
    beta.setSelectionRange(1, 3);

    await act(async () => {
      replaceFirst();
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(document.activeElement).toBe(beta);
    expect([beta.selectionStart, beta.selectionEnd]).toEqual([1, 3]);
    expect([...container.querySelectorAll("input")].map((input) => input.value)).toEqual([
      "Beta",
      "Gamma",
      "Delta",
    ]);
  });

  it("unmounts cleanly after a nested structural append", async () => {
    const harness = createAppendHarness(
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ],
      false,
      true,
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <main>
          <harness.Inventory />
        </main>,
      ),
    );

    await act(async () => {
      harness.filterThenAppend(new Set(["a"]), [{ id: "d", label: "Delta" }]);
      await flushCompilerUpdates();
    });

    roots.pop();
    await expect(
      act(async () => {
        root.unmount();
      }),
    ).resolves.toBeUndefined();
    expect(container.innerHTML).toBe("");
  });

  it("falls back before reusing a key removed earlier in the queued chain", async () => {
    const harness = createAppendHarness(
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ],
      false,
      true,
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));
    const beta = container.querySelector('[data-key="b"]');
    harness.counters.bindingReads = 0;

    await act(async () => {
      harness.filterThenAppend(new Set(["b"]), [{ id: "b", label: "Beta moved" }]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha",
      "Gamma",
      "Beta moved",
    ]);
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(harness.counters.bindingReads).toBe(3);
  });

  it("rejects a hint chained after an unhinted update in the same flush", async () => {
    const harness = createAppendHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));
    harness.counters.keyReads = 0;

    await act(async () => {
      harness.plainThenAppend({ id: "c", label: "Gamma" });
      await flushCompilerUpdates();
    });

    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(harness.counters.keyReads).toBe(3);
  });

  it("keeps custom iterators and revoked proxies on behavior-preserving fallback", async () => {
    const initialItems: Item[] = [{ id: "a", label: "Alpha" }];
    const harness = createAppendHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));
    Object.defineProperty(initialItems, Symbol.iterator, {
      configurable: true,
      value: function* () {
        yield { id: "x", label: "Iterator row" };
      },
    });

    await act(async () => {
      harness.append([{ id: "b", label: "Beta" }]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Iterator row",
      "Beta",
    ]);

    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    const next: Item[] = [{ id: "safe", label: "Safe" }];
    expect(() => createCompilerKeyedArrayAppend(proxy, next)).not.toThrow();
    expect(createCompilerKeyedArrayAppend(proxy, next)).toBe(next);
    expect(() => createCompilerKeyedArrayStructuralAppend(proxy, next)).not.toThrow();
    expect(createCompilerKeyedArrayStructuralAppend(proxy, next)).toBe(next);
  });

  it("keeps complete reconciliation when existing rows read collection state", async () => {
    const harness = createAppendHarness(
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ],
      true,
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Inventory />));
    harness.counters.keyReads = 0;

    await act(async () => {
      harness.append([{ id: "c", label: "Gamma" }]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "3: Alpha",
      "3: Beta",
      "3: Gamma",
    ]);
    expect(harness.counters.keyReads).toBe(3);

    harness.counters.keyReads = 0;
    await act(async () => {
      harness.filterThenAppend(new Set(["b"]), [{ id: "d", label: "Delta" }]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "3: Alpha",
      "3: Gamma",
      "3: Delta",
    ]);
    expect(harness.counters.keyReads).toBe(3);
  });

  it("shares one append hint across multiple keyed boundaries", async () => {
    const initialItems: Item[] = [{ id: "a", label: "Alpha" }];
    let append: () => void = () => undefined;
    let filterThenAppend: () => void = () => undefined;
    let keyReads = 0;
    const Inventory = createCompiledComponentWithFeatures(
      {
        displayName: "SharedAppendInventory",
        initialize: () => [initialItems],
        render(_props: Record<string, never>, state, blocks) {
          const items = () => state[0].get() as Item[];
          append = () =>
            state[0].set((previous) =>
              hintedAppend(previous as Item[], [{ id: "b", label: "Beta" }]),
            );
          filterThenAppend = () => {
            state[0].set((previous) => hintedFilter(previous as Item[], new Set(["a"])));
            state[0].set((previous) =>
              hintedStructuralAppend(previous as Item[], [{ id: "c", label: "Gamma" }]),
            );
          };
          const list = (id: number, owner: string) => (
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              filterIndexIndependent
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
              create={(item) => rowDescriptor(item as Item)}
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
      },
      [keyedRowsStructuralAppendHintedRuntimeFeature],
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Inventory />));
    keyReads = 0;

    await act(async () => {
      append();
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-owner="first"]')?.textContent).toBe("AlphaBeta");
    expect(container.querySelector('[data-owner="second"]')?.textContent).toBe("AlphaBeta");
    expect(keyReads).toBe(2);

    keyReads = 0;
    await act(async () => {
      filterThenAppend();
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-owner="first"]')?.textContent).toBe("BetaGamma");
    expect(container.querySelector('[data-owner="second"]')?.textContent).toBe("BetaGamma");
    expect(keyReads).toBe(4);
  });

  it("matches React through 2,000 deterministic appends", async () => {
    const initialItems: Item[] = [{ id: "seed", label: "Seed" }];
    const harness = createAppendHarness(initialItems);
    let appendReact: (item: Item) => void = () => undefined;
    function Normal() {
      const [items, setItems] = useState(initialItems);
      appendReact = (item) => setItems((previous) => [...previous, item]);
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

    let random = 0x12345678;
    for (let batch = 0; batch < 100; batch += 1) {
      await act(async () => {
        for (let update = 0; update < 20; update += 1) {
          random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
          const item = { id: `row-${batch}-${update}`, label: `Value ${random % 10_000}` };
          harness.append([item]);
          appendReact(item);
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

  it("matches React across 2,000 randomized queued structural removals and appends", async () => {
    const initialItems = Array.from(
      { length: 1_001 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createAppendHarness(initialItems, false, true);
    let updateReact: (
      kind: "filter" | "slice",
      removed: ReadonlySet<string>,
      additions: readonly Item[],
    ) => void = () => undefined;
    function Normal() {
      const [items, setItems] = useState(initialItems);
      updateReact = (kind, removed, additions) => {
        setItems((previous) =>
          kind === "slice"
            ? previous.slice(0, previous.length - removed.size)
            : previous.filter((item) => !removed.has(item.id)),
        );
        setItems((previous) => [...previous, ...additions]);
      };
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
    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = createRoot(compiledContainer);
    const reactRoot = createRoot(reactContainer);
    roots.push(compiledRoot, reactRoot);
    await act(async () => {
      compiledRoot.render(<harness.Inventory />);
      reactRoot.render(<Normal />);
    });
    const stableRow = compiledContainer.querySelector('[data-key="row-0"]');
    let active = initialItems.map((item) => item.id);
    let seed = 0x9e3779b9;
    let nextId = initialItems.length;

    for (let batch = 0; batch < 200; batch += 1) {
      const kind = batch % 2 === 0 ? "filter" : "slice";
      const removed = new Set<string>();
      if (kind === "slice") {
        for (const id of active.slice(-5)) removed.add(id);
      } else {
        const removable = active.slice(1);
        while (removed.size < 5) {
          seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
          removed.add(removable[seed % removable.length]);
        }
      }
      const additions = Array.from({ length: 5 }, () => {
        const id = `row-${nextId++}`;
        return { id, label: `Queued ${id}` };
      });
      await act(async () => {
        if (kind === "slice") {
          harness.sliceThenAppend(0, active.length - removed.size, additions);
        } else {
          harness.filterThenAppend(removed, additions);
        }
        updateReact(kind, removed, additions);
        await flushCompilerUpdates();
      });
      expect([...compiledContainer.querySelectorAll("li")].map((row) => row.outerHTML)).toEqual(
        [...reactContainer.querySelectorAll("li")].map((row) => row.outerHTML),
      );
      active =
        kind === "slice"
          ? active.slice(0, active.length - removed.size)
          : active.filter((id) => !removed.has(id));
      active.push(...additions.map((item) => item.id));
    }

    expect(compiledContainer.querySelector('[data-key="row-0"]')).toBe(stableRow);
    expect(harness.counters.executions).toBe(1);
  }, 20_000);

  it("hydrates in StrictMode and drops a queued append after unmount", async () => {
    const harness = createAppendHarness([{ id: "a", label: "Alpha" }], false, true);
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
      harness.append([{ id: "b", label: "Beta" }]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("AlphaBeta");
    expect(recoverable).toEqual([]);

    await act(async () => {
      harness.filterThenAppend(new Set(["a"]), [{ id: "c", label: "Gamma" }]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("BetaGamma");

    roots.pop();
    act(() => {
      harness.filterThenAppend(new Set(["b"]), [{ id: "d", label: "Delta" }]);
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
