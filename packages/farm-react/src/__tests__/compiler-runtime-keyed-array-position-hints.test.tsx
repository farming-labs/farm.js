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
  toSpliced(start: number, deleteCount: number): Item[];
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

function hintedSpliceReplace(previous: Item[], position: number, item: Item): Item[] {
  const source = previous as PositionArray;
  return createCompilerKeyedArrayPositionUpdate(
    source,
    source.toSpliced,
    "replace",
    position,
    1,
    item,
  ) as Item[];
}

function hintedRemove(previous: Item[], position: number): Item[] {
  const source = previous as PositionArray;
  return createCompilerKeyedArrayPositionUpdate(
    source,
    source.toSpliced,
    "remove",
    position,
    1,
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
  let remove: (position: number) => void = () => undefined;
  let replace: (position: number, item: Item) => void = () => undefined;
  let withReplace: (position: number, item: Item) => void = () => undefined;
  let queueTwo: (first: Item, second: Item) => void = () => undefined;
  let queueRemoveTwo: () => void = () => undefined;
  let customInsert: (item: Item) => void = () => undefined;
  const Table = createCompiledComponent({
    displayName: "PositionTable",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      insert = (position, item) =>
        state[0].set((previous) => hintedInsert(previous as Item[], position, item));
      remove = (position) => state[0].set((previous) => hintedRemove(previous as Item[], position));
      replace = (position, item) =>
        state[0].set((previous) => hintedSpliceReplace(previous as Item[], position, item));
      withReplace = (position, item) =>
        state[0].set((previous) => hintedReplace(previous as Item[], position, item));
      queueTwo = (first, second) => {
        state[0].set((previous) => hintedInsert(previous as Item[], 1, first));
        state[0].set((previous) => hintedInsert(previous as Item[], 2, second));
      };
      queueRemoveTwo = () => {
        state[0].set((previous) => hintedRemove(previous as Item[], 1));
        state[0].set((previous) => hintedRemove(previous as Item[], 1));
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
    queueRemoveTwo: () => queueRemoveTwo(),
    remove: (position: number) => remove(position),
    replace: (position: number, item: Item) => replace(position, item),
    withReplace: (position: number, item: Item) => withReplace(position, item),
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

  it("removes one row at a known position without reading surviving keys or bindings", async () => {
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
    const removed = container.querySelector('[data-key="row-2048"]');
    const after = container.querySelector('[data-key="row-2049"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.remove(2_048);
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll("li")];
    expect(rows[2_047]).toBe(before);
    expect(rows[2_048]).toBe(after);
    expect(removed?.isConnected).toBe(false);
    expect(rows).toHaveLength(4_095);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
    expect(harness.counters.keys).toBe(0);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(0);
  });

  it("patches a same-key toSpliced replacement and creates one host row for a new key", async () => {
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

    const alpha = container.querySelector('[data-key="a"]');
    await act(async () => {
      harness.withReplace(0, { id: "a", label: "Alpha updated" });
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(alpha?.textContent).toBe("Alpha updated");
    expect(harness.counters.keys).toBe(3);
    expect(harness.counters.descriptors).toBe(1);
    expect(harness.counters.bindings).toBe(3);
  });

  it("preserves native removal arguments, return values, and errors", () => {
    const source = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ] as PositionArray;
    const removed = createCompilerKeyedArrayPositionUpdate(
      source,
      source.toSpliced,
      "remove",
      -1,
      1,
    ) as Item[];
    expect(removed.map((item) => item.id)).toEqual(["a", "b"]);
    expect(source.map((item) => item.id)).toEqual(["a", "b", "c"]);

    const customResult = [source[1]];
    const custom = function (this: Item[], position: number, deleteCount: number) {
      expect(this).toBe(source);
      expect([position, deleteCount]).toEqual([1, 1]);
      return customResult;
    };
    expect(createCompilerKeyedArrayPositionUpdate(source, custom, "remove", 1, 1)).toBe(
      customResult,
    );

    const error = new Error("remove failed");
    expect(() =>
      createCompilerKeyedArrayPositionUpdate(
        source,
        () => {
          throw error;
        },
        "remove",
        1,
        1,
      ),
    ).toThrow(error);
  });

  it("preserves native toSpliced replacement clamping, return values, and errors", () => {
    const source = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ] as PositionArray;
    const replacement = { id: "d", label: "Delta" };
    const replaced = createCompilerKeyedArrayPositionUpdate(
      source,
      source.toSpliced,
      "replace",
      -99,
      1,
      replacement,
    ) as Item[];
    expect(replaced.map((item) => item.id)).toEqual(["d", "b", "c"]);
    expect(source.map((item) => item.id)).toEqual(["a", "b", "c"]);

    const appended = createCompilerKeyedArrayPositionUpdate(
      source,
      source.toSpliced,
      "replace",
      99,
      1,
      replacement,
    ) as Item[];
    expect(appended.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);

    const customResult = [replacement];
    const custom = function (this: Item[], position: number, deleteCount: number, item: Item) {
      expect(this).toBe(source);
      expect([position, deleteCount, item]).toEqual([1, 1, replacement]);
      return customResult;
    };
    expect(
      createCompilerKeyedArrayPositionUpdate(source, custom, "replace", 1, 1, replacement),
    ).toBe(customResult);

    const error = new Error("replace failed");
    expect(() =>
      createCompilerKeyedArrayPositionUpdate(
        source,
        () => {
          throw error;
        },
        "replace",
        1,
        1,
        replacement,
      ),
    ).toThrow(error);
  });

  it("falls back for out-of-range and subclass toSpliced replacements", async () => {
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
    const alpha = container.querySelector('[data-key="a"]');
    const beta = container.querySelector('[data-key="b"]');
    const gamma = container.querySelector('[data-key="c"]');
    harness.counters.keys = 0;

    await act(async () => {
      harness.replace(99, { id: "d", label: "Delta" });
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
    ]);
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(harness.counters.keys).toBe(4);

    class ItemArray extends Array<Item> {}
    const subclass = createPositionHarness(
      new ItemArray(
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ),
    );
    const subclassContainer = document.createElement("div");
    document.body.append(subclassContainer);
    const subclassRoot = createRoot(subclassContainer);
    roots.push(subclassRoot);
    await act(async () => subclassRoot.render(<subclass.Table />));
    subclass.counters.keys = 0;

    await act(async () => {
      subclass.replace(1, { id: "d", label: "Delta" });
      await flushCompilerUpdates();
    });
    expect([...subclassContainer.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Alpha",
      "Delta",
      "Gamma",
    ]);
    expect(subclass.counters.keys).toBe(3);
  });

  it("evaluates coercible runtime positions once and preserves their native result", () => {
    const source = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ] as PositionArray;
    let coercions = 0;
    const position = {
      valueOf() {
        coercions += 1;
        return 1;
      },
    };

    const result = createCompilerKeyedArrayPositionUpdate(
      source,
      source.toSpliced,
      "remove",
      position as unknown as number,
      1,
    ) as Item[];

    expect(result.map((item) => item.id)).toEqual(["a", "c"]);
    expect(coercions).toBe(1);
  });

  it("falls back while preserving fractional, NaN, and infinite runtime positions", async () => {
    const harness = createPositionHarness([
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
      harness.remove(1.75);
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Alpha",
      "Gamma",
      "Delta",
    ]);

    await act(async () => {
      harness.remove(Number.NaN);
      await flushCompilerUpdates();
    });
    const gamma = container.querySelector('[data-key="c"]');
    const delta = container.querySelector('[data-key="d"]');
    expect([...container.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Gamma",
      "Delta",
    ]);

    await act(async () => {
      harness.remove(Number.POSITIVE_INFINITY);
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(container.querySelector('[data-key="d"]')).toBe(delta);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
  });

  it("preserves native negative, clamped, empty, and subclass removal behavior", async () => {
    class ItemArray extends Array<Item> {}
    const initialItems = new ItemArray(
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    );
    const harness = createPositionHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));

    await act(async () => {
      harness.remove(-1);
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);

    const alpha = container.querySelector('[data-key="a"]');
    const beta = container.querySelector('[data-key="b"]');
    await act(async () => {
      harness.remove(99);
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="b"]')).toBe(beta);

    await act(async () => {
      harness.remove(-99);
      await flushCompilerUpdates();
      harness.remove(0);
      await flushCompilerUpdates();
      harness.remove(0);
      await flushCompilerUpdates();
    });
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
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
      dependent.remove(1);
      await flushCompilerUpdates();
    });
    expect([...dependentContainer.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "3: Alpha",
      "3: Beta",
      "3: Gamma",
    ]);

    await act(async () => {
      dependent.queueTwo({ id: "e", label: "Epsilon" }, { id: "f", label: "Phi" });
      await flushCompilerUpdates();
    });
    expect([...dependentContainer.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "5: Alpha",
      "5: Epsilon",
      "5: Phi",
      "5: Beta",
      "5: Gamma",
    ]);

    await act(async () => {
      dependent.queueRemoveTwo();
      await flushCompilerUpdates();
    });
    expect([...dependentContainer.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      "3: Alpha",
      "3: Beta",
      "3: Gamma",
    ]);
  });

  it("matches normal React through 1,000 deterministic position updates", async () => {
    const initialItems = Array.from(
      { length: 24 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createPositionHarness(initialItems);
    let updateReact: (
      kind: "insert" | "remove" | "replace",
      position: number,
      item?: Item,
    ) => void = () => undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      updateReact = (kind, position, item) =>
        setItems((previous) => {
          if (kind === "remove") {
            return [...previous.slice(0, position), ...previous.slice(position + 1)];
          }
          if (!item) return previous;
          return kind === "insert"
            ? [...previous.slice(0, position), item, ...previous.slice(position)]
            : previous.map((current, index) => (index === position ? item : current));
        });
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
    for (let step = 0; step < 1_000; step += 1) {
      const kind = step % 7 === 0 ? "remove" : step % 5 === 0 ? "insert" : "replace";
      const position = (step * 17) % (kind === "insert" ? length + 1 : length);
      const item =
        kind === "remove"
          ? undefined
          : {
              id: `${kind}-${step}`,
              label: `${kind === "insert" ? "Insert" : "Replace"} ${step}`,
            };
      await act(async () => {
        if (kind === "insert") harness.insert(position, item!);
        else if (kind === "remove") harness.remove(position);
        else harness.replace(position, item!);
        updateReact(kind, position, item);
        await flushCompilerUpdates();
      });
      if (kind === "insert") length += 1;
      else if (kind === "remove") length -= 1;
    }

    expect(compiledContainer.querySelector("ul")?.textContent).toBe(
      reactContainer.querySelector("ol")?.textContent,
    );
    expect(compiledContainer.querySelectorAll("li")).toHaveLength(length);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
  });

  it("preserves focused input identity and selection when removing a preceding row", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    let remove = () => undefined;
    const FormRows = createCompiledComponent({
      displayName: "PositionRemovalFormRows",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        remove = () => state[0].set((previous) => hintedRemove(previous as Item[], 0));
        return (
          <section>
            <blocks.KeyedRows
              collectionDependency={0}
              dependencies={[0]}
              id={0}
              items={items}
              positionIndexIndependent
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
      remove();
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="b"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  });

  it("updates delegated event indexes after removing an earlier row", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    let remove = () => undefined;
    const calls: string[] = [];
    const EventRows = createCompiledComponent({
      displayName: "PositionRemovalEventRows",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        remove = () => state[0].set((previous) => hintedRemove(previous as Item[], 0));
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
              id={0}
              items={items}
              positionIndexIndependent
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
    await act(async () => root.render(<EventRows />));

    await act(async () => {
      remove();
      await flushCompilerUpdates();
    });
    await act(async () => {
      (container.querySelector('[data-row-button="c"]') as HTMLButtonElement).click();
    });
    expect(calls).toEqual(["c:1"]);
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

    await act(async () => {
      harness.remove(-1);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("AlphaGamma");
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
