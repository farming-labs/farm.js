import { bench, describe, expect } from "vitest";
import { FarmClientDataCache } from "../client-cache";

function workload(count: number, previous: boolean) {
  const cache: any = new FarmClientDataCache({
    subscribeToInvalidation: false,
    gcSweepIntervalMs: false,
  });
  const expired = Array.from(
    { length: count },
    (_, i) => [`expired:${i}`, { data: i, updatedAt: 0, staleAt: 1, gcAt: 2 }] as const,
  );
  const live = Array.from(
    { length: count },
    (_, i) => [`live:${i}`, { data: i, updatedAt: 0, staleAt: Infinity }] as const,
  );
  for (const [key, entry] of live) {
    cache.set(key, entry);
    cache.subscribe(key, () => {
      throw new Error("unrelated listener invoked");
    });
  }
  if (previous) {
    // Previous sweep's ownership check, for the single-key lazy-eviction case.
    // Keep the same removal code and fixture to isolate the global owner scan.
    cache.hasMetadataOwner = function (key: string) {
      const protectedKeys = new Set<string>();
      for (const owner of this.listeners.keys()) protectedKeys.add(this.resolveKey(owner));
      for (const owner of this.inflight.keys()) protectedKeys.add(this.resolveKey(owner));
      return protectedKeys.has(key);
    };
  }
  const run = () => {
    cache.entries = new Map([...live, ...expired]);
    for (const [key] of expired) cache.get(key, 3);
  };
  run();
  expect(cache.size).toBe(count);
  for (const [key] of live) expect(cache.get(key, 3)?.data).toBeDefined();
  expect(cache.pendingMetadataSweeps.size).toBe(0);
  return run;
}

for (const count of [100, 1_000])
  describe(`${count} expired entries + ${count} unrelated subscriptions`, () => {
    bench("previous global owner scan", workload(count, true));
    bench("targeted owner check", workload(count, false));
  });
