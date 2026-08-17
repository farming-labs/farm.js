import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompiledComponent, type CompilerStateUpdater } from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
}

const roots: Array<{ unmount(): void }> = [];

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

describe("compiled React keyed list runtime", () => {
  it("reorders and updates keyed rows without executing the outer component", async () => {
    let executions = 0;
    let listRenders = 0;
    const Panel = createCompiledComponent({
      displayName: "KeyedInventory",
      initialize: () => [
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
        ],
        0,
      ],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        const KeyedList = blocks.KeyedList;
        return (
          <section>
            <button
              data-action="reverse"
              onClick={() => state[0].set((value) => [...(value as Item[])].reverse())}
            >
              Reverse
            </button>
            <button
              data-action="rename"
              onClick={() =>
                state[0].set((value) =>
                  (value as Item[]).map((item) =>
                    item.id === "b" ? { ...item, label: "Bravo" } : item,
                  ),
                )
              }
            >
              Rename
            </button>
            <button
              data-action="unrelated"
              onClick={() => state[1].set((value) => Number(value) + 1)}
            >
              Unrelated
            </button>
            <ul>
              <KeyedList
                id={0}
                render={() => {
                  listRenders += 1;
                  return (state[0].get() as Item[]).map((item) => (
                    <li data-key={item.id} key={item.id}>
                      {item.label}
                    </li>
                  ));
                }}
              />
            </ul>
            <output>{Number(state[1].get())}</output>
          </section>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        {
          kind: "text",
          path: [4],
          dependencies: [1],
          read: (_props, state) => state[1].get(),
        },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Panel />));

    const rows = () => [...container.querySelectorAll<HTMLLIElement>("li")];
    const original = new Map(rows().map((row) => [row.dataset.key, row]));
    expect(executions).toBe(1);
    expect(listRenders).toBe(1);

    await act(async () => {
      container.querySelector<HTMLElement>("[data-action='unrelated']")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("output")?.textContent).toBe("1");
    expect(listRenders).toBe(1);

    await act(async () => {
      container.querySelector<HTMLElement>("[data-action='reverse']")!.click();
      await flushCompilerUpdates();
    });
    expect(rows().map((row) => row.dataset.key)).toEqual(["c", "b", "a"]);
    for (const row of rows()) expect(row).toBe(original.get(row.dataset.key));

    await act(async () => {
      container.querySelector<HTMLElement>("[data-action='rename']")!.click();
      await flushCompilerUpdates();
    });
    expect(rows().map((row) => row.textContent)).toEqual(["Gamma", "Bravo", "Alpha"]);
    expect(executions).toBe(1);
    expect(listRenders).toBe(3);
  });

  it("preserves state in a custom keyed row while the compiled boundary reorders", async () => {
    function Row({ item }: { item: Item }) {
      const [clicks, setClicks] = useState(0);
      return (
        <button data-key={item.id} onClick={() => setClicks((value) => value + 1)}>
          {item.label}:{clicks}
        </button>
      );
    }

    const ListPanel = createCompiledComponent({
      displayName: "StatefulRows",
      initialize: () => [
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        const KeyedList = blocks.KeyedList;
        return (
          <section>
            <button
              data-action="reverse"
              onClick={() => state[0].set((value) => [...(value as Item[])].reverse())}
            >
              Reverse
            </button>
            <div>
              <KeyedList
                id={0}
                render={() =>
                  (state[0].get() as Item[]).map((item) => <Row item={item} key={item.id} />)
                }
              />
            </div>
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<ListPanel />));
    await act(async () => container.querySelector<HTMLElement>("[data-key='a']")!.click());
    expect(container.querySelector("[data-key='a']")?.textContent).toBe("Alpha:1");

    await act(async () => {
      container.querySelector<HTMLElement>("[data-action='reverse']")!.click();
      await flushCompilerUpdates();
    });
    const rows = [...container.querySelectorAll<HTMLElement>("[data-key]")];
    expect(rows.map((row) => row.textContent)).toEqual(["Beta:0", "Alpha:1"]);
  });

  it("hydrates keyed rows and drops a queued refresh after unmount", async () => {
    const errors: unknown[] = [];
    const Inventory = createCompiledComponent({
      displayName: "HydratedInventory",
      initialize: () => [[{ id: "a", label: "Alpha" }]],
      render(_props: Record<string, never>, state, blocks) {
        const KeyedList = blocks.KeyedList;
        return (
          <section>
            <button
              onClick={() =>
                state[0].set((value) => [...(value as Item[]), { id: "b", label: "Beta" }])
              }
            >
              Add
            </button>
            <ul>
              <KeyedList
                id={0}
                render={() =>
                  (state[0].get() as Item[]).map((item) => <li key={item.id}>{item.label}</li>)
                }
              />
            </ul>
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    container.innerHTML = renderToString(<Inventory />);
    document.body.append(container);
    await act(async () => {
      const root = hydrateRoot(container, <Inventory />, {
        onRecoverableError: (error) => errors.push(error),
      });
      roots.push(root);
    });
    expect(errors).toEqual([]);
    expect(container.querySelector("ul")?.textContent).toBe("Alpha");

    const root = roots.pop()!;
    await act(async () => {
      container.querySelector("button")!.click();
      root.unmount();
      await flushCompilerUpdates();
    });
    expect(errors).toEqual([]);
  });

  it("keeps subscriptions safe under StrictMode", async () => {
    const Inventory = createCompiledComponent({
      displayName: "StrictInventory",
      initialize: () => [[{ id: "a", label: "Alpha" }]],
      render(_props: Record<string, never>, state, blocks) {
        const KeyedList = blocks.KeyedList;
        return (
          <section>
            <button onClick={() => state[0].set([])}>Clear</button>
            <ul>
              <KeyedList
                id={0}
                render={() =>
                  (state[0].get() as Item[]).map((item) => <li key={item.id}>{item.label}</li>)
                }
              />
            </ul>
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <StrictMode>
          <Inventory />
        </StrictMode>,
      ),
    );
    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("matches normal React through 1,000 deterministic collection operations", async () => {
    type Update = (items: Item[]) => Item[];
    let compiledSet: (next: CompilerStateUpdater) => void = () => undefined;
    let normalSet: React.Dispatch<React.SetStateAction<Item[]>> = () => undefined;
    let compiledExecutions = 0;

    const initial: Item[] = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ];
    const Compiled = createCompiledComponent({
      displayName: "RandomKeyedList",
      initialize: () => [initial],
      render(_props: Record<string, never>, state, blocks) {
        compiledExecutions += 1;
        compiledSet = (next) => state[0].set(next);
        const KeyedList = blocks.KeyedList;
        return (
          <ul>
            <KeyedList
              id={0}
              render={() =>
                (state[0].get() as Item[]).map((item) => (
                  <li data-key={item.id} key={item.id}>
                    {item.label}
                  </li>
                ))
              }
            />
          </ul>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    function Normal() {
      const [items, setItems] = useState(initial);
      normalSet = setItems;
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

    let seed = 0x51f15e;
    let nextId = 0;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    const updates: Update[] = Array.from({ length: 1000 }, () => {
      const operation = random() % 5;
      const selector = random();
      const id = `n${nextId++}`;
      if (operation === 0) return (items) => [...items, { id, label: id.toUpperCase() }];
      if (operation === 1) return (items) => [{ id, label: id.toUpperCase() }, ...items];
      if (operation === 2) {
        return (items) =>
          items.length === 0
            ? items
            : items.filter((_, index) => index !== selector % items.length);
      }
      if (operation === 3) return (items) => [...items].reverse();
      return (items) =>
        items.length === 0
          ? items
          : items.map((item, index) =>
              index === selector % items.length ? { ...item, label: `${item.label}!` } : item,
            );
    });

    const compiledContainer = document.createElement("div");
    const normalContainer = document.createElement("div");
    document.body.append(compiledContainer, normalContainer);
    const compiledRoot = createRoot(compiledContainer);
    const normalRoot = createRoot(normalContainer);
    roots.push(compiledRoot, normalRoot);
    await act(async () => {
      compiledRoot.render(<Compiled />);
      normalRoot.render(<Normal />);
    });

    for (let offset = 0; offset < updates.length; offset += 10) {
      await act(async () => {
        for (const update of updates.slice(offset, offset + 10)) {
          compiledSet((value) => update(value as Item[]));
          normalSet(update);
        }
        await flushCompilerUpdates();
      });
      const compiledRows = [...compiledContainer.querySelectorAll("li")].map((row) => [
        row.getAttribute("data-key"),
        row.textContent,
      ]);
      const normalRows = [...normalContainer.querySelectorAll("li")].map((row) => [
        row.getAttribute("data-key"),
        row.textContent,
      ]);
      expect(compiledRows).toEqual(normalRows);
    }
    expect(compiledExecutions).toBe(1);
  });
});
