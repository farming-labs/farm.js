import type React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  keyedRowsConditionalRuntimeFeature,
  type CompilerKeyedRowsBlockProps,
  type CompilerRuntimeFeature,
} from "../compiler-runtime";

// Inspect the block's owned registries, not React internals. This keeps allocation
// assertions independent of unrelated Set allocations during React rendering.
interface KeyedCleanup {
  instances: Map<string, unknown>;
  eventHandlers: Map<string, Map<number, () => void>>;
  pruneEventHandlers(): void;
  conditionals: {
    listeners: Map<string, Map<number, () => void>>;
    prune(instances: Map<string, unknown>): void;
    owner: { subscribe(key: string, id: number, refresh: () => void): () => void };
  };
}

function createBlock(
  feature: CompilerRuntimeFeature = keyedRowsConditionalRuntimeFeature,
): KeyedCleanup {
  const Component = feature.create({ setRoot() {}, subscribe: () => () => {} })
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

describe.each(["events", "conditionals"] as const)("keyed cleanup for %s", (kind) => {
  const registry = (block: KeyedCleanup) =>
    kind === "events" ? block.eventHandlers : block.conditionals.listeners;
  const prune = (block: KeyedCleanup) =>
    kind === "events" ? block.pruneEventHandlers() : block.conditionals.prune(block.instances);
  it.each([0, 1_000, 10_000])(
    "does not allocate a Set for an empty registry and %i keys",
    (size) => {
      const block = createBlock();
      const keys = Array.from({ length: size }, (_, index) => `row-${index}`);
      block.instances = new Map(keys.map((key) => [key, {}]));
      const iterate = vi.spyOn(block.instances, "keys");
      const has = vi.spyOn(block.instances, "has");

      expect(countSets(() => prune(block))).toBe(0);
      expect(iterate).not.toHaveBeenCalled();
      expect(has).not.toHaveBeenCalled();
      expect(registry(block).size).toBe(0);
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
    registry(block).set("active", active);
    registry(block).set("removed", removed);

    expect(countSets(() => prune(block))).toBe(0);
    expect([...registry(block)]).toEqual([["active", active]]);
    expect(registry(block).get("active")).toBe(active);
    expect(active.get(0)).not.toHaveBeenCalled();
    expect(removed.get(0)).not.toHaveBeenCalled();
  });

  it("cleans up a populated registry, then supports registration after it becomes empty", () => {
    const block = createBlock();
    registry(block).set("reused", new Map([[0, vi.fn()]]));
    prune(block);
    expect(registry(block).size).toBe(0);
    block.instances.set("reused", {});
    expect(countSets(() => prune(block))).toBe(0);

    const replacement = new Map([[0, vi.fn()]]);
    registry(block).set("reused", replacement);
    prune(block);
    expect(registry(block).get("reused")).toBe(replacement);
    block.instances.clear();
    prune(block);
    expect(registry(block).size).toBe(0);
  });

  it.each([1_000, 10_000])("checks membership without copying %i committed keys", (size) => {
    const block = createBlock();
    const callbacks = Array.from(
      { length: size },
      (_, index) => [`row-${index}`, new Map([[0, vi.fn()]])] as const,
    );
    block.instances = new Map(callbacks.map(([key]) => [key, {}]));
    for (const [key, callback] of callbacks) registry(block).set(key, callback);
    registry(block).set("removed", new Map([[0, vi.fn()]]));
    const keys = vi.spyOn(block.instances, "keys");
    const iterate = vi.spyOn(block.instances, Symbol.iterator);
    const has = vi.spyOn(block.instances, "has");

    expect(countSets(() => prune(block))).toBe(0);
    expect(keys).not.toHaveBeenCalled();
    expect(iterate).not.toHaveBeenCalled();
    expect(has).toHaveBeenCalledTimes(size + 1);
    expect([...registry(block)]).toEqual(callbacks);
    for (const [key, callback] of callbacks) expect(registry(block).get(key)).toBe(callback);
  });
});

it("checks each registry independently", () => {
  const block = createBlock();
  block.instances.set("active", {});
  const callback = new Map([[0, vi.fn()]]);
  block.conditionals.listeners.set("active", callback);
  expect(countSets(() => block.pruneEventHandlers())).toBe(0);
  expect(block.conditionals.listeners.get("active")).toBe(callback);
  expect(countSets(() => block.conditionals.prune(block.instances))).toBe(0);
  block.instances.clear();
  block.conditionals.prune(block.instances);

  block.instances.set("active", {});
  block.eventHandlers.set("active", callback);
  expect(countSets(() => block.conditionals.prune(block.instances))).toBe(0);
  expect(block.eventHandlers.get("active")).toBe(callback);
  expect(countSets(() => block.pruneEventHandlers())).toBe(0);
  expect(block.eventHandlers.get("active")).toBe(callback);
});

it("does not let a stale conditional unsubscribe remove a replacement registration", () => {
  const block = createBlock(keyedRowsConditionalRuntimeFeature);
  block.instances.set("reused", {});
  const previous = vi.fn();
  const stopPrevious = block.conditionals.owner.subscribe("reused", 0, previous);
  block.conditionals.prune(block.instances);
  expect(block.conditionals.listeners.get("reused")?.get(0)).toBe(previous);

  block.instances.clear();
  block.conditionals.prune(block.instances);
  expect(block.conditionals.listeners.size).toBe(0);
  block.instances.set("reused", {});
  const next = vi.fn();
  const stopNext = block.conditionals.owner.subscribe("reused", 0, next);
  const sibling = vi.fn();
  const stopSibling = block.conditionals.owner.subscribe("reused", 1, sibling);
  stopPrevious();
  block.conditionals.prune(block.instances);
  expect([...block.conditionals.listeners.get("reused")!]).toEqual([
    [0, next],
    [1, sibling],
  ]);
  stopNext();
  expect([...block.conditionals.listeners.get("reused")!]).toEqual([[1, sibling]]);
  stopSibling();
  expect(block.conditionals.listeners.size).toBe(0);
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
    block.conditionals.listeners.set("shared", callback);
  }
  left.instances.clear();
  for (const block of [left, right]) {
    block.pruneEventHandlers();
    block.conditionals.prune(block.instances);
  }
  expect(left.eventHandlers.size).toBe(0);
  expect(left.conditionals.listeners.size).toBe(0);
  expect(right.eventHandlers.get("shared")).toBe(callback);
  expect(right.conditionals.listeners.get("shared")).toBe(callback);
});
