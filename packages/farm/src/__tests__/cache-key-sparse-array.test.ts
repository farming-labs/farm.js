import { describe, expect, it } from "vitest";
import { createFarmCacheKey } from "../cache";

describe("createFarmCacheKey with sparse arrays", () => {
  it("distinguishes an empty slot from an empty array and explicit undefined", () => {
    const sparse: unknown[] = [];
    sparse.length = 1;

    expect(createFarmCacheKey([sparse])).toBe("[[[Hole]]]");
    expect(createFarmCacheKey([sparse])).not.toBe(createFarmCacheKey([[]]));
    expect(createFarmCacheKey([sparse])).not.toBe(createFarmCacheKey([[undefined]]));
  });

  it("keeps the position of empty slots", () => {
    const leading: unknown[] = [];
    leading.length = 2;
    leading[1] = 1;
    const trailing = [1];
    trailing.length = 2;

    expect(createFarmCacheKey([leading])).not.toBe(createFarmCacheKey([trailing]));
  });

  it("does not change dense array keys", () => {
    expect(createFarmCacheKey([[1, undefined]])).toBe("[[number:1,undefined]]");
  });
});
