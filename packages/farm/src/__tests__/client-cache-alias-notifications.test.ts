import { describe, expect, it, vi } from "vitest";
import { FarmClientDataCache } from "../client-cache";

const entry = { data: 1, updatedAt: 1, staleAt: Infinity };
const createCache = () =>
  new FarmClientDataCache({ subscribeToInvalidation: false, gcSweepIntervalMs: false });

describe("client cache alias notifications", () => {
  it("does not resolve unobserved aliases during an unrelated write", () => {
    const cache = createCache();
    for (let index = 0; index < 1_000; index++) cache.alias(`alias-${index}`, `target-${index}`);
    const listener = vi.fn();
    cache.subscribe("unrelated", listener);
    const resolve = vi.spyOn(cache, "resolveKey");
    cache.set("unrelated", entry);
    expect(listener).toHaveBeenCalledOnce();
    expect(resolve.mock.calls.length).toBe(1);
    expect(resolve).toHaveBeenCalledWith("unrelated");
  });

  it("does not iterate aliases once the final subscriber is removed", () => {
    const cache = createCache();
    cache.alias("alias", "target");
    cache.subscribe("alias", () => {})();
    const aliases = (cache as any).aliases as Map<string, string>;
    const iterator = vi.spyOn(aliases, Symbol.iterator);
    cache.set("target", entry);
    expect(iterator).not.toHaveBeenCalled();
  });

  it("keeps transitive aliases live after retargeting and unsubscribing", () => {
    const cache = createCache();
    cache.alias("first", "middle");
    cache.alias("middle", "target");
    const seen: Array<string | undefined> = [];
    const unsubscribe = cache.subscribe("first", (event) => seen.push(event));
    cache.set("target", entry);
    cache.invalidate("target", 10);
    expect(seen).toEqual([undefined, "invalidate"]);
    cache.alias("middle", "new-target");
    seen.length = 0;
    cache.set("target", entry);
    expect(seen).toEqual([]);
    cache.set("new-target", entry);
    expect(seen).toEqual([undefined]);
    unsubscribe();
    cache.set("new-target", entry);
    expect(seen).toEqual([undefined]);
  });

  it("observes subscription changes during notification in alias insertion order", () => {
    const cache = createCache();
    cache.alias("first", "target");
    cache.alias("second", "target");
    cache.alias("third", "target");
    const seen: string[] = [];
    const removeThird = cache.subscribe("third", () => seen.push("third"));
    cache.subscribe("target", () => {
      seen.push("target");
      cache.subscribe("second", () => seen.push("second"));
    });
    cache.subscribe("first", () => {
      seen.push("first");
      removeThird();
    });
    cache.set("target", entry);
    expect(seen).toEqual(["target", "first", "second"]);
  });
});
