// @vitest-environment node

import { describe, expect, it } from "vitest";
import { materializeIterable } from "../iterable";

describe("materializeIterable", () => {
  it("copies plain arrays, reading holes as undefined like the array iterator", () => {
    const source = [1, , 3]; // oxlint-disable-line no-sparse-arrays
    const items = materializeIterable(source);

    expect(items).not.toBe(source);
    expect(items).toEqual([1, undefined, 3]);
    expect(1 in items).toBe(true);
  });

  it("uses the iterator protocol for arrays that customize iteration", () => {
    class Reversed<Item> extends Array<Item> {
      *[Symbol.iterator](): ArrayIterator<Item> {
        for (let index = this.length - 1; index >= 0; index -= 1) yield this[index];
      }
    }
    const subclassed = Reversed.from([1, 2, 3]) as Reversed<number>;
    const own = [1, 2, 3];
    Object.defineProperty(own, Symbol.iterator, {
      value: function* () {
        yield 42;
      },
    });

    expect(materializeIterable(subclassed)).toEqual([3, 2, 1]);
    expect(materializeIterable(own)).toEqual([42]);
  });

  it("snapshots one-shot iterators once", () => {
    const iterator = new Set(["a", "b"]).values();

    expect(materializeIterable(iterator)).toEqual(["a", "b"]);
    expect(materializeIterable(iterator)).toEqual(["a", "b"]);
  });
});
