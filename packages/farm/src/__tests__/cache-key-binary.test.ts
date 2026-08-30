import { describe, expect, it } from "vitest";
import { createFarmCacheKey } from "../cache";

describe("createFarmCacheKey with binary values", () => {
  it("uses ArrayBuffer contents", () => {
    const first = Uint8Array.from([1, 2]).buffer;
    const second = Uint8Array.from([1, 3]).buffer;

    expect(createFarmCacheKey([first])).toBe("[arraybuffer:0102]");
    expect(createFarmCacheKey([first])).not.toBe(createFarmCacheKey([second]));
  });

  it("uses SharedArrayBuffer contents", () => {
    const first = new SharedArrayBuffer(2);
    const second = new SharedArrayBuffer(2);
    new Uint8Array(first).set([1, 2]);
    new Uint8Array(second).set([1, 3]);

    expect(createFarmCacheKey([first])).toBe("[sharedarraybuffer:0102]");
    expect(createFarmCacheKey([first])).not.toBe(createFarmCacheKey([second]));
  });

  it("uses only the visible bytes of a DataView", () => {
    const backing = Uint8Array.from([9, 1, 2, 9]).buffer;
    const sliced = new DataView(backing, 1, 2);
    const sameContents = new DataView(Uint8Array.from([1, 2]).buffer);
    const differentContents = new DataView(Uint8Array.from([1, 3]).buffer);

    expect(createFarmCacheKey([sliced])).toBe("[binary:DataView:0102]");
    expect(createFarmCacheKey([sliced])).toBe(createFarmCacheKey([sameContents]));
    expect(createFarmCacheKey([sliced])).not.toBe(createFarmCacheKey([differentContents]));
  });

  it("keeps binary view types distinct", () => {
    expect(createFarmCacheKey([Uint8Array.from([1, 2])])).not.toBe(
      createFarmCacheKey([Uint8ClampedArray.from([1, 2])]),
    );
  });

  it("does not collide with plain objects containing numeric keys", () => {
    expect(createFarmCacheKey([Uint8Array.from([1, 2])])).not.toBe(
      createFarmCacheKey([{ 0: 1, 1: 2 }]),
    );
  });
});
