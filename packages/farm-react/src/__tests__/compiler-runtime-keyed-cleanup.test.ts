import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { keyedRowsRuntimeFeature, type CompilerKeyedRowsBlockProps } from "../compiler-runtime";

// Inspect the block's owned registries, not React internals. This keeps allocation
// assertions independent of unrelated Set allocations during React rendering.
interface KeyedCleanup {
  instances: Map<string, unknown>;
  eventHandlers: Map<string, Map<number, () => void>>;
  conditionalListeners: Map<string, Map<number, () => void>>;
  pruneEventHandlers(): void;
  pruneConditionalListeners(): void;
  subscribeToRowConditional(key: string, id: number, refresh: () => void): () => void;
}

function createBlock(): KeyedCleanup {
  const Component = keyedRowsRuntimeFeature.create({ setRoot() {}, subscribe: () => () => {} })
    .KeyedRows as React.ComponentClass<CompilerKeyedRowsBlockProps>;
  return new Component({
    bindings: [],
  } as unknown as CompilerKeyedRowsBlockProps) as unknown as KeyedCleanup;
}

function countSets(run: () => void): number {
  const NativeSet = Set;
  let count = 0;
  vi.stubGlobal(
    "Set",
    class extends NativeSet {
      constructor(...args: ConstructorParameters<typeof Set>) {
        super(...args);
        count += 1;
      }
    },
  );
  try {
    run();
  } finally {
    vi.unstubAllGlobals();
  }
  return count;
}

describe.each([
  ["eventHandlers", "pruneEventHandlers"],
  ["conditionalListeners", "pruneConditionalListeners"],
] as const)("keyed cleanup for %s", (registryName, pruneName) => {
  it.each([0, 1_000, 10_000])(
    "does not allocate a Set for an empty registry and %i keys",
    (size) => {
      const block = createBlock();
      const keys = Array.from({ length: size }, (_, index) => `row-${index}`);
      block.instances = new Map(keys.map((key) => [key, {}]));
      const iterate = vi.spyOn(block.instances, "keys");
      const has = vi.spyOn(block.instances, "has");

      expect(countSets(() => block[pruneName]())).toBe(0);
      expect(iterate).not.toHaveBeenCalled();
      expect(has).not.toHaveBeenCalled();
      expect(block[registryName].size).toBe(0);
    },
  );

  it("removes stale entries while preserving live callbacks and their identity", () => {
    const block = createBlock();
    const active = new Map([[0, vi.fn()]]);
    const removed = new Map([[0, vi.fn()]]);
    block.instances = new Map([
      ["active", {}],
      ["new", {}],
    ]);
    block[registryName].set("active", active);
    block[registryName].set("removed", removed);

    expect(countSets(() => block[pruneName]())).toBe(0);
    expect([...block[registryName]]).toEqual([["active", active]]);
    expect(block[registryName].get("active")).toBe(active);
    expect(active.get(0)).not.toHaveBeenCalled();
    expect(removed.get(0)).not.toHaveBeenCalled();
  });

  it("cleans up a populated registry, then supports registration after it becomes empty", () => {
    const block = createBlock();
    block[registryName].set("reused", new Map([[0, vi.fn()]]));
    block[pruneName]();
    expect(block[registryName].size).toBe(0);
    block.instances.set("reused", {});
    expect(countSets(() => block[pruneName]())).toBe(0);

    const replacement = new Map([[0, vi.fn()]]);
    block[registryName].set("reused", replacement);
    block[pruneName]();
    expect(block[registryName].get("reused")).toBe(replacement);
    block.instances.clear();
    block[pruneName]();
    expect(block[registryName].size).toBe(0);
  });

  it.each([1_000, 10_000])("checks membership without copying %i committed keys", (size) => {
    const block = createBlock();
    const callbacks = Array.from(
      { length: size },
      (_, index) => [`row-${index}`, new Map([[0, vi.fn()]])] as const,
    );
    block.instances = new Map(callbacks.map(([key]) => [key, {}]));
    block[registryName] = new Map(callbacks);
    block[registryName].set("removed", new Map([[0, vi.fn()]]));
    const keys = vi.spyOn(block.instances, "keys");
    const iterate = vi.spyOn(block.instances, Symbol.iterator);
    const has = vi.spyOn(block.instances, "has");

    expect(countSets(() => block[pruneName]())).toBe(0);
    expect(keys).not.toHaveBeenCalled();
    expect(iterate).not.toHaveBeenCalled();
    expect(has).toHaveBeenCalledTimes(size + 1);
    expect([...block[registryName]]).toEqual(callbacks);
    for (const [key, callback] of callbacks) expect(block[registryName].get(key)).toBe(callback);
  });
});

it("checks each registry independently", () => {
  const block = createBlock();
  block.instances.set("active", {});
  const callback = new Map([[0, vi.fn()]]);
  block.conditionalListeners.set("active", callback);
  expect(countSets(() => block.pruneEventHandlers())).toBe(0);
  expect(block.conditionalListeners.get("active")).toBe(callback);
  expect(countSets(() => block.pruneConditionalListeners())).toBe(0);
  block.instances.clear();
  block.pruneConditionalListeners();

  block.instances.set("active", {});
  block.eventHandlers.set("active", callback);
  expect(countSets(() => block.pruneConditionalListeners())).toBe(0);
  expect(block.eventHandlers.get("active")).toBe(callback);
  expect(countSets(() => block.pruneEventHandlers())).toBe(0);
  expect(block.eventHandlers.get("active")).toBe(callback);
});

it("does not let a stale conditional unsubscribe remove a replacement registration", () => {
  const block = createBlock();
  block.instances.set("reused", {});
  const previous = vi.fn();
  const stopPrevious = block.subscribeToRowConditional("reused", 0, previous);
  block.pruneConditionalListeners();
  expect(block.conditionalListeners.get("reused")?.get(0)).toBe(previous);

  block.instances.clear();
  block.pruneConditionalListeners();
  expect(block.conditionalListeners.size).toBe(0);
  block.instances.set("reused", {});
  const next = vi.fn();
  const stopNext = block.subscribeToRowConditional("reused", 0, next);
  const sibling = vi.fn();
  const stopSibling = block.subscribeToRowConditional("reused", 1, sibling);
  stopPrevious();
  block.pruneConditionalListeners();
  expect([...block.conditionalListeners.get("reused")!]).toEqual([
    [0, next],
    [1, sibling],
  ]);
  stopNext();
  expect([...block.conditionalListeners.get("reused")!]).toEqual([[1, sibling]]);
  stopSibling();
  expect(block.conditionalListeners.size).toBe(0);
  expect(previous).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
  expect(sibling).not.toHaveBeenCalled();
});

it("keeps cleanup membership isolated between blocks with the same row keys", () => {
  const left = createBlock();
  const right = createBlock();
  const callback = new Map([[0, vi.fn()]]);
  for (const block of [left, right]) {
    block.instances.set("shared", {});
    block.eventHandlers.set("shared", callback);
    block.conditionalListeners.set("shared", callback);
  }
  left.instances.clear();
  for (const block of [left, right]) {
    block.pruneEventHandlers();
    block.pruneConditionalListeners();
  }
  expect(left.eventHandlers.size).toBe(0);
  expect(left.conditionalListeners.size).toBe(0);
  expect(right.eventHandlers.get("shared")).toBe(callback);
  expect(right.conditionalListeners.get("shared")).toBe(callback);
});
