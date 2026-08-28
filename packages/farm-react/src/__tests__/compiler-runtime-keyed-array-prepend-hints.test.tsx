import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCompiledComponent,
  createCompilerKeyedArrayPrepend,
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

function hintedPrepend(previous: Item[], additions: readonly Item[]): Item[] {
  return createCompilerKeyedArrayPrepend(previous, [...additions, ...previous]) as Item[];
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

function createPrependHarness(initialItems: Item[], readsCollection = false) {
  const counters: Counters = {
    executions: 0,
    listRenders: 0,
    keyReads: 0,
    descriptorReads: 0,
    bindingReads: 0,
  };
  let prepend: (additions: readonly Item[]) => void = () => undefined;
  let plainThenPrepend: (addition: Item) => void = () => undefined;
  let mismatchedPrepend: (addition: Item) => void = () => undefined;
  const Feed = createCompiledComponent({
    displayName: "PrependFeed",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      prepend = (additions) =>
        state[0].set((previous) => hintedPrepend(previous as Item[], additions));
      plainThenPrepend = (addition) => {
        state[0].set((previous) => [...(previous as Item[])]);
        state[0].set((previous) => hintedPrepend(previous as Item[], [addition]));
      };
      mismatchedPrepend = (addition) => {
        state[0].set((previous) => {
          const source = previous as Item[];
          return createCompilerKeyedArrayPrepend(source, [
            addition,
            ...source.slice().reverse(),
          ]) as Item[];
        });
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
            prependIndexIndependent
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
    Feed,
    counters,
    mismatchedPrepend: (addition: Item) => mismatchedPrepend(addition),
    plainThenPrepend: (addition: Item) => plainThenPrepend(addition),
    prepend: (additions: readonly Item[]) => prepend(additions),
  };
}

describe("compiled keyed-array prepend hints", () => {
  it("creates only prepended rows and preserves every existing DOM identity", async () => {
    const initialItems = Array.from(
      { length: 2_048 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createPrependHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    const first = container.querySelector('[data-key="row-0"]');
    const middle = container.querySelector('[data-key="row-1024"]');
    const last = container.querySelector('[data-key="row-2047"]');
    harness.counters.keyReads = 0;
    harness.counters.descriptorReads = 0;
    harness.counters.bindingReads = 0;

    await act(async () => {
      harness.prepend([
        { id: "row-new-0", label: "New 0" },
        { id: "row-new-1", label: "New 1" },
      ]);
      await flushCompilerUpdates();
    });

    expect(container.querySelector("li:first-child")?.textContent).toBe("New 0");
    expect(container.querySelector('[data-key="row-0"]')).toBe(first);
    expect(container.querySelector('[data-key="row-1024"]')).toBe(middle);
    expect(container.querySelector('[data-key="row-2047"]')).toBe(last);
    expect(container.querySelectorAll("li")).toHaveLength(2_050);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.listRenders).toBe(1);
    expect(harness.counters.keyReads).toBe(2);
    expect(harness.counters.descriptorReads).toBe(2);
    expect(harness.counters.bindingReads).toBe(2);
  });

  it("composes queued prepends and rejects an unhinted or invalid source chain", async () => {
    const harness = createPrependHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));

    await act(async () => {
      harness.prepend([{ id: "c", label: "Gamma" }]);
      harness.prepend([
        { id: "d", label: "Delta" },
        { id: "e", label: "Epsilon" },
      ]);
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Delta",
      "Epsilon",
      "Gamma",
      "Alpha",
      "Beta",
    ]);

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.plainThenPrepend({ id: "f", label: "Phi" });
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li:first-child")?.textContent).toBe("Phi");
    expect(harness.counters.bindingReads).toBeGreaterThan(1);

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.mismatchedPrepend({ id: "g", label: "Gamma 2" });
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Gamma 2",
      "Beta",
      "Alpha",
      "Gamma",
      "Epsilon",
      "Delta",
      "Phi",
    ]);
    expect(harness.counters.bindingReads).toBeGreaterThan(1);
  });

  it("keeps custom iterators, collection reads, and revoked proxies on fallback", async () => {
    const initialItems: Item[] = [{ id: "a", label: "Alpha" }];
    const harness = createPrependHarness(initialItems, true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    Object.defineProperty(initialItems, Symbol.iterator, {
      configurable: true,
      value: function* () {
        yield { id: "x", label: "Iterator row" };
      },
    });

    await act(async () => {
      harness.prepend([{ id: "b", label: "Beta" }]);
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "2: Beta",
      "2: Iterator row",
    ]);

    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    const next: Item[] = [{ id: "safe", label: "Safe" }];
    expect(() => createCompilerKeyedArrayPrepend(proxy, next)).not.toThrow();
    expect(createCompilerKeyedArrayPrepend(proxy, next)).toBe(next);
  });

  it("updates delegated event indexes after existing rows shift", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    let prepend = () => undefined;
    const calls: string[] = [];
    const Feed = createCompiledComponent({
      displayName: "PrependEventFeed",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        prepend = () =>
          state[0].set((previous) =>
            hintedPrepend(previous as Item[], [{ id: "x", label: "Extra" }]),
          );
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
              prependIndexIndependent
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
    await act(async () => root.render(<Feed />));

    await act(async () => {
      prepend();
      await flushCompilerUpdates();
    });
    await act(async () => {
      (container.querySelector('[data-row-button="b"]') as HTMLButtonElement).click();
    });
    expect(calls).toEqual(["b:2"]);
  });

  it("matches React through 2,000 deterministic prepends", async () => {
    const initialItems: Item[] = [{ id: "seed", label: "Seed" }];
    const harness = createPrependHarness(initialItems);
    let prependReact: (item: Item) => void = () => undefined;
    function Normal() {
      const [items, setItems] = useState(initialItems);
      prependReact = (item) => setItems((previous) => [item, ...previous]);
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
            <harness.Feed />
          </div>
          <Normal />
        </>,
      ),
    );

    for (let batch = 0; batch < 100; batch += 1) {
      await act(async () => {
        for (let update = 0; update < 20; update += 1) {
          const index = batch * 20 + update;
          const item = { id: `row-${index}`, label: `Value ${index}` };
          harness.prepend([item]);
          prependReact(item);
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

  it("hydrates in StrictMode and drops a queued prepend after unmount", async () => {
    const harness = createPrependHarness([{ id: "a", label: "Alpha" }]);
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
      harness.prepend([{ id: "b", label: "Beta" }]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("BetaAlpha");
    expect(recoverable).toEqual([]);

    roots.pop();
    act(() => {
      harness.prepend([{ id: "c", label: "Gamma" }]);
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
