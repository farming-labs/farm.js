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

  it("composes queued rolling windows and creates only the final incoming suffix", async () => {
    const initialItems = ["a", "b", "c", "d"].map((id) => ({
      id,
      label: id.toUpperCase(),
    }));
    const harness = createRollingHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    const survivor = container.querySelector('[data-key="c"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.roll(1, [{ id: "e", label: "E" }]);
      harness.roll(1, [{ id: "f", label: "F" }]);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("CDEF");
    expect(container.querySelector('[data-key="c"]')).toBe(survivor);
    expect(harness.counters.keys).toBe(2);
    expect(harness.counters.descriptors).toBe(2);
    expect(harness.counters.bindings).toBe(2);
  });

  it("collapses queued grow and shrink rolls after all committed rows expire", async () => {
    const initialItems = ["a", "b", "c", "d"].map((id) => ({
      id,
      label: id.toUpperCase(),
    }));
    const harness = createRollingHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.roll(3, [
        { id: "e", label: "E" },
        { id: "f", label: "F" },
        { id: "g", label: "G" },
      ]);
      harness.roll(2, [{ id: "h", label: "H" }]);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("FGH");
    expect(container.querySelector('[data-key="a"]')).toBeNull();
    expect(container.querySelector('[data-key="d"]')).toBeNull();
    expect(harness.counters.keys).toBe(3);
    expect(harness.counters.descriptors).toBe(3);
    expect(harness.counters.bindings).toBe(3);
  });

  it("validates final queued keys against the committed window", async () => {
    const initialItems = ["a", "b", "c", "d"].map((id) => ({
      id,
      label: id.toUpperCase(),
    }));
    const reused = createRollingHarness(initialItems);
    const reusedContainer = document.createElement("div");
    document.body.append(reusedContainer);
    const reusedRoot = createRoot(reusedContainer);
    roots.push(reusedRoot);
    await act(async () => reusedRoot.render(<reused.Feed />));
    const alpha = reusedContainer.querySelector('[data-key="a"]');
    reused.counters.keys = 0;

    await act(async () => {
      reused.roll(1, [{ id: "e", label: "E" }]);
      reused.roll(1, [initialItems[0]]);
      await flushCompilerUpdates();
    });

    expect(reusedContainer.textContent).toBe("CDEA");
    expect(reusedContainer.querySelector('[data-key="a"]')).toBe(alpha);
    // The optimized attempt reads the two final incoming keys, then complete
    // reconciliation rereads all four after detecting the committed-key move.
    expect(reused.counters.keys).toBe(6);

    const discarded = createRollingHarness(initialItems);
    const discardedContainer = document.createElement("div");
    document.body.append(discardedContainer);
    const discardedRoot = createRoot(discardedContainer);
    roots.push(discardedRoot);
    await act(async () => discardedRoot.render(<discarded.Feed />));
    discarded.counters.keys = 0;
    discarded.counters.descriptors = 0;
    discarded.counters.bindings = 0;

    await act(async () => {
      discarded.roll(4, [initialItems[0]]);
      discarded.roll(1, [{ id: "e", label: "E" }]);
      await flushCompilerUpdates();
    });

    expect(discardedContainer.textContent).toBe("E");
    expect(discarded.counters.keys).toBe(1);
    expect(discarded.counters.descriptors).toBe(1);
    expect(discarded.counters.bindings).toBe(1);
  });

  it("rejects a queued rolling chain after an unhinted intermediate update", async () => {
    const harness = createRollingHarness(
      ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    harness.counters.keys = 0;

    await act(async () => {
      harness.customRoll({ id: "e", label: "E" });
      harness.roll(1, [{ id: "f", label: "F" }]);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("CBEF");
    expect(harness.counters.keys).toBe(4);
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
    expect(harness.counters.keys).toBe(4);

    harness.counters.keys = 0;
    await act(async () => {
      harness.roll(Number.NaN, [{ id: "f", label: "F" }]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("BCDEF");
    expect(container.querySelector('[data-key="b"]')).toBe(b);
    expect(harness.counters.keys).toBe(5);

    harness.counters.keys = 0;
    await act(async () => {
      harness.roll(0, [{ id: "g", label: "G" }]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("BCDEFG");
    expect(container.querySelector('[data-key="b"]')).toBe(b);
    expect(harness.counters.keys).toBe(6);
  });

  it("preserves controlled focus and updates delegated indexes after queued rolls", async () => {
    const initialItems = ["a", "b", "c", "d"].map((id) => ({
      id,
      label: id.toUpperCase().repeat(4),
    }));
    const calls: string[] = [];
    let queue = () => undefined;
    const Feed = createCompiledComponent({
      displayName: "QueuedRollingInteractiveFeed",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        queue = () => {
          state[0].set((previous) =>
            hintedRoll(previous as Item[], 1, [{ id: "e", label: "EEEE" }]),
          );
          state[0].set((previous) =>
            hintedRoll(previous as Item[], 1, [{ id: "f", label: "FFFF" }]),
          );
        };
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
                  path: [1],
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
                      <input readOnly value={item.label} />
                      <button data-row-button={item.id} onClick={event(item, index, 0)}>
                        Select
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [{ name: "data-key", value: (item as Item).id }],
                styles: [],
                children: [
                  {
                    kind: "element",
                    tag: "input",
                    attributes: [
                      { name: "readOnly", value: true },
                      { name: "value", value: (item as Item).label },
                    ],
                    styles: [],
                    children: [],
                  },
                  {
                    kind: "element",
                    tag: "button",
                    attributes: [{ name: "data-row-button", value: (item as Item).id }],
                    styles: [],
                    children: ["Select"],
                  },
                ],
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
    await act(async () => root.render(<Feed />));
    const input = container.querySelector('[data-key="d"] input') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(1, 3);

    await act(async () => {
      queue();
      await flushCompilerUpdates();
    });
    await act(async () => {
      (container.querySelector('[data-row-button="d"]') as HTMLButtonElement).click();
    });

    expect(container.textContent).toBe("SelectSelectSelectSelect");
    expect(container.querySelector('[data-key="d"] input')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
    expect(calls).toEqual(["d:1"]);
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
    expect(harness.counters.keys).toBe(incomingCount);
    expect(harness.counters.descriptors).toBe(incomingCount);
    expect(harness.counters.bindings).toBe(incomingCount);
  }, 20_000);

  it("matches React through 1,000 randomized queued rolling commits", async () => {
    const initialItems = Array.from(
      { length: 48 },
      (_, index): Item => ({ id: `queued-row-${index}`, label: `Queued row ${index}` }),
    );
    const harness = createRollingHarness(initialItems);
    let rollReact: (remove: number, incoming: readonly Item[]) => void = () => undefined;
    let seed = 0x51ced;
    let nextId = initialItems.length;
    let expectedLength = initialItems.length;
    let incomingCount = 0;
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

    for (let update = 0; update < 1_000; update += 1) {
      const operations: Array<{ incoming: Item[]; remove: number }> = [];
      const operationCount = 2 + (random() % 3);
      for (let operation = 0; operation < operationCount; operation += 1) {
        const remove = 1 + (random() % 4);
        let incomingLength = 1 + (random() % 5);
        if (expectedLength < 36 && incomingLength < remove) incomingLength = remove;
        if (expectedLength > 60 && incomingLength > remove) incomingLength = remove;
        const incoming = Array.from({ length: incomingLength }, (): Item => {
          const id = nextId++;
          return { id: `queued-row-${id}`, label: `Queued row ${id}` };
        });
        operations.push({ incoming, remove });
        expectedLength = expectedLength - remove + incomingLength;
        incomingCount += incomingLength;
      }

      await act(async () => {
        for (const operation of operations) {
          harness.roll(operation.remove, operation.incoming);
          rollReact(operation.remove, operation.incoming);
        }
        await flushCompilerUpdates();
      });
      if (update % 25 === 0) {
        expect(compiledContainer.textContent).toBe(reactContainer.textContent);
      }
    }

    expect(compiledContainer.textContent).toBe(reactContainer.textContent);
    expect(compiledContainer.querySelectorAll("li")).toHaveLength(expectedLength);
    expect(harness.counters.keys).toBe(incomingCount);
    expect(harness.counters.descriptors).toBe(incomingCount);
    expect(harness.counters.bindings).toBe(incomingCount);
  }, 30_000);

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
      harness.roll(1, [{ id: "d", label: "Delta" }]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("GammaDelta");
    expect(recoverable).toEqual([]);

    roots.pop();
    act(() => {
      harness.roll(1, [{ id: "e", label: "Epsilon" }]);
      harness.roll(1, [{ id: "f", label: "Phi" }]);
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
