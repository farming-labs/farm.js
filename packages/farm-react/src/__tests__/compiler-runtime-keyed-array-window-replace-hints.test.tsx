import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponentWithFeatures,
  createCompilerKeyedArrayWindowReplace,
  keyedRowsWindowPositionHintedRuntimeFeature,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
}

type WindowArray = Item[] & {
  toSpliced(start: number, deleteCount: number, ...items: Item[]): Item[];
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
  vi.restoreAllMocks();
});

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function hintedWindowReplace(
  previous: Item[],
  position: number,
  deleteCount: number,
  items: readonly Item[],
): Item[] {
  const source = previous as WindowArray;
  return createCompilerKeyedArrayWindowReplace(
    source,
    source.toSpliced,
    position,
    deleteCount,
    ...items,
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

function createWindowHarness(initialItems: Item[]) {
  const counters = { executions: 0, renders: 0, keys: 0, descriptors: 0, bindings: 0 };
  let bindingFailure: string | undefined;
  let descriptorFailure: string | undefined;
  let bindingTrace: string[] | undefined;
  let replace: (position: number, deleteCount: number, items: readonly Item[]) => void = () =>
    undefined;
  let queueTwo: (first: readonly Item[], second: readonly Item[]) => void = () => undefined;
  let queueRefreshes: (
    firstPosition: number,
    first: readonly Item[],
    secondPosition: number,
    second: readonly Item[],
  ) => void = () => undefined;
  let queueWithUnhinted: (first: readonly Item[], second: readonly Item[]) => void = () =>
    undefined;
  let customReplace: (items: readonly Item[]) => void = () => undefined;
  const Table = createCompiledComponentWithFeatures(
    {
      displayName: "WindowReplaceTable",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        counters.executions += 1;
        const items = () => state[0].get() as Item[];
        replace = (position, deleteCount, incoming) =>
          state[0].set((previous) =>
            hintedWindowReplace(previous as Item[], position, deleteCount, incoming),
          );
        queueTwo = (first, second) => {
          state[0].set((previous) => hintedWindowReplace(previous as Item[], 1, 2, first));
          state[0].set((previous) => hintedWindowReplace(previous as Item[], 2, 1, second));
        };
        queueRefreshes = (firstPosition, first, secondPosition, second) => {
          state[0].set((previous) =>
            hintedWindowReplace(previous as Item[], firstPosition, first.length, first),
          );
          state[0].set((previous) =>
            hintedWindowReplace(previous as Item[], secondPosition, second.length, second),
          );
        };
        queueWithUnhinted = (first, second) => {
          state[0].set((previous) =>
            hintedWindowReplace(previous as Item[], 0, first.length, first),
          );
          state[0].set((previous) =>
            (previous as WindowArray).toSpliced(2, second.length, ...second),
          );
        };
        customReplace = (incoming) =>
          state[0].set((previous) => {
            const source = previous as Item[];
            const method = function (this: Item[], start: number, remove: number, ...next: Item[]) {
              return [...this.slice(0, start), ...next, ...this.slice(start + remove)].reverse();
            };
            return createCompilerKeyedArrayWindowReplace(source, method, 1, 2, ...incoming);
          });
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
                        {item.label}
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
                bindingTrace?.push(`create:${row.id}`);
                if (descriptorFailure === row.id) {
                  descriptorFailure = undefined;
                  throw new Error(`descriptor failure for ${row.id}`);
                }
                return rowDescriptor(item as Item);
              }}
              bindings={[
                {
                  kind: "text",
                  path: [],
                  read: (item) => {
                    counters.bindings += 1;
                    const row = item as Item;
                    bindingTrace?.push(`read:${row.id}`);
                    if (bindingFailure === row.id) {
                      bindingFailure = undefined;
                      throw new Error(`binding failure for ${row.id}`);
                    }
                    return [row.label];
                  },
                },
              ]}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    },
    [keyedRowsWindowPositionHintedRuntimeFeature],
  );
  return {
    Table,
    counters,
    customReplace: (items: readonly Item[]) => customReplace(items),
    failNextBindingFor: (key: string) => {
      bindingFailure = key;
    },
    failNextDescriptorFor: (key: string) => {
      descriptorFailure = key;
    },
    queueTwo: (first: readonly Item[], second: readonly Item[]) => queueTwo(first, second),
    queueRefreshes: (
      firstPosition: number,
      first: readonly Item[],
      secondPosition: number,
      second: readonly Item[],
    ) => queueRefreshes(firstPosition, first, secondPosition, second),
    queueWithUnhinted: (first: readonly Item[], second: readonly Item[]) =>
      queueWithUnhinted(first, second),
    replace: (position: number, deleteCount: number, items: readonly Item[]) =>
      replace(position, deleteCount, items),
    traceBindings: (trace: string[] | undefined) => {
      bindingTrace = trace;
    },
  };
}

describe("compiled keyed-array window replacement hints", () => {
  it("preserves native method arguments, return values, and errors", () => {
    const source = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ];
    const first = { id: "c", label: "Gamma" };
    const second = { id: "d", label: "Delta" };
    const calls: unknown[][] = [];
    const custom = function (this: Item[], ...args: unknown[]) {
      calls.push([this, ...args]);
      return { custom: true };
    };

    expect(createCompilerKeyedArrayWindowReplace(source, custom, -1, 9, first, second)).toEqual({
      custom: true,
    });
    expect(calls).toEqual([[source, -1, 9, first, second]]);

    const error = new Error("custom window failure");
    expect(() =>
      createCompilerKeyedArrayWindowReplace(
        source,
        () => {
          throw error;
        },
        0,
        1,
        first,
      ),
    ).toThrow(error);
  });

  it("replaces one exact window without reading or replacing retained rows", async () => {
    const initialItems = Array.from(
      { length: 4_096 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const before = container.querySelector('[data-key="row-2047"]');
    const firstRemoved = container.querySelector('[data-key="row-2048"]');
    const lastRemoved = container.querySelector('[data-key="row-2111"]');
    const after = container.querySelector('[data-key="row-2112"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;
    const incoming = Array.from(
      { length: 64 },
      (_, index): Item => ({ id: `replace-${index}`, label: `Replace ${index}` }),
    );

    await act(async () => {
      harness.replace(2_048, 64, incoming);
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll("li")];
    expect(rows[2_047]).toBe(before);
    expect(rows[2_048]?.textContent).toBe("Replace 0");
    expect(rows[2_111]?.textContent).toBe("Replace 63");
    expect(rows[2_112]).toBe(after);
    expect(firstRemoved?.isConnected).toBe(false);
    expect(lastRemoved?.isConnected).toBe(false);
    expect(rows).toHaveLength(4_096);
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 64,
      descriptors: 64,
      bindings: 64,
    });
  });

  it("refreshes a same-key exact window without descriptors or DOM replacement", async () => {
    const initialItems = Array.from(
      { length: 4_096 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const before = container.querySelector('[data-key="row-2047"]');
    const refreshed = Array.from({ length: 64 }, (_, offset) =>
      container.querySelector(`[data-key="row-${2_048 + offset}"]`),
    );
    const after = container.querySelector('[data-key="row-2112"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;
    const incoming = initialItems.slice(2_048, 2_112).map((item, index) => ({
      ...item,
      label: `Refreshed ${index}`,
    }));

    await act(async () => {
      harness.replace(2_048, 64, incoming);
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll("li")];
    expect(rows[2_047]).toBe(before);
    for (let offset = 0; offset < 64; offset += 1) {
      expect(rows[2_048 + offset]).toBe(refreshed[offset]);
      expect(rows[2_048 + offset]?.textContent).toBe(`Refreshed ${offset}`);
    }
    expect(rows[2_112]).toBe(after);
    expect(rows).toHaveLength(4_096);
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 64,
      descriptors: 0,
      bindings: 64,
    });
  });

  it("combines queued same-key windows without descriptors or DOM replacement", async () => {
    const initialItems = Array.from(
      { length: 4_096 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const firstRows = Array.from({ length: 32 }, (_, offset) =>
      container.querySelector(`[data-key="row-${1_024 + offset}"]`),
    );
    const secondRows = Array.from({ length: 32 }, (_, offset) =>
      container.querySelector(`[data-key="row-${3_072 + offset}"]`),
    );
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.queueRefreshes(
        1_024,
        initialItems.slice(1_024, 1_056).map((item, offset) => ({
          ...item,
          label: `First ${offset}`,
        })),
        3_072,
        initialItems.slice(3_072, 3_104).map((item, offset) => ({
          ...item,
          label: `Second ${offset}`,
        })),
      );
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll("li")];
    for (let offset = 0; offset < 32; offset += 1) {
      expect(rows[1_024 + offset]).toBe(firstRows[offset]);
      expect(rows[1_024 + offset]?.textContent).toBe(`First ${offset}`);
      expect(rows[3_072 + offset]).toBe(secondRows[offset]);
      expect(rows[3_072 + offset]?.textContent).toBe(`Second ${offset}`);
    }
    expect(rows).toHaveLength(4_096);
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 64,
      descriptors: 0,
      bindings: 64,
    });
  });

  it("collapses overlapping queued refreshes and applies the last value", async () => {
    const initialItems = Array.from(
      { length: 128 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const retained = Array.from({ length: 72 }, (_, offset) =>
      container.querySelector(`[data-key="row-${32 + offset}"]`),
    );
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.queueRefreshes(
        32,
        initialItems.slice(32, 80).map((item) => ({ ...item, label: `First ${item.id}` })),
        56,
        initialItems.slice(56, 104).map((item) => ({ ...item, label: `Second ${item.id}` })),
      );
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll("li")];
    for (let offset = 0; offset < 72; offset += 1) {
      const index = 32 + offset;
      expect(rows[index]).toBe(retained[offset]);
      expect(rows[index]?.textContent).toBe(
        index < 56 ? `First row-${index}` : `Second row-${index}`,
      );
    }
    expect(harness.counters.keys).toBe(72);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(72);
  });

  it("prepares the complete same-key window before committing any binding", async () => {
    const harness = createWindowHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const trace: string[] = [];
    const textContent = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    vi.spyOn(Node.prototype, "textContent", "set").mockImplementation(function (
      this: Node,
      value: string | null,
    ) {
      trace.push(`write:${value}`);
      textContent.set!.call(this, value);
    });
    harness.traceBindings(trace);
    harness.failNextBindingFor("b");

    await act(async () => {
      harness.replace(0, 3, [
        { id: "a", label: "Alpha refreshed" },
        { id: "b", label: "Beta refreshed" },
        { id: "c", label: "Gamma refreshed" },
      ]);
      await flushCompilerUpdates();
    });

    const failedRead = trace.indexOf("read:b");
    const firstWrite = trace.findIndex((entry) => entry.startsWith("write:"));
    expect(failedRead).toBeGreaterThanOrEqual(0);
    expect(firstWrite === -1 || firstWrite > failedRead).toBe(true);
    expect(container.textContent).toBe("Alpha refreshedBeta refreshedGamma refreshed");
  });

  it("prepares every queued window before committing any binding", async () => {
    const harness = createWindowHarness([
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
    const trace: string[] = [];
    const textContent = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    vi.spyOn(Node.prototype, "textContent", "set").mockImplementation(function (
      this: Node,
      value: string | null,
    ) {
      trace.push(`write:${value}`);
      textContent.set!.call(this, value);
    });
    harness.traceBindings(trace);
    harness.failNextBindingFor("c");

    await act(async () => {
      harness.queueRefreshes(
        0,
        [
          { id: "a", label: "Alpha queued" },
          { id: "b", label: "Beta queued" },
        ],
        2,
        [
          { id: "c", label: "Gamma queued" },
          { id: "d", label: "Delta queued" },
        ],
      );
      await flushCompilerUpdates();
    });

    const failedRead = trace.indexOf("read:c");
    const firstWrite = trace.findIndex((entry) => entry.startsWith("write:"));
    expect(failedRead).toBeGreaterThanOrEqual(0);
    expect(firstWrite === -1 || firstWrite > failedRead).toBe(true);
    expect(container.textContent).toBe("Alpha queuedBeta queuedGamma queuedDelta queued");
  });

  it("prepares every queued fresh row before replacing the first DOM row", async () => {
    const harness = createWindowHarness([
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
    const trace: string[] = [];
    const replaceWith = Element.prototype.replaceWith;
    vi.spyOn(Element.prototype, "replaceWith").mockImplementation(function (
      this: Element,
      ...nodes: (Node | string)[]
    ) {
      trace.push(`replace:${this.getAttribute("data-key")}`);
      replaceWith.call(this, ...nodes);
    });
    harness.traceBindings(trace);
    harness.failNextDescriptorFor("f");

    await act(async () => {
      harness.queueRefreshes(0, [{ id: "e", label: "Epsilon" }], 2, [{ id: "f", label: "Phi" }]);
      await flushCompilerUpdates();
    });

    const failedCreate = trace.indexOf("create:f");
    const firstReplace = trace.findIndex((entry) => entry.startsWith("replace:"));
    expect(failedCreate).toBeGreaterThanOrEqual(0);
    expect(firstReplace === -1 || firstReplace > failedCreate).toBe(true);
    expect(container.textContent).toBe("EpsilonBetaPhiDelta");
  });

  it("prepares every overlapping final row before replacing the first DOM row", async () => {
    const harness = createWindowHarness([
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
    const trace: string[] = [];
    const replaceWith = Element.prototype.replaceWith;
    vi.spyOn(Element.prototype, "replaceWith").mockImplementation(function (
      this: Element,
      ...nodes: (Node | string)[]
    ) {
      trace.push(`replace:${this.getAttribute("data-key")}`);
      replaceWith.call(this, ...nodes);
    });
    harness.traceBindings(trace);
    harness.failNextDescriptorFor("h");

    await act(async () => {
      harness.queueRefreshes(
        0,
        [
          { id: "e", label: "Epsilon" },
          { id: "f", label: "Intermediate Phi" },
        ],
        1,
        [
          { id: "g", label: "Gamma replacement" },
          { id: "h", label: "Eta" },
        ],
      );
      await flushCompilerUpdates();
    });

    const failedCreate = trace.indexOf("create:h");
    const firstReplace = trace.findIndex((entry) => entry.startsWith("replace:"));
    expect(failedCreate).toBeGreaterThanOrEqual(0);
    expect(firstReplace === -1 || firstReplace > failedCreate).toBe(true);
    expect(container.textContent).toBe("EpsilonGamma replacementEtaDelta");
  });

  it("supports empty incoming spreads, negative positions, and clamped delete counts", async () => {
    const harness = createWindowHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
      { id: "e", label: "Epsilon" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const alpha = container.querySelector('[data-key="a"]');
    const beta = container.querySelector('[data-key="b"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.replace(-3, 99, []);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("AlphaBeta");
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(harness.counters.keys).toBe(0);
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.bindings).toBe(0);
  });

  it("reuses, reorders, and creates only rows inside one fixed-length window", async () => {
    const initialItems = Array.from(
      { length: 4_096 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const rows = [...container.querySelectorAll("li")];
    const list = container.querySelector("ul")!;
    const insertBefore = vi.spyOn(list, "insertBefore");
    const position = 1_024;
    const retained = initialItems.slice(position, position + 48).reverse();
    const fresh = Array.from(
      { length: 16 },
      (_, offset): Item => ({ id: `fresh-${offset}`, label: `Fresh ${offset}` }),
    );
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.replace(position, 64, [...retained, ...fresh]);
      await flushCompilerUpdates();
    });

    const nextRows = [...container.querySelectorAll("li")];
    expect(nextRows).toHaveLength(4_096);
    expect(nextRows[position - 1]).toBe(rows[position - 1]);
    expect(nextRows[position + 64]).toBe(rows[position + 64]);
    for (let offset = 0; offset < retained.length; offset += 1) {
      expect(nextRows[position + offset]).toBe(rows[position + 47 - offset]);
      expect(nextRows[position + offset]?.textContent).toBe(retained[offset].label);
    }
    for (let offset = 48; offset < 64; offset += 1) {
      expect(rows[position + offset]?.isConnected).toBe(false);
      expect(nextRows[position + offset]?.getAttribute("data-key")).toBe(`fresh-${offset - 48}`);
    }
    expect(insertBefore).toHaveBeenCalledTimes(48);
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 64,
      descriptors: 16,
      bindings: 64,
    });
  }, 15_000);

  it("prepares a mixed local window before the first structural DOM write", async () => {
    const harness = createWindowHarness([
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
    const list = container.querySelector("ul")!;
    const trace: string[] = [];
    const insertBefore = list.insertBefore.bind(list);
    vi.spyOn(list, "insertBefore").mockImplementation((node, child) => {
      trace.push("dom:insert");
      return insertBefore(node, child);
    });
    const remove = Element.prototype.remove;
    vi.spyOn(Element.prototype, "remove").mockImplementation(function (this: Element) {
      trace.push(`dom:remove:${this.getAttribute("data-key")}`);
      remove.call(this);
    });
    harness.traceBindings(trace);
    harness.failNextDescriptorFor("e");

    await act(async () => {
      harness.replace(1, 2, [
        { id: "c", label: "Gamma retained" },
        { id: "e", label: "Epsilon" },
      ]);
      await flushCompilerUpdates();
    });

    const failedCreate = trace.indexOf("create:e");
    const firstDomWrite = trace.findIndex((entry) => entry.startsWith("dom:"));
    expect(failedCreate).toBeGreaterThanOrEqual(0);
    expect(firstDomWrite).toBeGreaterThan(failedCreate);
    expect(container.textContent).toBe("AlphaGamma retainedEpsilonDelta");
  });

  it("takes complete reconciliation for duplicate or outside-window reused keys", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createWindowHarness([
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
    harness.counters.keys = 0;

    await act(async () => {
      harness.replace(1, 2, [
        { id: "a", label: "Alpha duplicated" },
        { id: "e", label: "Epsilon" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("AlphaAlpha duplicatedEpsilonDelta");
    expect(container.querySelectorAll('[data-key="a"]')).toHaveLength(2);
    expect(harness.counters.keys).toBeGreaterThan(2);

    harness.counters.keys = 0;
    await act(async () => {
      harness.replace(1, 2, [
        { id: "f", label: "Phi one" },
        { id: "f", label: "Phi two" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("AlphaPhi onePhi twoDelta");
    expect(harness.counters.keys).toBeGreaterThan(2);
    expect(console.error).toHaveBeenCalled();
  });

  it("falls back for custom methods and queued structural window changes", async () => {
    const harness = createWindowHarness([
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
      harness.customReplace([
        { id: "e", label: "Epsilon" },
        { id: "f", label: "Phi" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("DeltaPhiEpsilonAlpha");

    await act(async () => {
      harness.queueTwo(
        [
          { id: "g", label: "Gamma two" },
          { id: "h", label: "Eta" },
        ],
        [
          { id: "i", label: "Iota" },
          { id: "j", label: "Jota" },
        ],
      );
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("DeltaGamma twoIotaJotaAlpha");
  });

  it("replaces disjoint queued fresh-key windows without scanning untouched rows", async () => {
    const initialItems = Array.from(
      { length: 4_096 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const rows = [...container.querySelectorAll("li")];
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.queueRefreshes(
        1_024,
        Array.from(
          { length: 32 },
          (_, offset): Item => ({ id: `first-${offset}`, label: `First ${offset}` }),
        ),
        3_072,
        Array.from(
          { length: 32 },
          (_, offset): Item => ({ id: `second-${offset}`, label: `Second ${offset}` }),
        ),
      );
      await flushCompilerUpdates();
    });

    const nextRows = [...container.querySelectorAll("li")];
    expect(nextRows).toHaveLength(4_096);
    for (let index = 0; index < nextRows.length; index += 1) {
      if ((index >= 1_024 && index < 1_056) || (index >= 3_072 && index < 3_104)) {
        expect(nextRows[index]).not.toBe(rows[index]);
        expect(rows[index]?.isConnected).toBe(false);
      } else {
        expect(nextRows[index]).toBe(rows[index]);
      }
    }
    expect(nextRows[1_024]?.getAttribute("data-key")).toBe("first-0");
    expect(nextRows[3_103]?.textContent).toBe("Second 31");
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 64,
      descriptors: 64,
      bindings: 64,
    });
  });

  it("patches and replaces disjoint rows in one queued commit", async () => {
    const harness = createWindowHarness([
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
    const alpha = container.querySelector('[data-key="a"]');
    const beta = container.querySelector('[data-key="b"]');
    const gamma = container.querySelector('[data-key="c"]');
    const delta = container.querySelector('[data-key="d"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.queueRefreshes(0, [{ id: "a", label: "Alpha refreshed" }], 2, [
        { id: "f", label: "Phi" },
      ]);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("Alpha refreshedBetaPhiDelta");
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(container.querySelector('[data-key="c"]')).not.toBe(gamma);
    expect(gamma?.isConnected).toBe(false);
    expect(container.querySelector('[data-key="d"]')).toBe(delta);
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 2,
      descriptors: 1,
      bindings: 2,
    });
  });

  it("replaces overlapping queued fresh-key windows without scanning untouched rows", async () => {
    const initialItems = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ];
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const alpha = container.querySelector('[data-key="a"]');
    const beta = container.querySelector('[data-key="b"]');
    const gamma = container.querySelector('[data-key="c"]');
    const delta = container.querySelector('[data-key="d"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.queueRefreshes(
        0,
        [
          { id: "e", label: "Epsilon" },
          { id: "f", label: "Intermediate Phi" },
        ],
        1,
        [{ id: "g", label: "Gamma replacement" }],
      );
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("EpsilonGamma replacementGammaDelta");
    expect(container.querySelector('[data-key="e"]')).not.toBe(alpha);
    expect(container.querySelector('[data-key="g"]')).not.toBe(beta);
    expect(container.querySelector('[data-key="f"]')).toBeNull();
    expect(alpha?.isConnected).toBe(false);
    expect(beta?.isConnected).toBe(false);
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(container.querySelector('[data-key="d"]')).toBe(delta);
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 2,
      descriptors: 2,
      bindings: 2,
    });
  });

  it("preserves a committed row when a later overlap restores its key", async () => {
    const initialItems = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const alpha = container.querySelector('[data-key="a"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.queueRefreshes(0, [{ id: "intermediate", label: "Intermediate" }], 0, [
        { id: "a", label: "Alpha restored" },
      ]);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("Alpha restoredBetaGamma");
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="intermediate"]')).toBeNull();
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 1,
      descriptors: 0,
      bindings: 1,
    });
  });

  it("validates the final keys instead of an uncommitted overlapping identity", async () => {
    const initialItems = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ];
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    const gamma = container.querySelector('[data-key="c"]');
    const delta = container.querySelector('[data-key="d"]');
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;

    await act(async () => {
      harness.queueRefreshes(
        0,
        [initialItems[2], { id: "intermediate", label: "Intermediate" }],
        0,
        [
          { id: "e", label: "Epsilon" },
          { id: "f", label: "Phi" },
        ],
      );
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("EpsilonPhiGammaDelta");
    expect(container.querySelectorAll('[data-key="c"]')).toHaveLength(1);
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(container.querySelector('[data-key="d"]')).toBe(delta);
    expect(container.querySelector('[data-key="intermediate"]')).toBeNull();
    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 2,
      descriptors: 2,
      bindings: 2,
    });
  });

  it("falls back for queued existing-key moves", async () => {
    const initialItems = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ];
    const harness = createWindowHarness(initialItems);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Table />));
    harness.counters.keys = 0;

    await act(async () => {
      harness.queueRefreshes(0, [initialItems[2]], 2, [initialItems[0]]);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("GammaBetaAlphaDelta");
    expect(harness.counters.keys).toBeGreaterThan(2);
  });

  it("falls back when an unhinted update breaks the queued chain", async () => {
    const harness = createWindowHarness([
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
    const rows = [...container.querySelectorAll("li")];
    harness.counters.keys = 0;

    await act(async () => {
      harness.queueWithUnhinted(
        [{ id: "a", label: "Alpha refreshed" }],
        [{ id: "c", label: "Gamma refreshed" }],
      );
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("Alpha refreshedBetaGamma refreshedDelta");
    [...container.querySelectorAll("li")].forEach((row, index) => expect(row).toBe(rows[index]));
    expect(harness.counters.keys).toBe(4);
  });

  it("preserves controlled-input focus and delegated indexes across the window", async () => {
    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ];
    const calls: string[] = [];
    let replace = () => undefined;
    let refresh = () => undefined;
    let reuse = () => undefined;
    const InteractiveRows = createCompiledComponentWithFeatures(
      {
        displayName: "WindowInteractiveRows",
        initialize: () => [initialItems],
        render(_props: Record<string, never>, state, blocks) {
          const items = () => state[0].get() as Item[];
          replace = () =>
            state[0].set((previous) =>
              hintedWindowReplace(previous as Item[], 1, 2, [{ id: "e", label: "Epsilon" }]),
            );
          refresh = () => {
            state[0].set((previous) =>
              hintedWindowReplace(previous as Item[], 1, 1, [{ id: "f", label: "Phi refreshed" }]),
            );
            state[0].set((previous) =>
              hintedWindowReplace(previous as Item[], 2, 1, [
                { id: "d", label: "Delta refreshed" },
              ]),
            );
          };
          reuse = () =>
            state[0].set((previous) =>
              hintedWindowReplace(previous as Item[], 1, 2, [
                { id: "c", label: "Gamma moved" },
                { id: "b", label: "Beta moved" },
              ]),
            );
          return (
            <main>
              <blocks.KeyedRows
                collectionDependency={0}
                delegateEvents
                dependencies={[0]}
                events={[
                  {
                    invoke: (item, index) =>
                      calls.push(`${(item as Item).id}:${(item as Item).label}:${index}`),
                    name: "onClick",
                    path: [1],
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
                        <input aria-label={`Edit ${item.id}`} value={item.label} readOnly />
                        <button data-row-button={item.id} onClick={event(item, index, 0)}>
                          Select {item.label}
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
                        tag: "input",
                        attributes: [
                          { name: "aria-label", value: `Edit ${row.id}` },
                          { name: "value", value: row.label },
                          { name: "readOnly", value: true },
                        ],
                        styles: [],
                        children: [],
                      },
                      {
                        kind: "element",
                        tag: "button",
                        attributes: [{ name: "data-row-button", value: row.id }],
                        styles: [],
                        children: [`Select ${row.label}`],
                      },
                    ],
                  };
                }}
                bindings={[
                  {
                    kind: "attribute",
                    name: "value",
                    path: [0],
                    read: (item) => (item as Item).label,
                  },
                  {
                    kind: "text",
                    path: [1],
                    read: (item) => ["Select ", (item as Item).label],
                  },
                ]}
              />
            </main>
          );
        },
        bindings: [{ kind: "block", id: 0, dependencies: [0] }],
      },
      [keyedRowsWindowPositionHintedRuntimeFeature],
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<InteractiveRows />));
    const betaRow = container.querySelector('[data-key="b"]');
    const gammaRow = container.querySelector('[data-key="c"]');
    const gammaInput = container.querySelector('[aria-label="Edit c"]') as HTMLInputElement;
    gammaInput.focus();
    gammaInput.setSelectionRange(1, 3);

    await act(async () => {
      reuse();
      await flushCompilerUpdates();
    });
    expect(
      [...container.querySelectorAll("li")].map((row) => row.getAttribute("data-key")),
    ).toEqual(["a", "c", "b", "d"]);
    expect(container.querySelector('[data-key="c"]')).toBe(gammaRow);
    expect(container.querySelector('[data-key="b"]')).toBe(betaRow);
    expect(container.querySelector('[aria-label="Edit c"]')).toBe(gammaInput);
    expect(gammaInput.value).toBe("Gamma moved");
    expect(document.activeElement).toBe(gammaInput);
    expect([gammaInput.selectionStart, gammaInput.selectionEnd]).toEqual([1, 3]);
    await act(async () => {
      (container.querySelector('[data-row-button="c"]') as HTMLButtonElement).click();
      (container.querySelector('[data-row-button="b"]') as HTMLButtonElement).click();
    });
    expect(calls).toEqual(["c:Gamma moved:1", "b:Beta moved:2"]);
    calls.length = 0;

    const input = container.querySelector('[aria-label="Edit d"]') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(1, 3);

    await act(async () => {
      replace();
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[aria-label="Edit d"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
    const epsilonRow = container.querySelector('[data-key="e"]');
    const deltaRow = container.querySelector('[data-key="d"]');

    await act(async () => {
      refresh();
      await flushCompilerUpdates();
    });
    expect(epsilonRow?.isConnected).toBe(false);
    expect(container.querySelector('[data-key="f"]')).not.toBe(epsilonRow);
    expect(container.querySelector('[data-key="d"]')).toBe(deltaRow);
    expect(container.querySelector('[aria-label="Edit d"]')).toBe(input);
    expect(input.value).toBe("Delta refreshed");
    expect(container.querySelector('[data-row-button="f"]')?.textContent).toBe(
      "Select Phi refreshed",
    );
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);

    await act(async () => {
      (container.querySelector('[data-row-button="f"]') as HTMLButtonElement).click();
      (container.querySelector('[data-row-button="d"]') as HTMLButtonElement).click();
    });
    expect(calls).toEqual(["f:Phi refreshed:1", "d:Delta refreshed:2"]);
  });

  it("matches normal React through 1,000 deterministic bounded replacements", async () => {
    const initialItems = Array.from(
      { length: 24 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    let replaceReact: (position: number, count: number, incoming: readonly Item[]) => void = () =>
      undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      replaceReact = (position, count, incoming) =>
        setItems((previous) => (previous as WindowArray).toSpliced(position, count, ...incoming));
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

    // Each cycle performs and verifies two replacements. Even cycles refresh
    // the same keys in place; odd cycles replace fresh keys. Their matching
    // restorations exercise both paths again for 1,000 differential updates.
    for (let step = 0; step < 500; step += 1) {
      const count = (step % 5) + 1;
      const position = (step * 37) % (initialItems.length - count + 1);
      const incoming =
        step % 2 === 0
          ? initialItems.slice(position, position + count).map((item, offset) => ({
              ...item,
              label: `Refresh ${step}.${offset}`,
            }))
          : Array.from(
              { length: (step % 4) + 1 },
              (_, offset): Item => ({
                id: `replace-${step}-${offset}`,
                label: `Replace ${step}.${offset}`,
              }),
            );
      const removed = initialItems.slice(position, position + count);
      await act(async () => {
        harness.replace(position, count, incoming);
        replaceReact(position, count, incoming);
        await flushCompilerUpdates();
      });
      expect(compiledContainer.querySelector("ul")?.textContent).toBe(
        reactContainer.querySelector("ol")?.textContent,
      );
      await act(async () => {
        harness.replace(position, incoming.length, removed);
        replaceReact(position, incoming.length, removed);
        await flushCompilerUpdates();
      });
      expect(compiledContainer.querySelector("ul")?.textContent).toBe(
        reactContainer.querySelector("ol")?.textContent,
      );
    }
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
  }, 15_000);

  it("matches React through 1,000 randomized window-local reuse and reorder updates", async () => {
    const initialItems = Array.from(
      { length: 64 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    let replaceReact: (position: number, count: number, incoming: readonly Item[]) => void = () =>
      undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      replaceReact = (position, count, incoming) =>
        setItems((previous) => (previous as WindowArray).toSpliced(position, count, ...incoming));
      return (
        <ol>
          {items.map((item) => (
            <li data-key={item.id} key={item.id}>
              {item.label}
            </li>
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
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;
    let expected = initialItems;
    let expectedFresh = 0;
    let expectedWork = 0;
    let random = 0x6b31_9f25;
    const nextRandom = () => {
      random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
      return random;
    };

    for (let step = 0; step < 1_000; step += 1) {
      const count = (nextRandom() % 8) + 2;
      const position = nextRandom() % (expected.length - count + 1);
      const previousWindow = expected.slice(position, position + count);
      const shuffled = [...previousWindow];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const target = nextRandom() % (index + 1);
        [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
      }
      let freshCount = 0;
      const incoming = shuffled.map((item, offset): Item => {
        if (offset === 1 || (offset > 1 && nextRandom() % 3 === 0)) {
          freshCount += 1;
          return {
            id: `fresh-${step}-${offset}`,
            label: `Fresh ${step}.${offset}`,
          };
        }
        return { ...item, label: `Reuse ${step}.${offset}` };
      });
      const beforeRows = [...compiledContainer.querySelectorAll("li")];
      const previousRowsByKey = new Map(
        previousWindow.map((item, offset) => [item.id, beforeRows[position + offset]]),
      );
      const incomingKeys = new Set(incoming.map((item) => item.id));
      expected = (expected as WindowArray).toSpliced(position, count, ...incoming);
      expectedFresh += freshCount;
      expectedWork += count;

      await act(async () => {
        harness.replace(position, count, incoming);
        replaceReact(position, count, incoming);
        await flushCompilerUpdates();
      });

      expect(compiledContainer.querySelector("ul")?.textContent).toBe(
        reactContainer.querySelector("ol")?.textContent,
      );
      const nextRows = [...compiledContainer.querySelectorAll("li")];
      if (position > 0) expect(nextRows[position - 1]).toBe(beforeRows[position - 1]);
      if (position + count < nextRows.length) {
        expect(nextRows[position + count]).toBe(beforeRows[position + count]);
      }
      incoming.forEach((item, offset) => {
        const previousRow = previousRowsByKey.get(item.id);
        if (previousRow) expect(nextRows[position + offset]).toBe(previousRow);
        else expect([...previousRowsByKey.values()]).not.toContain(nextRows[position + offset]);
      });
      previousWindow.forEach((item) => {
        if (!incomingKeys.has(item.id)) {
          expect(previousRowsByKey.get(item.id)?.isConnected).toBe(false);
        }
      });
    }

    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: expectedWork,
      descriptors: expectedFresh,
      bindings: expectedWork,
    });
  }, 30_000);

  it("matches normal React through 1,000 queued same-key window refreshes", async () => {
    const initialItems = Array.from(
      { length: 64 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    let queueReact: (
      firstPosition: number,
      first: readonly Item[],
      secondPosition: number,
      second: readonly Item[],
    ) => void = () => undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      queueReact = (firstPosition, first, secondPosition, second) => {
        setItems((previous) =>
          (previous as WindowArray).toSpliced(firstPosition, first.length, ...first),
        );
        setItems((previous) =>
          (previous as WindowArray).toSpliced(secondPosition, second.length, ...second),
        );
      };
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
    const retainedRows = [...compiledContainer.querySelectorAll("li")];
    harness.counters.descriptors = 0;
    let expected = initialItems;
    let random = 0x52f1_4a8d;
    const nextRandom = () => {
      random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
      return random;
    };

    for (let step = 0; step < 500; step += 1) {
      const firstCount = (nextRandom() % 8) + 1;
      const firstPosition = nextRandom() % (expected.length - firstCount + 1);
      const first = expected
        .slice(firstPosition, firstPosition + firstCount)
        .map((item, offset) => ({
          ...item,
          label: `First ${step}.${offset}`,
        }));
      const afterFirst = (expected as WindowArray).toSpliced(firstPosition, firstCount, ...first);
      const secondCount = (nextRandom() % 8) + 1;
      const secondPosition = nextRandom() % (afterFirst.length - secondCount + 1);
      const second = afterFirst
        .slice(secondPosition, secondPosition + secondCount)
        .map((item, offset) => ({ ...item, label: `Second ${step}.${offset}` }));
      expected = (afterFirst as WindowArray).toSpliced(secondPosition, secondCount, ...second);

      await act(async () => {
        harness.queueRefreshes(firstPosition, first, secondPosition, second);
        queueReact(firstPosition, first, secondPosition, second);
        await flushCompilerUpdates();
      });
      expect(compiledContainer.querySelector("ul")?.textContent).toBe(
        reactContainer.querySelector("ol")?.textContent,
      );
    }

    const finalRows = [...compiledContainer.querySelectorAll("li")];
    expect(finalRows).toHaveLength(retainedRows.length);
    finalRows.forEach((row, index) => expect(row).toBe(retainedRows[index]));
    expect(harness.counters.descriptors).toBe(0);
    expect(harness.counters.executions).toBe(1);
    expect(harness.counters.renders).toBe(1);
  }, 15_000);

  it("matches React through 1,000 queued mixed fresh-key and same-key replacements", async () => {
    const initialItems = Array.from(
      { length: 64 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    let queueReact: (
      firstPosition: number,
      first: readonly Item[],
      secondPosition: number,
      second: readonly Item[],
    ) => void = () => undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      queueReact = (firstPosition, first, secondPosition, second) => {
        setItems((previous) =>
          (previous as WindowArray).toSpliced(firstPosition, first.length, ...first),
        );
        setItems((previous) =>
          (previous as WindowArray).toSpliced(secondPosition, second.length, ...second),
        );
      };
      return (
        <ol>
          {items.map((item) => (
            <li data-key={item.id} key={item.id}>
              {item.label}
            </li>
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
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;
    let expected = initialItems;
    let random = 0xa17e_39b5;
    const nextRandom = () => {
      random = (Math.imul(random, 1_103_515_245) + 12_345) >>> 0;
      return random;
    };

    for (let step = 0; step < 500; step += 1) {
      const firstPosition = nextRandom() % expected.length;
      let secondPosition = nextRandom() % expected.length;
      if (secondPosition === firstPosition) secondPosition = (secondPosition + 1) % expected.length;
      const firstPrevious = expected[firstPosition];
      const secondPrevious = expected[secondPosition];
      const firstElement = compiledContainer.querySelector(`[data-key="${firstPrevious.id}"]`);
      const secondElement = compiledContainer.querySelector(`[data-key="${secondPrevious.id}"]`);
      const first: Item[] = [{ id: `fresh-${step}`, label: `Fresh ${step}` }];
      const second: Item[] = [{ ...secondPrevious, label: `Refresh ${step}` }];
      const afterFirst = (expected as WindowArray).toSpliced(firstPosition, 1, ...first);
      expected = (afterFirst as WindowArray).toSpliced(secondPosition, 1, ...second);

      await act(async () => {
        harness.queueRefreshes(firstPosition, first, secondPosition, second);
        queueReact(firstPosition, first, secondPosition, second);
        await flushCompilerUpdates();
      });

      expect(compiledContainer.querySelector("ul")?.textContent).toBe(
        reactContainer.querySelector("ol")?.textContent,
      );
      expect(firstElement?.isConnected).toBe(false);
      expect(compiledContainer.querySelector(`[data-key="fresh-${step}"]`)).not.toBe(firstElement);
      expect(compiledContainer.querySelector(`[data-key="${secondPrevious.id}"]`)).toBe(
        secondElement,
      );
    }

    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: 1_000,
      descriptors: 500,
      bindings: 1_000,
    });
  }, 15_000);

  it("matches React through 1,000 queued overlapping fresh-key replacements", async () => {
    const initialItems = Array.from(
      { length: 64 },
      (_, index): Item => ({ id: `row-${index}`, label: `Row ${index}` }),
    );
    const harness = createWindowHarness(initialItems);
    let queueReact: (
      firstPosition: number,
      first: readonly Item[],
      secondPosition: number,
      second: readonly Item[],
    ) => void = () => undefined;
    function NormalTable() {
      const [items, setItems] = useState(initialItems);
      queueReact = (firstPosition, first, secondPosition, second) => {
        setItems((previous) =>
          (previous as WindowArray).toSpliced(firstPosition, first.length, ...first),
        );
        setItems((previous) =>
          (previous as WindowArray).toSpliced(secondPosition, second.length, ...second),
        );
      };
      return (
        <ol>
          {items.map((item) => (
            <li data-key={item.id} key={item.id}>
              {item.label}
            </li>
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
    harness.counters.keys = 0;
    harness.counters.descriptors = 0;
    harness.counters.bindings = 0;
    let expected = initialItems;
    let touchedRows = 0;
    let random = 0x8d31_b70f;
    const nextRandom = () => {
      random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
      return random;
    };

    for (let step = 0; step < 500; step += 1) {
      const firstCount = (nextRandom() % 8) + 1;
      const firstPosition = nextRandom() % (expected.length - firstCount + 1);
      const first = Array.from(
        { length: firstCount },
        (_, offset): Item => ({
          id: `first-${step}-${offset}`,
          label: `First ${step}.${offset}`,
        }),
      );
      const afterFirst = (expected as WindowArray).toSpliced(firstPosition, firstCount, ...first);
      const secondPosition = firstPosition + (nextRandom() % firstCount);
      const secondLimit = Math.min(8, afterFirst.length - secondPosition);
      const secondCount = (nextRandom() % secondLimit) + 1;
      const second = Array.from(
        { length: secondCount },
        (_, offset): Item => ({
          id: `second-${step}-${offset}`,
          label: `Second ${step}.${offset}`,
        }),
      );
      const beforeRows = [...compiledContainer.querySelectorAll("li")];
      expected = (afterFirst as WindowArray).toSpliced(secondPosition, secondCount, ...second);
      const touchedEnd = Math.max(firstPosition + firstCount, secondPosition + secondCount);
      touchedRows += touchedEnd - firstPosition;

      await act(async () => {
        harness.queueRefreshes(firstPosition, first, secondPosition, second);
        queueReact(firstPosition, first, secondPosition, second);
        await flushCompilerUpdates();
      });

      expect(compiledContainer.querySelector("ul")?.textContent).toBe(
        reactContainer.querySelector("ol")?.textContent,
      );
      const nextRows = [...compiledContainer.querySelectorAll("li")];
      nextRows.forEach((row, index) => {
        if (index >= firstPosition && index < touchedEnd) {
          expect(row).not.toBe(beforeRows[index]);
          expect(beforeRows[index]?.isConnected).toBe(false);
        } else {
          expect(row).toBe(beforeRows[index]);
        }
      });
    }

    expect(harness.counters).toEqual({
      executions: 1,
      renders: 1,
      keys: touchedRows,
      descriptors: touchedRows,
      bindings: touchedRows,
    });
  }, 15_000);

  it("hydrates in StrictMode and drops a queued replacement after unmount", async () => {
    const harness = createWindowHarness([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
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
    const alpha = container.querySelector('[data-key="a"]');
    const beta = container.querySelector('[data-key="b"]');
    const gamma = container.querySelector('[data-key="c"]');

    await act(async () => {
      harness.queueRefreshes(1, [{ id: "b", label: "Beta hydrated" }], 2, [
        { id: "c", label: "Gamma hydrated" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("AlphaBeta hydratedGamma hydrated");
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(recoverable).toEqual([]);

    await act(async () => {
      harness.replace(0, 2, [
        { id: "b", label: "Beta moved" },
        { id: "a", label: "Alpha moved" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("Beta movedAlpha movedGamma hydrated");
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="c"]')).toBe(gamma);
    expect(recoverable).toEqual([]);

    await act(async () => {
      harness.queueRefreshes(
        0,
        [
          { id: "e", label: "Epsilon hydrated" },
          { id: "f", label: "Intermediate Phi hydrated" },
        ],
        1,
        [
          { id: "g", label: "Gamma replacement hydrated" },
          { id: "h", label: "Eta hydrated" },
        ],
      );
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("Epsilon hydratedGamma replacement hydratedEta hydrated");
    expect(alpha?.isConnected).toBe(false);
    expect(beta?.isConnected).toBe(false);
    expect(gamma?.isConnected).toBe(false);
    expect(container.querySelector('[data-key="f"]')).toBeNull();
    expect(recoverable).toEqual([]);

    roots.pop();
    act(() => {
      harness.queueRefreshes(
        0,
        [
          { id: "i", label: "Iota" },
          { id: "j", label: "Jota" },
        ],
        1,
        [{ id: "k", label: "Kappa" }],
      );
      root.unmount();
    });
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });
});
