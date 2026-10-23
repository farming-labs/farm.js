import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createCompilerKeyedArrayFilter,
  createCompilerKeyedArrayPositionUpdate,
  createCompilerKeyedArrayRollingWindow,
  createCompilerKeyedArraySlice,
  createCompilerKeyedArrayStructuralReorder,
  keyedRowsEveryHintedRuntimeFeature,
  keyedRowsHostRuntimeFeature,
  type CompilerKeyedRowsBlockProps,
  type CompilerRuntimeFeature,
} from "../compiler-runtime";

interface Item {
  id: string;
}

// Exercise the real block commit paths without counting React's own allocations.
interface Block {
  root: Element;
  mounted: boolean;
  instances: Map<
    string,
    { element: Element; item: Item; index: number; scope?: { cleanup(): void } }
  >;
  currentProps: CompilerKeyedRowsBlockProps;
  eventHandlers: Map<string, Map<number, () => void>>;
  conditionalListeners: Map<string, Map<number, () => void>>;
  adopt(): boolean;
  pruneEventHandlers(): void;
  pruneConditionalListeners(): void;
  refresh(afterCommit?: () => void, dirtyState?: ReadonlySet<number>): void;
}

function harness(
  size: number,
  feature: CompilerRuntimeFeature = keyedRowsEveryHintedRuntimeFeature,
  hostBlocks = false,
) {
  let items: Item[] = Array.from({ length: size }, (_, index) => ({ id: `row-${index}` }));
  const Component = feature.create({
    setRoot() {},
    subscribe: () => () => {},
  }).KeyedRows as React.ComponentClass<CompilerKeyedRowsBlockProps>;
  const block = new Component({
    id: 0,
    hostBlocks,
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

describe.each(Object.entries(updates))("cleanup after %s", (name, update) => {
  // Filter deletes removed rows from the owned map in place; the others commit
  // a new map.
  const inPlace = name === "filter";
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
          if ((inPlace || this !== before) && this === block.instances) {
            snapshots.push(this.size);
          }
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
      if (inPlace) expect(block.instances).toBe(before);
      else expect(block.instances).not.toBe(before);
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

describe("full replacement cleanup", () => {
  it.each([1, 1_000])("does not iterate %i scope-free old rows just to discard them", (size) => {
    const { block, setItems } = harness(size);
    const before = block.instances;
    const oldElements = [...block.root.children];
    const iterate = vi.spyOn(before, Symbol.iterator);
    const next = Array.from({ length: size }, (_, index) => ({ id: `next-${index}` }));
    const committed = vi.fn();
    block.eventHandlers.set("row-0", new Map([[0, vi.fn()]]));
    block.conditionalListeners.set("row-0", new Map([[0, vi.fn()]]));

    setItems(next);
    block.refresh(committed);

    expect(iterate).not.toHaveBeenCalled();
    expect(committed).toHaveBeenCalledTimes(1);
    expect(block.instances).not.toBe(before);
    expect([...block.instances.keys()]).toEqual(next.map((item) => item.id));
    expect([...block.root.children].map((row) => row.textContent)).toEqual(
      next.map((item) => item.id),
    );
    expect(oldElements.every((element) => element.parentNode === null)).toBe(true);
    expect(block.eventHandlers.size).toBe(0);
    expect(block.conditionalListeners.size).toBe(0);
  });

  it.each([false, true])("cleans old host scopes with current hostBlocks=%s", (hostBlocks) => {
    const { block, setItems } = harness(3, keyedRowsHostRuntimeFeature, true);
    const cleanups = [...block.instances.values()].map((instance) =>
      vi.spyOn(instance.scope!, "cleanup"),
    );
    // Definitions/props can change before scopes mounted by the previous one are disposed.
    block.currentProps = { ...block.currentProps, hostBlocks };
    setItems([{ id: "new-a" }, { id: "new-b" }, { id: "new-c" }]);

    block.refresh();

    for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledTimes(1);
    expect([...block.root.children].map((row) => row.textContent)).toEqual([
      "new-a",
      "new-b",
      "new-c",
    ]);
  });

  it.each([false, true])(
    "still removes old rows when some survive (host scopes: %s)",
    (hostBlocks) => {
      const { block, items, setItems } = harness(
        3,
        hostBlocks ? keyedRowsHostRuntimeFeature : keyedRowsEveryHintedRuntimeFeature,
        hostBlocks,
      );
      const survivor = block.instances.get("row-1")!;
      const removed = [block.instances.get("row-0")!, block.instances.get("row-2")!];
      const cleanups = hostBlocks
        ? removed.map((instance) => vi.spyOn(instance.scope!, "cleanup"))
        : [];
      const survivorCleanup = hostBlocks ? vi.spyOn(survivor.scope!, "cleanup") : undefined;
      setItems([{ id: "new-a" }, items[1], { id: "new-b" }]);

      block.refresh();

      expect(block.instances.get("row-1")).toBe(survivor);
      expect(block.root.children[1]).toBe(survivor.element);
      expect(removed.every((instance) => instance.element.parentNode === null)).toBe(true);
      for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledTimes(1);
      if (survivorCleanup) expect(survivorCleanup).not.toHaveBeenCalled();
      expect([...block.root.children].map((row) => row.textContent)).toEqual([
        "new-a",
        "row-1",
        "new-b",
      ]);
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

describe("filter validation", () => {
  it("removes nothing until every survivor validates", () => {
    const { block, items, setItems } = harness(10);
    const before = block.instances;
    const removedRow = before.get("row-0")!.element;
    const filtered = createCompilerKeyedArrayFilter(
      items,
      items.filter,
      (item: Item) => item.id !== "row-0",
    ) as Item[];
    // Same key, different object: the hinted survivor no longer matches its row,
    // so the hinted path bails after row-0 was already seen as removed.
    filtered[6] = { ...filtered[6] };
    const deletes = vi.spyOn(Map.prototype, "delete");
    try {
      setItems(filtered);
      block.refresh(undefined, new Set([0]));
      // Only the complete fallback deletes, once, for the one removed row.
      expect(deletes.mock.contexts.filter((context) => context === before).length).toBeLessThan(2);
    } finally {
      deletes.mockRestore();
    }
    expect(removedRow.isConnected).toBe(false);
    expect([...block.root.children].map((row) => row.textContent)).toEqual(
      filtered.map((item) => item.id),
    );
    expect([...block.instances.keys()]).toEqual(filtered.map((item) => item.id));
  });
});
