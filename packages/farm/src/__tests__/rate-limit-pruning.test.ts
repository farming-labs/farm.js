import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryRateLimitStorage } from "../middleware/chain";
import type { RateLimitIncrementResult } from "../middleware/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("memory rate-limit expiration pruning", () => {
  it("does not scan a full store before any window can expire", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const storage = memoryRateLimitStorage({ maxEntries: 1_000 });
    for (let index = 0; index < 1_000; index++) storage.increment(`key-${index}`, 60_000);
    const iterator = Map.prototype[Symbol.iterator];
    let visits = 0;
    vi.spyOn(Map.prototype, Symbol.iterator).mockImplementation(function* () {
      for (const entry of iterator.call(this)) {
        visits++;
        yield entry;
      }
    });
    for (let index = 0; index < 3; index++) {
      expect(() => storage.increment(`unknown-${index}`, 60_000)).toThrow("active-key capacity");
    }
    expect(visits).toBe(0);
    expect(storage.increment("key-0", 60_000)).toEqual({ count: 2, resetAt: 61_000 });
  });

  it("reclaims expired short windows without evicting longer active windows", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const storage = memoryRateLimitStorage({ maxEntries: 2 });
    storage.increment("long", 10_000);
    storage.increment("short", 100);
    clock.mockReturnValue(1_099);
    expect(() => storage.increment("new", 100)).toThrow("active-key capacity");
    clock.mockReturnValue(1_100);
    expect(storage.increment("new", 100)).toEqual({ count: 1, resetAt: 1_200 });
    expect(storage.get!("short")).toBeNull();
    expect(storage.increment("long", 1)).toEqual({ count: 2, resetAt: 11_000 });
    expect(() => storage.increment("other", 100)).toThrow("active-key capacity");
    clock.mockReturnValue(1_200);
    expect(storage.increment("other", 100)).toEqual({ count: 1, resetAt: 1_300 });
  });

  it("keeps the expiration bound safe after clock rollback and lazy deletion", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(2_000);
    const storage = memoryRateLimitStorage({ maxEntries: 2 });
    storage.increment("future", 10);
    clock.mockReturnValue(1_000);
    storage.increment("earlier", 5);
    clock.mockReturnValue(1_005);
    expect(storage.get!("earlier")).toBeNull();
    storage.increment("replacement", 5);
    expect(() => storage.increment("blocked", 100)).toThrow("active-key capacity");
    clock.mockReturnValue(1_010);
    storage.increment("available", 10_000);
    expect(storage.get!("future")).toEqual({ count: 1, resetAt: 2_010 });
    clock.mockReturnValue(2_010);
    expect(storage.increment("future", 5)).toEqual({ count: 1, resetAt: 2_015 });
  });

  it("returns snapshots so callers cannot corrupt counters or the expiry bound", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const storage = memoryRateLimitStorage({ maxEntries: 1 });
    const first = storage.increment("key", 500) as RateLimitIncrementResult;
    first.resetAt = 0;
    first.count = 100;
    expect(storage.get!("key")).toEqual({ count: 1, resetAt: 1_500 });
    const next = storage.increment("key", 1) as RateLimitIncrementResult;
    next.resetAt = 0;
    next.count = 0;
    expect(storage.get!("key")).toEqual({ count: 2, resetAt: 1_500 });
    expect(() => storage.increment("other", 500)).toThrow("active-key capacity");
  });
});
