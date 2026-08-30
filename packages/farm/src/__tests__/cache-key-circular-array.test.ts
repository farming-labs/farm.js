import { describe, expect, it } from "vitest";
import { createFarmCacheKey } from "../cache";

describe("createFarmCacheKey with circular arrays", () => {
  it("serializes an array that contains itself", () => {
    const circular: unknown[] = [];
    circular.push(circular);

    expect(createFarmCacheKey([circular])).toBe("[[[Circular]]]");
  });

  it("keeps non-circular array contents in the key", () => {
    const first: unknown[] = [];
    first.push(first, 1);
    const second: unknown[] = [];
    second.push(second, 2);

    expect(createFarmCacheKey([first])).not.toBe(createFarmCacheKey([second]));
  });

  it("does not mark a shared array as circular", () => {
    const shared = [1];

    expect(createFarmCacheKey([shared, shared])).toBe("[[number:1],[number:1]]");
  });
});
