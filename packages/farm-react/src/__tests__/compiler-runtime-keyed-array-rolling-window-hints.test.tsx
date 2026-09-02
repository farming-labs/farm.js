import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCompiledComponent,
  createCompilerKeyedArrayRollingWindow,
  createCompilerKeyedArraySlice,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
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

function hintedRoll(previous: Item[], remove: number, incoming: readonly Item[]): Item[] {
  const retained = createCompilerKeyedArraySlice(previous, previous.slice, remove) as Item[];
  return createCompilerKeyedArrayRollingWindow(previous, retained, [
    ...retained,
    ...incoming,
  ]) as Item[];
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

function createRollingHarness(initialItems: Item[], readsCollection = false) {
  const counters = { executions: 0, renders: 0, keys: 0, descriptors: 0, bindings: 0 };
  let roll: (remove: number, incoming: readonly Item[]) => void = () => undefined;
  let customRoll: (incoming: Item) => void = () => undefined;
  const Feed = createCompiledComponent({
    displayName: "RollingFeed",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      roll = (remove, incoming) =>
        state[0].set((previous) => hintedRoll(previous as Item[], remove, incoming));
      customRoll = (incoming) =>
        state[0].set((previous) => {
          const source = previous as Item[];
          const method = function (this: Item[]) {
            return Array.prototype.slice.call(this, 1).reverse();
          };
          const retained = createCompilerKeyedArraySlice(source, method, 1) as Item[];
          return createCompilerKeyedArrayRollingWindow(source, retained, [
            ...retained,
            incoming,
          ]) as Item[];
        });
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
              const row = item as Item;
              return rowDescriptor(row, text(row));
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
    Feed,
    counters,
    customRoll: (incoming: Item) => customRoll(incoming),
    roll: (remove: number, incoming: readonly Item[]) => roll(remove, incoming),
  };
}

describe("compiled keyed-array rolling-window hints", () => {
  it("removes only the expired prefix and creates only incoming rows", async () => {
    const initialItems = Array.from(
      { length: 2_048 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createRollingHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    const survivor = container.querySelector('[data-key="row-1024"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.roll(2, [
        { id: "row-2048", label: "Row 2048" },
        { id: "row-2049", label: "Row 2049" },
      ]);
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="row-0"]')).toBeNull();
    expect(container.querySelector('[data-key="row-1"]')).toBeNull();
    expect(container.querySelector('[data-key="row-1024"]')).toBe(survivor);
    expect(container.querySelectorAll("li")).toHaveLength(2_048);
    expect(container.querySelector("li:last-child")?.textContent).toBe("Row 2049");
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(2);
    expect(harness.counters.descriptors).toBe(2);
    expect(harness.counters.bindings).toBe(2);
  });

  it("falls back when an incoming row reuses a committed key", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    const harness = createRollingHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    const alpha = container.querySelector('[data-key="a"]');

    await act(async () => {
      harness.roll(1, [initialItems[0]]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Beta",
      "Gamma",
      "Alpha",
    ]);
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
  });

  it("falls back for custom slice semantics and collection-dependent bindings", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    const custom = createRollingHarness(initialItems);
    const customContainer = document.createElement("div");
    document.body.append(customContainer);
    const customRoot = createRoot(customContainer);
    roots.push(customRoot);
    await act(async () => customRoot.render(<custom.Feed />));
    await act(async () => {
      custom.customRoll({ id: "d", label: "Delta" });
      await flushCompilerUpdates();
    });
    expect([...customContainer.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Gamma",
      "Beta",
      "Delta",
    ]);

    const dependent = createRollingHarness(initialItems, true);
    const dependentContainer = document.createElement("div");
    document.body.append(dependentContainer);
    const dependentRoot = createRoot(dependentContainer);
    roots.push(dependentRoot);
    await act(async () => dependentRoot.render(<dependent.Feed />));
    await act(async () => {
      dependent.roll(1, [
        { id: "d", label: "Delta" },
        { id: "e", label: "Epsilon" },
      ]);
      await flushCompilerUpdates();
    });
    expect([...dependentContainer.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "4: Beta",
      "4: Gamma",
      "4: Delta",
      "4: Epsilon",
    ]);
  });

  it("keeps native results on complete reconciliation for unsafe runtime bounds", async () => {
    const harness = createRollingHarness(
      ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    const b = container.querySelector('[data-key="b"]');

    harness.counters.keys = 0;
    await act(async () => {
      harness.roll(1.5, [{ id: "e", label: "E" }]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("BCDE");
    expect(container.querySelector('[data-key="b"]')).toBe(b);
    expect(harness.counters.keys).toBeGreaterThan(1);

    harness.counters.keys = 0;
    await act(async () => {
      harness.roll(Number.NaN, [{ id: "f", label: "F" }]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("BCDEF");
    expect(container.querySelector('[data-key="b"]')).toBe(b);
    expect(harness.counters.keys).toBeGreaterThan(1);

    harness.counters.keys = 0;
    await act(async () => {
      harness.roll(0, [{ id: "g", label: "G" }]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("BCDEFG");
    expect(container.querySelector('[data-key="b"]')).toBe(b);
    expect(harness.counters.keys).toBeGreaterThan(1);
    expect(harness.counters.executions).toBe(1);
  });

  it("matches normal React through 250 committed rolling updates", async () => {
    const initialItems = Array.from(
      { length: 32 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createRollingHarness(initialItems);
    let rollReact: (incoming: Item) => void = () => undefined;
    function NormalFeed() {
      const [items, setItems] = useState(initialItems);
      rollReact = (incoming) => setItems((previous) => [...previous.slice(1), incoming]);
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
      compiledRoot.render(<harness.Feed />);
      reactRoot.render(<NormalFeed />);
    });

    for (let index = 32; index < 282; index += 1) {
      const incoming = { id: `row-${index}`, label: `Row ${index}` };
      await act(async () => {
        harness.roll(1, [incoming]);
        rollReact(incoming);
        await flushCompilerUpdates();
      });
    }

    expect(compiledContainer.querySelector("ul")?.textContent).toBe(
      reactContainer.querySelector("ol")?.textContent,
    );
    expect(compiledContainer.querySelectorAll("li")).toHaveLength(32);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
  });

  it("matches React through 1,000 randomized runtime-bound rolling updates", async () => {
    const initialItems = Array.from(
      { length: 48 },
      (_, index): Item => ({ id: `random-row-${index}`, label: `Random row ${index}` }),
    );
    const harness = createRollingHarness(initialItems);
    let rollReact: (remove: number, incoming: readonly Item[]) => void = () => undefined;
    let seed = 0x7011;
    let nextId = initialItems.length;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed;
    };
    function NormalFeed() {
      const [items, setItems] = useState(initialItems);
      rollReact = (remove, incoming) =>
        setItems((previous) => [...previous.slice(remove), ...incoming]);
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
      compiledRoot.render(<harness.Feed />);
      reactRoot.render(<NormalFeed />);
    });
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;
    let incomingCount = 0;

    for (let update = 0; update < 1_000; update += 1) {
      const remove = 1 + (random() % 4);
      const incoming = Array.from({ length: remove }, (): Item => {
        const id = nextId++;
        return { id: `random-row-${id}`, label: `Random row ${id}` };
      });
      incomingCount += incoming.length;
      await act(async () => {
        harness.roll(remove, incoming);
        rollReact(remove, incoming);
        await flushCompilerUpdates();
      });
      if (update % 25 === 0) {
        expect(compiledContainer.textContent).toBe(reactContainer.textContent);
      }
    }

    expect(compiledContainer.textContent).toBe(reactContainer.textContent);
    expect(compiledContainer.querySelectorAll("li")).toHaveLength(initialItems.length);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(incomingCount);
    expect(harness.counters.descriptors).toBe(incomingCount);
    expect(harness.counters.bindings).toBe(incomingCount);
  }, 20_000);

  it("hydrates in StrictMode and drops a queued rolling update after unmount", async () => {
    const harness = createRollingHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]);
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <StrictMode>
        <harness.Feed />
      </StrictMode>,
    );
    document.body.append(container);
    const recoverable: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(
        container,
        <StrictMode>
          <harness.Feed />
        </StrictMode>,
        { onRecoverableError: (error) => recoverable.push(error) },
      );
    });
    roots.push(root);

    await act(async () => {
      harness.roll(1, [{ id: "c", label: "Gamma" }]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("BetaGamma");
    expect(recoverable).toEqual([]);

    roots.pop();
    act(() => {
      harness.roll(1, [{ id: "d", label: "Delta" }]);
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
