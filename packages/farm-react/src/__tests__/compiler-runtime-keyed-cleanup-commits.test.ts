import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createCompilerKeyedArrayFilter,
  createCompilerKeyedArrayPositionUpdate,
  createCompilerKeyedArrayRollingWindow,
  createCompilerKeyedArraySlice,
  createCompilerKeyedArrayStructuralReorder,
  keyedRowsEveryHintedRuntimeFeature,
  type CompilerKeyedRowsBlockProps,
} from "../compiler-runtime";

interface Item {
  id: string;
}

// Exercise the real block commit paths without counting React's own allocations.
interface Block {
  root: Element;
  mounted: boolean;
  instances: Map<string, { element: Element; item: Item; index: number }>;
  eventHandlers: Map<string, Map<number, () => void>>;
  conditionalListeners: Map<string, Map<number, () => void>>;
  adopt(): boolean;
  pruneEventHandlers(): void;
  pruneConditionalListeners(): void;
  refresh(afterCommit?: () => void, dirtyState?: ReadonlySet<number>): void;
}

function harness(size: number) {
  let items: Item[] = Array.from({ length: size }, (_, index) => ({ id: `row-${index}` }));
  const Component = keyedRowsEveryHintedRuntimeFeature.create({
    setRoot() {},
    subscribe: () => () => {},
  }).KeyedRows as React.ComponentClass<CompilerKeyedRowsBlockProps>;
  const block = new Component({
    id: 0,
    items: () => items,
    collectionDependency: 0,
    dependencies: [0],
    structureDependencies: [0],
    filterIndexIndependent: true,
    positionIndexIndependent: true,
    reorderIndexIndependent: true,
    rowKey: (item) => (item as Item).id,
    bindings: [],
    create: (item) => ({
      kind: "element",
      tag: "li",
      attributes: [],
      styles: [],
      children: [(item as Item).id],
    }),
    render: () => React.createElement("ul"),
  }) as unknown as Block;
  block.root = document.createElement("ul");
  block.mounted = true;
  for (const item of items) {
    const element = document.createElement("li");
    element.textContent = item.id;
    block.root.append(element);
  }
  expect(block.adopt()).toBe(true);
  return {
    block,
    get items() {
      return items;
    },
    setItems(next: Item[]) {
      items = next;
    },
  };
}

const updates = {
  filter: (items: Item[]) =>
    createCompilerKeyedArrayFilter(items, items.filter, (item: Item) => item.id !== "row-0"),
  position: (items: Item[]) =>
    createCompilerKeyedArrayPositionUpdate(items, items.toSpliced, "remove", 0, 1),
  reorder: (items: Item[]) => {
    const retained = createCompilerKeyedArraySlice(items, items.slice, 1) as Item[];
    return createCompilerKeyedArrayStructuralReorder(retained, retained.toReversed);
  },
  rollingWindow: (items: Item[]) => {
    const retained = createCompilerKeyedArraySlice(items, items.slice, 1) as Item[];
    return createCompilerKeyedArrayRollingWindow(items, retained, [
      ...retained,
      { id: "incoming" },
    ]);
  },
};

describe.each(Object.entries(updates))("cleanup after %s", (_name, update) => {
  it.each([false, true])(
    "uses the committed Map without snapshotting its keys (registries: %s)",
    (populated) => {
      const { block, items, setItems } = harness(1_000);
      const before = block.instances;
      const survivor = before.get("row-1")!;
      const callback = new Map([[0, vi.fn()]]);
      if (populated) {
        for (const registry of [block.eventHandlers, block.conditionalListeners]) {
          registry.set("row-0", new Map([[0, vi.fn()]]));
          registry.set("row-1", callback);
        }
      }
      const pruneEvents = vi.spyOn(block, "pruneEventHandlers");
      const pruneConditionals = vi.spyOn(block, "pruneConditionalListeners");
      const snapshots: number[] = [];
      const nativeKeys = Map.prototype.keys;
      const keys = vi
        .spyOn(Map.prototype, "keys")
        .mockImplementation(function (this: Map<unknown, unknown>) {
          // Rolling-window validation may inspect the previous map; only the
          // newly committed map's redundant cleanup snapshot is in scope here.
          if (this !== before && this === block.instances) snapshots.push(this.size);
          return nativeKeys.call(this);
        });
      const committed = vi.fn();
      let expected: Item[];
      try {
        expected = update(items) as Item[];
        setItems(expected);
        block.refresh(committed, new Set([0]));
      } finally {
        keys.mockRestore();
      }
      expect(pruneEvents).toHaveBeenCalledTimes(1);
      expect(pruneConditionals).toHaveBeenCalledTimes(1);
      expect(snapshots).toEqual([]);
      expect(committed).toHaveBeenCalledTimes(1);
      expect(block.instances).not.toBe(before);
      expect(block.instances.has("row-0")).toBe(false);
      expect(block.instances.get("row-1")).toBe(survivor);
      expect([...block.instances.keys()]).toEqual(expected.map((item) => item.id));
      expect([...block.root.children].map((row) => row.textContent)).toEqual(
        expected.map((item) => item.id),
      );
      expect([...block.root.children]).toEqual(
        [...block.instances.values()].map((row) => row.element),
      );
      expect([...block.instances.values()].map((row) => row.index)).toEqual(
        Array.from({ length: block.instances.size }, (_, index) => index),
      );
      for (const registry of [block.eventHandlers, block.conditionalListeners]) {
        expect([...registry]).toEqual(populated ? [["row-1", callback]] : []);
      }
      expect(callback.get(0)).not.toHaveBeenCalled();
    },
  );
});

it.each(["adopt", "reconcile"] as const)("prunes against the new Map after %s", (mode) => {
  const { block, setItems } = harness(3);
  const callback = new Map([[0, vi.fn()]]);
  for (const registry of [block.eventHandlers, block.conditionalListeners]) {
    registry.set("row-0", new Map([[0, vi.fn()]]));
    registry.set("row-1", callback);
    registry.set("incoming", callback);
  }
  const before = block.instances;
  setItems([{ id: "row-1" }, { id: "incoming" }, { id: "row-2" }]);
  const pruneEvents = vi.spyOn(block, "pruneEventHandlers");
  const pruneConditionals = vi.spyOn(block, "pruneConditionalListeners");
  if (mode === "adopt") expect(block.adopt()).toBe(true);
  else block.refresh();
  expect(pruneEvents).toHaveBeenCalledTimes(1);
  expect(pruneConditionals).toHaveBeenCalledTimes(1);
  expect(block.instances).not.toBe(before);
  expect([...block.instances.keys()]).toEqual(["row-1", "incoming", "row-2"]);
  for (const registry of [block.eventHandlers, block.conditionalListeners]) {
    expect([...registry]).toEqual([
      ["row-1", callback],
      ["incoming", callback],
    ]);
  }
});

it("does not prune or replace committed state when adoption fails", () => {
  const { block, setItems } = harness(3);
  const before = block.instances;
  const callback = new Map([[0, vi.fn()]]);
  block.eventHandlers.set("row-0", callback);
  block.conditionalListeners.set("row-0", callback);
  setItems([{ id: "duplicate" }, { id: "duplicate" }, { id: "other" }]);
  const pruneEvents = vi.spyOn(block, "pruneEventHandlers");
  const pruneConditionals = vi.spyOn(block, "pruneConditionalListeners");
  expect(block.adopt()).toBe(false);
  expect(block.instances).toBe(before);
  expect(pruneEvents).not.toHaveBeenCalled();
  expect(pruneConditionals).not.toHaveBeenCalled();
  expect(block.eventHandlers.get("row-0")).toBe(callback);
  expect(block.conditionalListeners.get("row-0")).toBe(callback);
});
