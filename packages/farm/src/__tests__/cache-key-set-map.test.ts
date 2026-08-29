import { afterEach, describe, expect, it } from "vitest";
import { configureFarmCache, createFarmCacheKey, unstable_cache } from "../cache";

afterEach(() => {
  configureFarmCache(undefined);
});

describe("createFarmCacheKey with Set and Map", () => {
  it("gives different keys to sets with different contents", () => {
    expect(createFarmCacheKey([new Set([1, 2])])).toBe("[set:[number:1,number:2]]");
    expect(createFarmCacheKey([new Set([9])])).toBe("[set:[number:9]]");
    expect(createFarmCacheKey([new Set()])).toBe("[set:[]]");
  });

  it("gives different keys to maps with different contents", () => {
    expect(createFarmCacheKey([new Map([["x", 1]])])).toBe('[map:[["x",number:1]]]');
    expect(createFarmCacheKey([new Map([["y", 2]])])).toBe('[map:[["y",number:2]]]');
    expect(createFarmCacheKey([new Map()])).toBe("[map:[]]");
  });

  it("does not confuse a set, a map, an array and an object with the same shape", () => {
    const keys = [
      createFarmCacheKey([new Set(["a"])]),
      createFarmCacheKey([new Map([["a", "a"]])]),
      createFarmCacheKey([["a"]]),
      createFarmCacheKey([{ a: "a" }]),
      createFarmCacheKey([{}]),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives the same key to equivalent contents in a different insertion order", () => {
    expect(createFarmCacheKey([new Set([2, 1, 3])])).toBe(createFarmCacheKey([new Set([3, 2, 1])]));
    expect(
      createFarmCacheKey([
        new Map([
          ["b", 2],
          ["a", 1],
        ]),
      ]),
    ).toBe(
      createFarmCacheKey([
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
      ]),
    );
  });

  it("serializes nested values inside sets and maps", () => {
    const key = createFarmCacheKey([
      new Map<unknown, unknown>([
        [{ id: 1 }, new Set([new Date("2024-01-01T00:00:00.000Z"), [1, "two"]])],
        ["plain", new Map([["inner", null]])],
      ]),
    ]);
    expect(key).toBe(
      '[map:[["plain",map:[["inner",null]]],[{"id":number:1},set:[[number:1,"two"],date:2024-01-01T00:00:00.000Z]]]]',
    );
  });

  it("handles sets and maps that contain themselves", () => {
    const set = new Set<unknown>([1]);
    set.add(set);
    expect(createFarmCacheKey([set])).toBe("[set:[[Circular],number:1]]");

    const map = new Map<unknown, unknown>([["a", 1]]);
    map.set("self", map);
    expect(createFarmCacheKey([map])).toBe('[map:[["a",number:1],["self",[Circular]]]]');
  });

  it("lets a set be reused in two places without being marked circular", () => {
    const shared = new Set([1]);
    expect(createFarmCacheKey([shared, shared])).toBe("[set:[number:1],set:[number:1]]");
  });

  it("caches unstable_cache calls separately per set contents", async () => {
    let calls = 0;
    const sum = unstable_cache(
      async (ids: Set<number>) => {
        calls++;
        return [...ids].reduce((total, id) => total + id, 0);
      },
      ["sum"],
    );

    await expect(sum(new Set([1, 2]))).resolves.toBe(3);
    await expect(sum(new Set([9]))).resolves.toBe(9);
    await expect(sum(new Set([2, 1]))).resolves.toBe(3);
    expect(calls).toBe(2);
  });
});
