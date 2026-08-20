import React, { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCompiledComponent,
  type CompilerKeyedRowElement,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
  rank: number;
  visible: boolean;
}

interface Model {
  items: Item[];
  minimumRank: number;
  offset: number;
  limit: number;
  descending: boolean;
}

type Action =
  | { kind: "add"; item: Item }
  | { kind: "remove"; selector: number }
  | { kind: "toggle"; selector: number }
  | { kind: "update"; selector: number; rank: number; suffix: number }
  | { kind: "rotate"; amount: number }
  | { kind: "minimum"; value: number }
  | { kind: "offset"; value: number }
  | { kind: "limit"; value: number }
  | { kind: "direction" };

const roots: Array<{ unmount(): void }> = [];

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

function derivedItems(model: Model): Item[] {
  return model.items
    .filter((item) => item.visible && item.rank >= model.minimumRank)
    .toSorted((left, right) => (model.descending ? right.rank - left.rank : left.rank - right.rank))
    .slice(model.offset, model.offset + model.limit)
    .toReversed();
}

function rowDescriptor(item: Item): CompilerKeyedRowElement {
  return {
    kind: "element",
    tag: "li",
    attributes: [
      { name: "data-key", value: item.id },
      { name: "data-rank", value: item.rank },
    ],
    styles: [],
    children: [`${item.label}:${item.rank}`],
  };
}

function updateModel(model: Model, action: Action): Model {
  if (action.kind === "add") {
    const items =
      model.items.length >= 40
        ? [...model.items.slice(1), action.item]
        : [...model.items, action.item];
    return { ...model, items };
  }
  if (action.kind === "remove") {
    if (model.items.length === 0) return model;
    const index = action.selector % model.items.length;
    return { ...model, items: model.items.filter((_item, itemIndex) => itemIndex !== index) };
  }
  if (action.kind === "toggle") {
    if (model.items.length === 0) return model;
    const index = action.selector % model.items.length;
    return {
      ...model,
      items: model.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, visible: !item.visible } : item,
      ),
    };
  }
  if (action.kind === "update") {
    if (model.items.length === 0) return model;
    const index = action.selector % model.items.length;
    return {
      ...model,
      items: model.items.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, label: `${item.label}-${action.suffix}`, rank: action.rank }
          : item,
      ),
    };
  }
  if (action.kind === "rotate") {
    if (model.items.length < 2) return model;
    const amount = action.amount % model.items.length;
    return {
      ...model,
      items: [...model.items.slice(amount), ...model.items.slice(0, amount)],
    };
  }
  if (action.kind === "minimum") return { ...model, minimumRank: action.value };
  if (action.kind === "offset") return { ...model, offset: action.value };
  if (action.kind === "limit") return { ...model, limit: action.value };
  return { ...model, descending: !model.descending };
}

function createCompiledCollection(initial: Model, onExecution: () => void) {
  let setModel: (next: CompilerStateUpdater) => void = () => undefined;
  const Component = createCompiledComponent({
    displayName: "DerivedCollection",
    initialize: () => [initial],
    render(_props: Record<string, never>, state, blocks) {
      onExecution();
      setModel = (next) => state[0].set(next);
      const model = () => state[0].get() as Model;
      const items = () => derivedItems(model());
      const KeyedRows = blocks.KeyedRows;
      return (
        <section data-version="compiled">
          <KeyedRows
            id={0}
            render={() => (
              <ol>
                {items().map((item) => (
                  <li data-key={item.id} data-rank={item.rank} key={item.id}>
                    {item.label}:{item.rank}
                  </li>
                ))}
              </ol>
            )}
            items={items}
            rowKey={(item) => (item as Item).id}
            create={(item) => rowDescriptor(item as Item)}
            bindings={[
              {
                kind: "attribute",
                path: [],
                name: "data-key",
                read: (item) => (item as Item).id,
              },
              {
                kind: "attribute",
                path: [],
                name: "data-rank",
                read: (item) => (item as Item).rank,
              },
              {
                kind: "text",
                path: [],
                read: (item) => [`${(item as Item).label}:${(item as Item).rank}`],
              },
            ]}
          />
        </section>
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });
  return { Component, setModel: (next: CompilerStateUpdater) => setModel(next) };
}

function snapshot(container: Element): string[][] {
  return [...container.querySelectorAll("li")].map((row) => [
    row.getAttribute("data-key") || "",
    row.getAttribute("data-rank") || "",
    row.textContent || "",
  ]);
}

describe("compiled derived collection runtime", () => {
  it("does not rerun the pipeline for an unrelated compiler cell", async () => {
    let setMinimum: (next: CompilerStateUpdater) => void = () => undefined;
    let setUnrelated: (next: CompilerStateUpdater) => void = () => undefined;
    let executions = 0;
    let pipelineReads = 0;
    const Inventory = createCompiledComponent({
      displayName: "DerivedCollectionDependencies",
      initialize: () => [
        [
          { id: "a", label: "Alpha", rank: 1, visible: true },
          { id: "b", label: "Beta", rank: 2, visible: true },
        ],
        0,
        0,
      ],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        setMinimum = (next) => state[1].set(next);
        setUnrelated = (next) => state[2].set(next);
        const items = () => {
          pipelineReads += 1;
          return (state[0].get() as Item[])
            .filter((item) => item.rank >= Number(state[1].get()))
            .toSorted((left, right) => left.rank - right.rank);
        };
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <output>{Number(state[2].get())}</output>
            <KeyedRows
              id={0}
              render={() => (
                <ul>
                  {items().map((item) => (
                    <li data-key={item.id} key={item.id}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
              items={items}
              rowKey={(item) => (item as Item).id}
              create={(item) => rowDescriptor(item as Item)}
              bindings={[{ kind: "text", path: [], read: (item) => [(item as Item).label] }]}
            />
          </section>
        );
      },
      bindings: [
        {
          kind: "text",
          path: [0],
          dependencies: [2],
          read: (_props, state) => state[2].get(),
        },
        { kind: "block", id: 0, dependencies: [0, 1] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Inventory />));
    const initialPipelineReads = pipelineReads;

    await act(async () => {
      setUnrelated(1);
      await flushCompilerUpdates();
    });
    expect(container.querySelector("output")?.textContent).toBe("1");
    expect(pipelineReads).toBe(initialPipelineReads);

    await act(async () => {
      setMinimum(2);
      await flushCompilerUpdates();
    });
    expect(pipelineReads).toBeGreaterThan(initialPipelineReads);
    expect(snapshot(container)).toEqual([["b", "", "Beta"]]);
    expect(executions).toBe(1);
  });

  it("preserves surviving keyed rows across filter, order, and window changes", async () => {
    const initial: Model = {
      items: [
        { id: "a", label: "Alpha", rank: 1, visible: true },
        { id: "b", label: "Beta", rank: 2, visible: true },
        { id: "c", label: "Gamma", rank: 3, visible: false },
      ],
      minimumRank: 0,
      offset: 0,
      limit: 3,
      descending: false,
    };
    let executions = 0;
    const compiled = createCompiledCollection(initial, () => {
      executions += 1;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<compiled.Component />));
    const beta = container.querySelector<HTMLElement>('[data-key="b"]')!;

    await act(async () => {
      compiled.setModel((value) => ({
        ...(value as Model),
        descending: true,
        minimumRank: 2,
        items: (value as Model).items.map((item) =>
          item.id === "b" ? { ...item, label: "Bravo", rank: 4 } : item,
        ),
      }));
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(snapshot(container)).toEqual([["b", "4", "Bravo:4"]]);
    expect(executions).toBe(1);
  });

  it("matches React across 5,000 deterministic pipeline and keyed-row transitions", async () => {
    const initial: Model = {
      items: Array.from({ length: 16 }, (_, index) => ({
        id: `i${index}`,
        label: `Item ${index}`,
        rank: index % 11,
        visible: index % 3 !== 0,
      })),
      minimumRank: 0,
      offset: 0,
      limit: 12,
      descending: false,
    };
    let compiledExecutions = 0;
    const compiled = createCompiledCollection(initial, () => {
      compiledExecutions += 1;
    });
    let setReact: React.Dispatch<React.SetStateAction<Model>> = () => undefined;
    function Normal() {
      const [model, setModel] = useState(initial);
      setReact = setModel;
      return (
        <section data-version="react">
          <ol>
            {derivedItems(model).map((item) => (
              <li data-key={item.id} data-rank={item.rank} key={item.id}>
                {item.label}:{item.rank}
              </li>
            ))}
          </ol>
        </section>
      );
    }

    let seed = 0x51ced123;
    let nextId = 0;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    const actions: Action[] = Array.from({ length: 5000 }, () => {
      const operation = random() % 9;
      const selector = random();
      if (operation === 0) {
        const id = `n${nextId++}`;
        return {
          kind: "add",
          item: {
            id,
            label: id.toUpperCase(),
            rank: random() % 19,
            visible: (random() & 1) === 0,
          },
        };
      }
      if (operation === 1) return { kind: "remove", selector };
      if (operation === 2) return { kind: "toggle", selector };
      if (operation === 3) {
        return { kind: "update", selector, rank: random() % 19, suffix: random() % 97 };
      }
      if (operation === 4) return { kind: "rotate", amount: selector };
      if (operation === 5) return { kind: "minimum", value: selector % 12 };
      if (operation === 6) return { kind: "offset", value: selector % 5 };
      if (operation === 7) return { kind: "limit", value: (selector % 16) + 1 };
      return { kind: "direction" };
    });

    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = createRoot(compiledContainer);
    const reactRoot = createRoot(reactContainer);
    roots.push(compiledRoot, reactRoot);
    await act(async () => {
      compiledRoot.render(<compiled.Component />);
      reactRoot.render(<Normal />);
    });

    for (let offset = 0; offset < actions.length; offset += 20) {
      const batch = actions.slice(offset, offset + 20);
      await act(async () => {
        for (const action of batch) {
          compiled.setModel((value) => updateModel(value as Model, action));
          setReact((value) => updateModel(value, action));
        }
        await flushCompilerUpdates();
      });
      expect(snapshot(compiledContainer)).toEqual(snapshot(reactContainer));
    }
    expect(compiledExecutions).toBe(1);
  }, 30_000);
});
