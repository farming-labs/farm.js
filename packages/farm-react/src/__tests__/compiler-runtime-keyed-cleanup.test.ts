import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { keyedRowsRuntimeFeature, type CompilerKeyedRowsBlockProps } from "../compiler-runtime";

// Inspect the block's owned registries, not React internals. This keeps allocation
// assertions independent of unrelated Set allocations during React rendering.
interface KeyedCleanup {
  eventHandlers: Map<string, Map<number, () => void>>;
  conditionalListeners: Map<string, Map<number, () => void>>;
  pruneEventHandlers(keys: readonly string[]): void;
  pruneConditionalListeners(keys: readonly string[]): void;
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
      const iterate = vi.spyOn(keys, Symbol.iterator);

      expect(countSets(() => block[pruneName](keys))).toBe(0);
      expect(iterate).not.toHaveBeenCalled();
      expect(block[registryName].size).toBe(0);
    },
  );

  it("removes stale entries while preserving live callbacks and their identity", () => {
    const block = createBlock();
    const active = new Map([[0, vi.fn()]]);
    const removed = new Map([[0, vi.fn()]]);
    block[registryName].set("active", active);
    block[registryName].set("removed", removed);

    expect(countSets(() => block[pruneName](["active", "new"]))).toBe(1);
    expect([...block[registryName]]).toEqual([["active", active]]);
    expect(block[registryName].get("active")).toBe(active);
    expect(active.get(0)).not.toHaveBeenCalled();
    expect(removed.get(0)).not.toHaveBeenCalled();
  });

  it("cleans up a populated registry, then supports registration after it becomes empty", () => {
    const block = createBlock();
    block[registryName].set("reused", new Map([[0, vi.fn()]]));
    block[pruneName]([]);
    expect(block[registryName].size).toBe(0);
    expect(countSets(() => block[pruneName](["reused"]))).toBe(0);

    const replacement = new Map([[0, vi.fn()]]);
    block[registryName].set("reused", replacement);
    block[pruneName](["reused"]);
    expect(block[registryName].get("reused")).toBe(replacement);
    block[pruneName]([]);
    expect(block[registryName].size).toBe(0);
  });
});

it("checks each registry independently", () => {
  const block = createBlock();
  const callback = new Map([[0, vi.fn()]]);
  block.conditionalListeners.set("active", callback);
  expect(countSets(() => block.pruneEventHandlers(["active"]))).toBe(0);
  expect(block.conditionalListeners.get("active")).toBe(callback);
  expect(countSets(() => block.pruneConditionalListeners(["active"]))).toBe(1);
  block.pruneConditionalListeners([]);

  block.eventHandlers.set("active", callback);
  expect(countSets(() => block.pruneConditionalListeners(["active"]))).toBe(0);
  expect(block.eventHandlers.get("active")).toBe(callback);
  expect(countSets(() => block.pruneEventHandlers(["active"]))).toBe(1);
});
