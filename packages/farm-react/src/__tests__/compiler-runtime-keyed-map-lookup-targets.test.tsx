import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyCompilerKeyedCollectionMutation,
  createCompiledComponent,
  createCompilerKeyedCollectionUpdate,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: unknown;
  label: string;
}

interface Counters {
  bindingReads: number;
  executions: number;
  targetReads: number;
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
});

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function items(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    label: `Row ${index}`,
  }));
}

function displayLookupValue(value: unknown): unknown {
  return value ?? "none";
}

function hintedMapSet(
  previous: unknown,
  key: unknown,
  value: unknown,
): ReturnType<typeof createCompilerKeyedCollectionUpdate> {
  const next = new Map(previous as Map<unknown, unknown>);
  applyCompilerKeyedCollectionMutation(next, next.set, "map-set", key, value);
  return createCompilerKeyedCollectionUpdate(previous, next, "map");
}

function hintedMapDelete(
  previous: unknown,
  key: unknown,
): ReturnType<typeof createCompilerKeyedCollectionUpdate> {
  const next = new Map(previous as Map<unknown, unknown>);
  applyCompilerKeyedCollectionMutation(next, next.delete, "map-delete", key);
  return createCompilerKeyedCollectionUpdate(previous, next, "map");
}

function createMapLookupHarness(initialItems: Item[], initialLookup: Map<unknown, unknown>) {
  const counters: Counters = { bindingReads: 0, executions: 0, targetReads: 0 };
  let updateItems: (next: CompilerStateUpdater) => void = () => undefined;
  let updateLookup: (next: CompilerStateUpdater) => void = () => undefined;
  const Rows = createCompiledComponent({
    displayName: "MapLookupTargetRows",
    initialize: () => [initialItems, initialLookup],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const readItems = () => state[0].get() as Item[];
      const lookup = () => state[1].get() as Map<unknown, unknown>;
      const mapLookupTarget = () => {
        counters.targetReads += 1;
        return lookup();
      };
      updateItems = (next) => state[0].set(next);
      updateLookup = (next) => state[1].set(next);
      const KeyedRows = blocks.KeyedRows;
      return (
        <main>
          <KeyedRows
            bindings={[
              {
                dependencies: [1],
                mapLookupTarget: { dependency: 1, read: mapLookupTarget },
                kind: "attribute",
                name: "data-status",
                path: [],
                read: (item) => {
                  counters.bindingReads += 1;
                  return displayLookupValue(lookup().get((item as Item).id));
                },
              },
              {
                dependencies: [0],
                kind: "text",
                path: [],
                read: (item) => [(item as Item).label],
              },
            ]}
            create={(item) => ({
              kind: "element",
              tag: "li",
              attributes: [
                { name: "data-key", value: String((item as Item).id) },
                {
                  name: "data-status",
                  value: displayLookupValue(lookup().get((item as Item).id)),
                },
              ],
              styles: [],
              children: [(item as Item).label],
            })}
            id={0}
            items={readItems}
            render={() => (
              <ul>
                {readItems().map((item) => (
                  <li
                    data-key={String(item.id)}
                    data-status={displayLookupValue(lookup().get(item.id)) as string}
                    key={String(item.id)}
                  >
                    {item.label}
                  </li>
                ))}
              </ul>
            )}
            rowKey={(item) => (item as Item).id as React.Key}
            structureDependencies={[0]}
          />
        </main>
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
  });
  return {
    Rows,
    counters,
    setItems: (next: CompilerStateUpdater) => updateItems(next),
    setLookup: (next: CompilerStateUpdater) => updateLookup(next),
  };
}

function lookupSnapshot(container: Element): Array<[string | null, string | null]> {
  return [...container.querySelectorAll("li")].map((row) => [
    row.getAttribute("data-key"),
    row.getAttribute("data-status"),
  ]);
}

describe("compiled keyed Map lookup targets", () => {
  it("consumes compiler-proven Map deltas across queued setters", async () => {
    const initial = items(2_000);
    const initialLookup = new Map<unknown, unknown>(
      initial.map((item, index) => [item.id, `status-${index}`]),
    );
    const harness = createMapLookupHarness(initial, initialLookup);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    harness.counters.bindingReads = 0;
    harness.counters.targetReads = 0;
    await act(async () => {
      harness.setLookup((current) => hintedMapSet(current, "row-1500", "urgent"));
      harness.setLookup((current) => hintedMapDelete(current, "row-10"));
      harness.setLookup((current) => hintedMapSet(current, "missing", "ignored"));
      await flushCompilerUpdates();
    });

    expect(harness.counters.bindingReads).toBe(2);
    expect(harness.counters.targetReads).toBe(1);
    expect(container.querySelector('[data-key="row-10"]')?.getAttribute("data-status")).toBe(
      "none",
    );
    expect(container.querySelector('[data-key="row-1500"]')?.getAttribute("data-status")).toBe(
      "urgent",
    );
    expect(harness.counters.executions).toBe(1);
  });

  it("keeps hinted Map snapshots correct across compaction and ordinary replacements", async () => {
    const initial = items(96);
    const harness = createMapLookupHarness(initial, new Map());
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    for (let index = 0; index < 80; index += 1) {
      await act(async () => {
        harness.setLookup((current) =>
          hintedMapSet(current, `row-${index % initial.length}`, `value-${index}`),
        );
        await flushCompilerUpdates();
      });
    }
    await act(async () => {
      harness.setLookup(new Map([["row-90", "replacement"]]));
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="row-79"]')?.getAttribute("data-status")).toBe(
      "none",
    );
    expect(container.querySelector('[data-key="row-90"]')?.getAttribute("data-status")).toBe(
      "replacement",
    );
    expect(harness.counters.executions).toBe(1);
  });

  it("rejects unsafe hinted Map values before compiled binding reads", async () => {
    const harness = createMapLookupHarness(items(16), new Map());
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setLookup((current) => hintedMapSet(current, "row-8", { unsafe: true }));
      await flushCompilerUpdates();
    });

    expect(harness.counters.bindingReads).toBe(0);
    expect(container.querySelector('[data-key="row-8"]')?.getAttribute("data-status")).toBe(
      "[object Object]",
    );
  });

  it("evaluates only row keys whose mapped value changed", async () => {
    const initial = items(2_000);
    const harness = createMapLookupHarness(initial, new Map([["row-10", "ready"]]));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    harness.counters.bindingReads = 0;
    harness.counters.targetReads = 0;
    await act(async () => {
      harness.setLookup(
        new Map([
          ["row-10", "ready"],
          ["row-1500", "busy"],
        ]),
      );
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(1);
    expect(harness.counters.targetReads).toBe(1);

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setLookup(
        new Map([
          ["row-12", "ready"],
          ["row-1501", "busy"],
        ]),
      );
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(4);
    expect(container.querySelector('[data-key="row-12"]')?.getAttribute("data-status")).toBe(
      "ready",
    );
    expect(container.querySelector('[data-key="row-1501"]')?.getAttribute("data-status")).toBe(
      "busy",
    );

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setLookup(
        new Map([
          ["row-12", "ready"],
          ["row-1501", "busy"],
        ]),
      );
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(0);
    expect(harness.counters.executions).toBe(1);
  });

  it("preserves Map key equality when primitive values share a React key string", async () => {
    const initial: Item[] = [
      { id: null, label: "Null" },
      { id: undefined, label: "Undefined" },
      { id: 1, label: "Number" },
    ];
    const harness = createMapLookupHarness(
      initial,
      new Map<unknown, unknown>([
        [null, "null-value"],
        [1, "number-value"],
      ]),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setLookup(
        new Map<unknown, unknown>([
          [undefined, "undefined-value"],
          ["1", "string-value"],
        ]),
      );
      await flushCompilerUpdates();
    });

    expect(harness.counters.bindingReads).toBe(3);
    expect(lookupSnapshot(container)).toEqual([
      ["null", "none"],
      ["undefined", "undefined-value"],
      ["1", "none"],
    ]);
  });

  it("supports primitive and nullish mapped-value transitions", async () => {
    const harness = createMapLookupHarness(items(4), new Map([["row-1", false]]));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    for (const value of [0, "", null, undefined, 4n, true]) {
      harness.counters.bindingReads = 0;
      await act(async () => {
        harness.setLookup(new Map([["row-1", value]]));
        await flushCompilerUpdates();
      });
      expect(harness.counters.bindingReads).toBe(1);
      expect(container.querySelector('[data-key="row-1"]')?.getAttribute("data-status")).toBe(
        String(displayLookupValue(value)),
      );
    }
  });

  it("uses complete reconciliation for mixed structural work and refreshes its cache", async () => {
    const initial = items(100);
    const harness = createMapLookupHarness(initial, new Map([["row-1", "ready"]]));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    harness.counters.bindingReads = 0;
    harness.counters.targetReads = 0;
    await act(async () => {
      harness.setLookup(new Map([["row-80", "done"]]));
      harness.setItems((current) =>
        (current as Item[]).map((item) =>
          item.id === "row-80" ? { ...item, label: "Updated row" } : item,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(initial.length);
    expect(harness.counters.targetReads).toBe(2);
    expect(container.querySelector('[data-key="row-80"]')?.textContent).toBe("Updated row");

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setLookup(new Map([["row-81", "done"]]));
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(2);
  });

  it("hands customized Map values back to React before compiled binding reads", async () => {
    class CustomizedMap extends Map<unknown, unknown> {}
    const harness = createMapLookupHarness(items(32), new CustomizedMap([["row-1", "ready"]]));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    expect(harness.counters.bindingReads).toBe(0);
    await act(async () => {
      harness.setLookup(new CustomizedMap([["row-20", "done"]]));
      await flushCompilerUpdates();
    });

    expect(harness.counters.bindingReads).toBe(0);
    expect(container.querySelector('[data-key="row-20"]')?.getAttribute("data-status")).toBe(
      "done",
    );
    expect(harness.counters.executions).toBe(1);
  });

  it("keeps an own Map get override under React ownership", async () => {
    const customized = new Map<unknown, unknown>([["row-1", "ignored"]]);
    Object.defineProperty(customized, "get", {
      configurable: true,
      value: (value: unknown) => (value === "row-1" ? "custom" : undefined),
    });
    const harness = createMapLookupHarness(items(8), customized);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    expect(harness.counters.bindingReads).toBe(0);
    expect(container.querySelector('[data-key="row-1"]')?.getAttribute("data-status")).toBe(
      "custom",
    );
    expect(container.querySelector('[data-key="row-2"]')?.getAttribute("data-status")).toBe("none");
  });

  it("falls back for identity-bearing mapped values", async () => {
    const harness = createMapLookupHarness(items(8), new Map([["row-1", { status: "ready" }]]));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    expect(harness.counters.bindingReads).toBe(0);
    expect(container.querySelector('[data-key="row-1"]')?.getAttribute("data-status")).toBe(
      "[object Object]",
    );
  });

  it("matches React across 2,000 randomized queued updates", async () => {
    const initial = items(128);
    const harness = createMapLookupHarness(initial, new Map());
    let reactSet: React.Dispatch<React.SetStateAction<Map<unknown, unknown>>> = () => undefined;
    function Normal() {
      const [lookup, setLookup] = useState<Map<unknown, unknown>>(new Map());
      reactSet = setLookup;
      return (
        <ul>
          {initial.map((item) => (
            <li
              data-key={String(item.id)}
              data-status={displayLookupValue(lookup.get(item.id)) as string}
              key={String(item.id)}
            >
              {item.label}
            </li>
          ))}
        </ul>
      );
    }

    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = createRoot(compiledContainer);
    const reactRoot = createRoot(reactContainer);
    roots.push(compiledRoot, reactRoot);
    await act(async () => {
      compiledRoot.render(<harness.Rows />);
      reactRoot.render(<Normal />);
    });

    harness.counters.bindingReads = 0;
    let random = 0x6d6170;
    const nextRandom = () => (random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0);
    let committed = new Map<unknown, unknown>();
    for (let batch = 0; batch < 100; batch += 1) {
      let final = committed;
      await act(async () => {
        for (let update = 0; update < 20; update += 1) {
          const size = nextRandom() % 9;
          const next = new Map<unknown, unknown>();
          for (let index = 0; index < size; index += 1) {
            const value = nextRandom();
            const key = value % 13 === 0 ? `missing-${value}` : `row-${value % initial.length}`;
            next.set(key, `status-${nextRandom() % 7}`);
          }
          final = next;
          harness.setLookup(next);
          reactSet(next);
        }
        await flushCompilerUpdates();
      });
      const keys = new Set([...committed.keys(), ...final.keys()]);
      const presentChanged = [...keys].filter(
        (key) =>
          !Object.is(committed.get(key), final.get(key)) &&
          initial.some((item) => Object.is(item.id, key)),
      ).length;
      expect(harness.counters.bindingReads, `targeted reads in batch ${batch}`).toBe(
        presentChanged,
      );
      expect(lookupSnapshot(compiledContainer), `DOM after batch ${batch}`).toEqual(
        lookupSnapshot(reactContainer),
      );
      committed = final;
      harness.counters.bindingReads = 0;
    }
  });

  it("matches React across 2,000 randomized compiler-hinted Map mutations", async () => {
    const initial = items(128);
    const harness = createMapLookupHarness(initial, new Map());
    let reactSet: React.Dispatch<React.SetStateAction<Map<unknown, unknown>>> = () => undefined;
    function Normal() {
      const [lookup, setLookup] = useState<Map<unknown, unknown>>(new Map());
      reactSet = setLookup;
      return (
        <ul>
          {initial.map((item) => (
            <li
              data-key={String(item.id)}
              data-status={displayLookupValue(lookup.get(item.id)) as string}
              key={String(item.id)}
            >
              {item.label}
            </li>
          ))}
        </ul>
      );
    }

    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = createRoot(compiledContainer);
    const reactRoot = createRoot(reactContainer);
    roots.push(compiledRoot, reactRoot);
    await act(async () => {
      compiledRoot.render(<harness.Rows />);
      reactRoot.render(<Normal />);
    });

    let random = 0x6d617044;
    const nextRandom = () => (random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0);
    let committed = new Map<unknown, unknown>();
    for (let batch = 0; batch < 100; batch += 1) {
      const final = new Map(committed);
      harness.counters.bindingReads = 0;
      await act(async () => {
        for (let update = 0; update < 20; update += 1) {
          const value = nextRandom();
          const key = value % 13 === 0 ? `missing-${value}` : `row-${value % initial.length}`;
          if (value % 5 === 0) {
            final.delete(key);
            harness.setLookup((current) => hintedMapDelete(current, key));
            reactSet((current) => {
              const next = new Map(current);
              next.delete(key);
              return next;
            });
          } else {
            const status = `status-${nextRandom() % 11}`;
            final.set(key, status);
            harness.setLookup((current) => hintedMapSet(current, key, status));
            reactSet((current) => new Map(current).set(key, status));
          }
        }
        await flushCompilerUpdates();
      });
      const keys = new Set([...committed.keys(), ...final.keys()]);
      const changedRows = [...keys].filter(
        (key) =>
          (committed.has(key) !== final.has(key) ||
            !Object.is(committed.get(key), final.get(key))) &&
          initial.some((item) => Object.is(item.id, key)),
      ).length;
      expect(harness.counters.bindingReads, `hinted reads in batch ${batch}`).toBe(changedRows);
      expect(lookupSnapshot(compiledContainer), `hinted DOM after batch ${batch}`).toEqual(
        lookupSnapshot(reactContainer),
      );
      committed = final;
    }
    expect(harness.counters.executions).toBe(1);
  });

  it("is StrictMode-safe and drops a queued Map update after unmount", async () => {
    const harness = createMapLookupHarness(items(16), new Map());
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <StrictMode>
          <harness.Rows />
        </StrictMode>,
      ),
    );

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setLookup((current) => hintedMapSet(current, "row-8", "done"));
      root.unmount();
      roots.splice(roots.indexOf(root), 1);
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(0);
    expect(container.childElementCount).toBe(0);
  });

  it("adopts server rows and keeps Map lookup targeting after hydration", async () => {
    const harness = createMapLookupHarness(items(32), new Map([["row-1", "ready"]]));
    const container = document.createElement("div");
    container.innerHTML = renderToString(<harness.Rows />);
    document.body.append(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <harness.Rows />);
      await flushCompilerUpdates();
    });
    roots.push(root);

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setLookup((current) => hintedMapDelete(current, "row-1"));
      harness.setLookup((current) => hintedMapSet(current, "row-20", "done"));
      await flushCompilerUpdates();
    });

    expect(harness.counters.bindingReads).toBe(2);
    expect(container.querySelector('[data-key="row-1"]')?.getAttribute("data-status")).toBe("none");
    expect(container.querySelector('[data-key="row-20"]')?.getAttribute("data-status")).toBe(
      "done",
    );
  });
});
