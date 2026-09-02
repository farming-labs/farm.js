import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCompiledComponent,
  createCompilerKeyedArrayFilter,
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

function hintedSlice(previous: Item[], start: number, end?: number): Item[] {
  return (
    end === undefined
      ? createCompilerKeyedArraySlice(previous, previous.slice, start)
      : createCompilerKeyedArraySlice(previous, previous.slice, start, end)
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

function createSliceHarness(initialItems: Item[], readsCollection = false) {
  const counters: Counters = {
    executions: 0,
    listRenders: 0,
    keyReads: 0,
    descriptorReads: 0,
    bindingReads: 0,
  };
  let slice: (start: number, end?: number) => void = () => undefined;
  let plainThenSlice: () => void = () => undefined;
  let sliceThenFilter: () => void = () => undefined;
  let customSlice: () => void = () => undefined;
  const Feed = createCompiledComponent({
    displayName: "SliceFeed",
    initialize: () => [initialItems],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const items = () => state[0].get() as Item[];
      slice = (start, end) =>
        state[0].set((previous) => hintedSlice(previous as Item[], start, end));
      plainThenSlice = () => {
        state[0].set((previous) => [...(previous as Item[])]);
        state[0].set((previous) => hintedSlice(previous as Item[], 1));
      };
      sliceThenFilter = () => {
        state[0].set((previous) => hintedSlice(previous as Item[], 1));
        state[0].set((previous) => {
          const source = previous as Item[];
          return createCompilerKeyedArrayFilter(
            source,
            source.filter,
            (item: Item) => item.id !== "d",
          ) as Item[];
        });
      };
      customSlice = () =>
        state[0].set((previous) => {
          const source = previous as Item[];
          const method = function (this: Item[]) {
            return Array.prototype.slice.call(this, 1).reverse();
          };
          return createCompilerKeyedArraySlice(source, method, 1) as Item[];
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
              return rowDescriptor(item as Item);
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
    customSlice: () => customSlice(),
    plainThenSlice: () => plainThenSlice(),
    slice: (start: number, end?: number) => slice(start, end),
    sliceThenFilter: () => sliceThenFilter(),
  };
}

describe("compiled keyed-array slice hints", () => {
  it("preserves native runtime-bound coercion exactly once and in order", () => {
    const source = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ];
    const coercions: string[] = [];
    const start = {
      valueOf() {
        coercions.push("start");
        return 1;
      },
    };
    const end = {
      valueOf() {
        coercions.push("end");
        return 3;
      },
    };

    const result = createCompilerKeyedArraySlice(
      source,
      source.slice,
      start as unknown as number,
      end as unknown as number,
    );

    expect(result).toEqual([source[1], source[2]]);
    expect(coercions).toEqual(["start", "end"]);
  });

  it("keeps native results on complete reconciliation for unsafe or no-op runtime bounds", async () => {
    const harness = createSliceHarness(
      ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    const b = container.querySelector('[data-key="b"]');

    harness.counters.keyReads = 0;
    await act(async () => {
      harness.slice(1.5);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("BCD");
    expect(container.querySelector('[data-key="b"]')).toBe(b);
    expect(harness.counters.keyReads).toBeGreaterThan(0);

    harness.counters.keyReads = 0;
    await act(async () => {
      harness.slice(Number.NaN);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("BCD");
    expect(container.querySelector('[data-key="b"]')).toBe(b);
    expect(harness.counters.keyReads).toBeGreaterThan(0);

    harness.counters.keyReads = 0;
    await act(async () => {
      harness.slice(0);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("BCD");
    expect(container.querySelector('[data-key="b"]')).toBe(b);
    expect(harness.counters.keyReads).toBeGreaterThan(0);
    expect(harness.counters.executions).toBe(1);
  });

  it("removes a prefix without reading or rebuilding surviving rows", async () => {
    const initialItems = Array.from(
      { length: 2_048 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createSliceHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    const firstSurvivor = container.querySelector('[data-key="row-2"]');
    const middle = container.querySelector('[data-key="row-1024"]');
    const last = container.querySelector('[data-key="row-2047"]');
    harness.counters.keyReads = 0;
    harness.counters.descriptorReads = 0;
    harness.counters.bindingReads = 0;

    await act(async () => {
      harness.slice(2);
      await flushCompilerUpdates();
    });

    expect(container.querySelector("li:first-child")).toBe(firstSurvivor);
    expect(container.querySelector('[data-key="row-1024"]')).toBe(middle);
    expect(container.querySelector('[data-key="row-2047"]')).toBe(last);
    expect(container.querySelector('[data-key="row-0"]')).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2_046);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.listRenders).toBe(1);
    expect(harness.counters.keyReads).toBe(0);
    expect(harness.counters.descriptorReads).toBe(0);
    expect(harness.counters.bindingReads).toBe(0);
  });

  it("supports suffixes, middle windows, negative bounds, and queued slices", async () => {
    const harness = createSliceHarness(
      ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, label: id.toUpperCase() })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));
    const c = container.querySelector('[data-key="c"]');
    const d = container.querySelector('[data-key="d"]');

    await act(async () => {
      harness.slice(1, -1);
      harness.slice(1, -1);
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual(["C", "D"]);
    expect(container.querySelector('[data-key="c"]')).toBe(c);
    expect(container.querySelector('[data-key="d"]')).toBe(d);

    await act(async () => {
      harness.slice(-1);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("D");

    await act(async () => {
      harness.slice(99);
      await flushCompilerUpdates();
    });
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("composes with filter and rejects unhinted, custom, and collection-reading updates", async () => {
    const harness = createSliceHarness(
      ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id.toUpperCase() })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Feed />));

    harness.counters.keyReads = 0;
    await act(async () => {
      harness.sliceThenFilter();
      await flushCompilerUpdates();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "B",
      "C",
      "E",
    ]);
    expect(harness.counters.keyReads).toBe(3);

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.plainThenSlice();
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("CE");
    expect(harness.counters.bindingReads).toBeGreaterThan(0);

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.customSlice();
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("E");
    expect(harness.counters.bindingReads).toBeGreaterThan(0);

    const readingHarness = createSliceHarness(
      [
        { id: "x", label: "Ex" },
        { id: "y", label: "Why" },
      ],
      true,
    );
    const readingContainer = document.createElement("div");
    document.body.append(readingContainer);
    const readingRoot = createRoot(readingContainer);
    roots.push(readingRoot);
    await act(async () => readingRoot.render(<readingHarness.Feed />));
    await act(async () => {
      readingHarness.slice(1);
      await flushCompilerUpdates();
    });
    expect(readingContainer.textContent).toBe("1: Why");

    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    expect(() => createCompilerKeyedArraySlice(proxy, Array.prototype.slice, 1)).toThrow();
  });

  it("updates delegated event indexes after a prefix is removed", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    let trim = () => undefined;
    const calls: string[] = [];
    const Feed = createCompiledComponent({
      displayName: "SliceEventFeed",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        trim = () => state[0].set((previous) => hintedSlice(previous as Item[], 1));
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
              filterIndexIndependent
              id={0}
              items={items}
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
      trim();
      await flushCompilerUpdates();
    });
    await act(async () => {
      (container.querySelector('[data-row-button="c"]') as HTMLButtonElement).click();
    });
    expect(calls).toEqual(["c:1"]);
  });

  it("preserves a focused controlled input and its selection", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    let trim = () => undefined;
    const Feed = createCompiledComponent({
      displayName: "SliceInputFeed",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        trim = () => state[0].set((previous) => hintedSlice(previous as Item[], 1));
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
    const input = container.querySelector('[data-key="b"]') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(1, 3);

    await act(async () => {
      trim();
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="b"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  });

  it("matches React through 2,000 deterministic queued slices", async () => {
    const initialItems = Array.from(
      { length: 2_500 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createSliceHarness(initialItems);
    let sliceReact: (start: number, end?: number) => void = () => undefined;
    function Normal() {
      const [items, setItems] = useState(initialItems);
      sliceReact = (start, end) =>
        setItems((previous) =>
          end === undefined ? previous.slice(start) : previous.slice(start, end),
        );
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
          if ((batch + update) % 2 === 0) {
            harness.slice(1);
            sliceReact(1);
          } else {
            harness.slice(0, -1);
            sliceReact(0, -1);
          }
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
  }, 20_000);

  it("matches React through 1,000 randomized runtime-bound slices", async () => {
    const initialItems = Array.from(
      { length: 5_000 },
      (_, index): Item => ({ id: `random-row-${index}`, label: `Random row ${index}` }),
    );
    const harness = createSliceHarness(initialItems);
    let sliceReact: (start: number, end?: number) => void = () => undefined;
    let seed = 0x51ce;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed;
    };
    function Normal() {
      const [items, setItems] = useState(initialItems);
      sliceReact = (start, end) =>
        setItems((previous) =>
          end === undefined ? previous.slice(start) : previous.slice(start, end),
        );
      return (
        <ol data-owner="random-react">
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
          <div data-owner="random-compiled">
            <harness.Feed />
          </div>
          <Normal />
        </>,
      ),
    );

    for (let batch = 0; batch < 20; batch += 1) {
      await act(async () => {
        for (let update = 0; update < 50; update += 1) {
          const removal = 1 + (random() % 3);
          if (random() % 2 === 0) {
            harness.slice(removal);
            sliceReact(removal);
          } else {
            harness.slice(0, -removal);
            sliceReact(0, -removal);
          }
        }
        await flushCompilerUpdates();
      });
      expect(container.querySelector('[data-owner="random-compiled"]')?.textContent).toBe(
        container.querySelector('[data-owner="random-react"]')?.textContent,
      );
    }
    expect(harness.counters.executions).toBe(1);
  }, 20_000);

  it("hydrates in StrictMode and drops a queued slice after unmount", async () => {
    const harness = createSliceHarness([
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
      harness.slice(1);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("Beta");
    expect(recoverable).toEqual([]);

    roots.pop();
    act(() => {
      harness.slice(1);
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
