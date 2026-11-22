// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createStore, type FarmClientStore } from "../renderer-client";
import { createStore as createReactStore } from "../store";

/**
 * `createStore` lived only in the React client entry and imported React, so a Solid, Vue, Svelte,
 * or custom-renderer app could not use it. The renderer-neutral entry now exports the same store
 * without React, and both versions implement `FarmClientStore`, the contract renderer bindings read.
 */

/** What a renderer binding does with a `FarmClientStore`: read, subscribe, read again. */
function bind<T>(store: FarmClientStore<T>) {
  const seen = [store.getSnapshot()];
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
  return { seen, unsubscribe };
}

describe("the renderer-neutral createStore", () => {
  it("reads, writes, and notifies without a renderer", () => {
    const cart = createStore({ items: [] as string[], open: false }, (store) => ({
      add(item: string) {
        store.items.set((items) => [...items, item]);
      },
    }));
    const opened = vi.fn();
    cart.subscribe("open", opened);

    cart.add("tea");
    cart.open.set(true);

    expect(cart.get()).toEqual({ items: ["tea"], open: true });
    expect(cart.items()).toEqual(["tea"]);
    expect(cart.open.get()).toBe(true);
    expect(opened).toHaveBeenCalledOnce();
    expect(opened).toHaveBeenCalledWith(true, false);
    expect("use" in cart).toBe(false);
  });

  it("is a FarmClientStore whose snapshot changes only when a value changes", () => {
    const counter = createStore({ count: 0, label: "clicks" });
    const { seen, unsubscribe } = bind(counter);
    const first = counter.getSnapshot();

    counter.set("count", 0);
    expect(counter.getSnapshot()).toBe(first);

    counter.set("count", (count) => count + 1);
    counter.set({ label: "taps" });
    unsubscribe();
    counter.reset();

    expect(seen).toEqual([
      { count: 0, label: "clicks" },
      { count: 1, label: "clicks" },
      { count: 1, label: "taps" },
    ]);
    expect(counter.getSnapshot()).toEqual({ count: 0, label: "clicks" });
  });

  it("keeps the React entry's names reserved so one definition works with both", () => {
    expect(() => createStore({ getSnapshot: 1 })).toThrow('reserved key "getSnapshot"');
    expect(() => createStore({ use: 1 })).toThrow('reserved key "use"');
    expect(() => createStore({ count: 0 }, () => ({ use() {} }))).toThrow(
      'cannot attach the method "use" because it is reserved',
    );
    expect(() => createStore({ count: 0 }, () => ({ get() {} }))).toThrow(
      'cannot attach the method "get" because it already exists',
    );
  });
});

describe("the React createStore", () => {
  it("is also a FarmClientStore", () => {
    const counter = createReactStore({ count: 0 });
    const { seen, unsubscribe } = bind(counter);

    counter.count.set(2);
    unsubscribe();

    expect(seen).toEqual([{ count: 0 }, { count: 2 }]);
    expect(typeof counter.use).toBe("function");
    expect(() => createReactStore({ getSnapshot: 1 })).toThrow('reserved key "getSnapshot"');
  });
});
