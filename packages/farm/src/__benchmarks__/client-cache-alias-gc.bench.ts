import { bench, describe, expect } from "vitest";
import { FarmClientDataCache } from "../client-cache";

// Control: metadata sweep from f920c090. Fixture has no subscribers/in-flight
// work, so the protected-key set is empty in both versions.
function previousSweep(this: any, swept: Set<string>) {
  for (const key of swept) {
    this.pendingMetadataSweeps.delete(key);
    if (!this.entries.has(key)) this.invalidatedAt.delete(key);
  }
  for (const [alias, target] of this.aliases) {
    if (this.entries.has(alias) || this.listeners.has(alias) || this.inflight.has(alias)) continue;
    const resolved = this.resolveKey(target);
    if (!swept.has(resolved) || this.entries.has(resolved)) continue;
    this.aliases.delete(alias);
    this.invalidatedAt.delete(alias);
  }
}

function workload(count: number, previous: boolean) {
  const cache: any = new FarmClientDataCache({
    subscribeToInvalidation: false,
    gcSweepIntervalMs: false,
  });
  const entries = Array.from(
    { length: count },
    (_, i) => [`key:${i}`, { data: i, updatedAt: 0, staleAt: 1, gcAt: 2 }] as const,
  );
  const aliases = entries.map(([key], i) => [`alias:${i}`, key] as const);
  if (previous) cache.sweepEntryMetadata = previousSweep;
  // Isolate metadata cleanup, not the independent notification optimization.
  cache.emit = () => {};
  const run = () => {
    cache.entries = new Map(entries);
    cache.aliases = new Map(aliases);
    cache.aliasesByTarget = new Map(aliases.map(([alias, target]) => [target, new Set([alias])]));
    for (const [key] of entries) cache.get(key, 3);
  };
  run();
  expect(cache.size).toBe(0);
  expect(cache.aliases.size).toBe(0);
  if (!previous) expect(cache.aliasesByTarget.size).toBe(0);
  return run;
}

for (const count of [100, 1_000])
  describe(`${count} lazily expired entries`, () => {
    bench("previous full alias sweep", workload(count, true));
    bench("targeted reverse edges", workload(count, false));
  });
