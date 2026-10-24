import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  keyedRowsConditionalRuntimeFeature,
  keyedRowsIdentityFilterOnlyRuntimeFeature,
  type CompilerKeyedRowsBlockProps,
} from "../compiler-runtime";

interface Item {
  id: string;
  label: string;
}

interface Block {
  root: Element;
  mounted: boolean;
  instances: Map<string, { element: Element; item: Item; index: number }>;
  adopt(): boolean;
  readConditionalValues(...args: unknown[]): ReadonlyMap<number, readonly unknown[]>;
  refresh(afterCommit?: () => void, dirtyState?: ReadonlySet<number>): void;
}

afterEach(() => vi.restoreAllMocks());

describe.each([false, true])("conditional capability: %s", (conditional) => {
  it.each([false, true])(
    "patches all bindings and preserves row identity (reorder: %s)",
    (reorder) => {
      let items: Item[] = Array.from({ length: 1_000 }, (_, index) => ({
        id: `row-${index}`,
        label: `Label ${index}`,
      }));
      const feature = conditional
        ? keyedRowsConditionalRuntimeFeature
        : keyedRowsIdentityFilterOnlyRuntimeFeature;
      const Component = feature.create({
        setRoot() {},
        subscribe: () => () => {},
      }).KeyedRows as React.ComponentClass<CompilerKeyedRowsBlockProps>;
      const read = vi.fn((item: unknown, index: number) => [(item as Item).label, ":", index]);
      const block = new Component({
        id: 0,
        items: () => items,
        dependencies: [0],
        structureDependencies: [0],
        collectionDependency: 0,
        rowKey: (item) => (item as Item).id,
        bindings: [{ kind: "text", path: [], read }],
        // Even a currently empty conditional list must retain the capable factory's path.
        conditionals: [],
        create: (item, index) => ({
          kind: "element",
          tag: "li",
          attributes: [],
          styles: [],
          children: [(item as Item).label, ":", index],
        }),
        render: () => React.createElement("ul"),
      }) as unknown as Block;
      block.root = document.createElement("ul");
      block.mounted = true;
      for (const [index, item] of items.entries()) {
        const row = document.createElement("li");
        row.textContent = `${item.label}:${index}`;
        block.root.append(row);
      }
      expect(block.adopt()).toBe(true);
      const before = new Map(block.instances);
      read.mockClear();
      const conditionalReads = vi.spyOn(block, "readConditionalValues");
      const committed = vi.fn();
      items = items.map((item, index) =>
        index % 10 === 0 ? { ...item, label: `${item.label}!` } : item,
      );
      if (reorder) [items[1], items[998]] = [items[998], items[1]];
      block.refresh(committed, new Set([0]));

      expect(conditionalReads).toHaveBeenCalledTimes(conditional ? items.length : 0);
      expect(read).toHaveBeenCalledTimes(items.length);
      expect(committed).toHaveBeenCalledTimes(1);
      expect([...block.instances.keys()]).toEqual(items.map((item) => item.id));
      for (const [index, item] of items.entries()) {
        const instance = block.instances.get(item.id)!;
        expect(instance).toBe(before.get(item.id));
        expect(instance.item).toBe(item);
        expect(instance.index).toBe(index);
        expect(block.root.children[index]).toBe(instance.element);
        expect(instance.element.textContent).toBe(`${item.label}:${index}`);
      }
    },
  );
});
