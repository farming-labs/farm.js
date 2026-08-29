import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCompiledComponent,
  createCompilerKeyedArrayPositionUpdate,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
}

type PositionArray = Item[] & {
  toSpliced(start: number, deleteCount: number, item: Item): Item[];
  with(index: number, item: Item): Item[];
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
});

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function hintedInsert(previous: Item[], position: number, item: Item): Item[] {
  const source = previous as PositionArray;
  return createCompilerKeyedArrayPositionUpdate(
    source,
    source.toSpliced,
    "insert",
    position,
    0,
    item,
  ) as Item[];
}

function hintedReplace(previous: Item[], position: number, item: Item): Item[] {
  const source = previous as PositionArray;
  return createCompilerKeyedArrayPositionUpdate(
    source,
    source.with,
    "replace",
    position,
    item,
  ) as Item[];
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

function createPositionHarness(initialItems: Item[], readsCollection = false) {
  const counters = { executions: 0, renders: 0, keys: 0, descriptors: 0, bindings: 0 };
  let insert: (position: number, item: Item) => void = () => undefined;
  let replace: (position: number, item: Item) => void = () => undefined;
  let queueTwo: (first: Item, second: Item) => void = () => undefined;
  let customInsert: (item: Item) => void = () => undefined;
  const Table = createCompiledComponent({
    displayName: "PositionTable",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      insert = (position, item) =>
        state[0].set((previous) => hintedInsert(previous as Item[], position, item));
      replace = (position, item) =>
        state[0].set((previous) => hintedReplace(previous as Item[], position, item));
      queueTwo = (first, second) => {
        state[0].set((previous) => hintedInsert(previous as Item[], 1, first));
        state[0].set((previous) => hintedInsert(previous as Item[], 2, second));
      };
      customInsert = (item) =>
        state[0].set((previous) => {
          const source = previous as Item[];
          const method = function (this: Item[], position: number, _remove: number, next: Item) {
            return [...this.slice(0, position), next, ...this.slice(position)].reverse();
          };
          return createCompilerKeyedArrayPositionUpdate(source, method, "insert", 1, 0, item);
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
            positionIndexIndependent
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
    Table,
    counters,
    customInsert: (item: Item) => customInsert(item),
    insert: (position: number, item: Item) => insert(position, item),
    queueTwo: (first: Item, second: Item) => queueTwo(first, second),
    replace: (position: number, item: Item) => replace(position, item),
  };
}

describe("compiled keyed-array position hints", () => {
  it("inserts one row at a known position without reading existing row keys or bindings", async () => {
    const initialItems = Array.from(
      { length: 4_096 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createPositionHarness(initialItems);
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

    await act(async () => {
      harness.insert(2_048, { id: "inserted", label: "Inserted" });
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll("li")];
    expect(rows[2_047]).toBe(before);
    expect(rows[2_048]?.textContent).toBe("Inserted");
    expect(rows[2_049]).toBe(after);
    expect(rows).toHaveLength(4_097);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(1);
    expect(harness.counters.descriptors).toBe(1);
    expect(harness.counters.bindings).toBe(1);
  });

  it("patches a same-key replacement and creates one host row for a new key", async () => {
    const harness = createPositionHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const beta = container.querySelector('[data-key="b"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.replace(1, { id: "b", label: "Beta updated" });
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(beta?.textContent).toBe("Beta updated");
    expect(harness.counters.keys).toBe(1);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(1);

    await act(async () => {
      harness.replace(1, { id: "d", label: "Delta" });
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="b"]')).toBeNull();
    expect(container.querySelector('[data-key="d"]')?.textContent).toBe("Delta");
    expect(container.querySelector('[data-key="d"]')).not.toBe(beta);
    expect(harness.counters.keys).toBe(2);
    expect(harness.counters.descriptors).toBe(1);
    expect(harness.counters.bindings).toBe(2);
  });

  it("falls back for custom methods, collection-dependent bindings, and queued hints", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    const custom = createPositionHarness(initialItems);
    const customContainer = document.createElement("div");
    document.body.append(customContainer);
    const customRoot = createRoot(customContainer);
    roots.push(customRoot);
    await act(async () => customRoot.render(<custom.Table />));
    await act(async () => {
      custom.customInsert({ id: "d", label: "Delta" });
      await flushCompilerUpdates();
    });
    expect([...customContainer.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Gamma",
      "Beta",
      "Delta",
      "Alpha",
    ]);

    const dependent = createPositionHarness(initialItems, true);
    const dependentContainer = document.createElement("div");
    document.body.append(dependentContainer);
    const dependentRoot = createRoot(dependentContainer);
    roots.push(dependentRoot);
    await act(async () => dependentRoot.render(<dependent.Table />));
    await act(async () => {
      dependent.insert(1, { id: "d", label: "Delta" });
      await flushCompilerUpdates();
    });
    expect([...dependentContainer.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "4: Alpha",
      "4: Delta",
      "4: Beta",
      "4: Gamma",
    ]);

    await act(async () => {
      dependent.queueTwo({ id: "e", label: "Epsilon" }, { id: "f", label: "Phi" });
      await flushCompilerUpdates();
    });
    expect([...dependentContainer.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "6: Alpha",
      "6: Epsilon",
      "6: Phi",
      "6: Delta",
      "6: Beta",
      "6: Gamma",
    ]);
  });

  it("matches normal React through 400 deterministic inserts and replacements", async () => {
    const initialItems = Array.from(
      { length: 24 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createPositionHarness(initialItems);
    let updateReact: (kind: "insert" | "replace", position: number, item: Item) => void = () =>
      undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      updateReact = (kind, position, item) =>
        setItems((previous) =>
          kind === "insert"
            ? [...previous.slice(0, position), item, ...previous.slice(position)]
            : previous.map((current, index) => (index === position ? item : current)),
        );
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

    let length = initialItems.length;
    for (let step = 0; step < 400; step += 1) {
      const insert = step % 5 === 0;
      const position = (step * 17) % (insert ? length + 1 : length);
      const item = insert
        ? { id: `insert-${step}`, label: `Insert ${step}` }
        : { id: `replace-${step}`, label: `Replace ${step}` };
      await act(async () => {
        if (insert) harness.insert(position, item);
        else harness.replace(position, item);
        updateReact(insert ? "insert" : "replace", position, item);
        await flushCompilerUpdates();
      });
      if (insert) length += 1;
    }

    expect(compiledContainer.querySelector("ul")?.textContent).toBe(
      reactContainer.querySelector("ol")?.textContent,
    );
    expect(compiledContainer.querySelectorAll("li")).toHaveLength(length);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
  });

  it("hydrates in StrictMode and drops a queued position update after unmount", async () => {
    const harness = createPositionHarness([
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
      harness.insert(1, { id: "c", label: "Gamma" });
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("AlphaGammaBeta");
    expect(recoverable).toEqual([]);

    roots.pop();
    act(() => {
      harness.replace(0, { id: "d", label: "Delta" });
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
