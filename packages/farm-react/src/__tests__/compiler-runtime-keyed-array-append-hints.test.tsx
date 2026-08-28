import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCompiledComponent,
  createCompilerKeyedArrayAppend,
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

function rowDescriptor(item: Item, text = item.label): CompilerKeyedRowElement {
  return {
    kind: "element",
    tag: "li",
    attributes: [{ name: "data-key", value: item.id }],
    styles: [],
    children: [text],
  };
}

function createAppendHarness(initialItems: Item[], readsCollection = false) {
  const counters: Counters = {
    executions: 0,
    listRenders: 0,
    keyReads: 0,
    descriptorReads: 0,
    bindingReads: 0,
  };
  let append: (additions: readonly Item[]) => void = () => undefined;
  let plainThenAppend: (addition: Item) => void = () => undefined;
  const Inventory = createCompiledComponent({
    displayName: "AppendInventory",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      append = (additions) =>
        state[0].set((previous) => hintedAppend(previous as Item[], additions));
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
  });
  return {
    Inventory,
    counters,
    append: (additions: readonly Item[]) => append(additions),
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
  });

  it("shares one append hint across multiple keyed boundaries", async () => {
    const initialItems: Item[] = [{ id: "a", label: "Alpha" }];
    let append: () => void = () => undefined;
    let keyReads = 0;
    const Inventory = createCompiledComponent({
      displayName: "SharedAppendInventory",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        append = () =>
          state[0].set((previous) =>
            hintedAppend(previous as Item[], [{ id: "b", label: "Beta" }]),
          );
        const list = (id: number, owner: string) => (
          <blocks.KeyedRows
            collectionDependency={0}
            dependencies={[0]}
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
    });
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
  });

  it("hydrates in StrictMode and drops a queued append after unmount", async () => {
    const harness = createAppendHarness([{ id: "a", label: "Alpha" }]);
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

    roots.pop();
    act(() => {
      harness.append([{ id: "c", label: "Gamma" }]);
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
