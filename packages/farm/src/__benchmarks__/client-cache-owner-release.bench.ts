import { bench, describe, expect } from "vitest";
import { FarmClientDataCache } from "../client-cache";

// Include fixture creation and cleanup in both measurements. The only baseline
// override is the previous pending-sweep method; ownership/removal code is shared.
function cycle(count: number, kind: "subscription" | "request", previous: boolean) {
  const cache: any = new FarmClientDataCache({
    subscribeToInvalidation: false,
    gcSweepIntervalMs: false,
  });
  if (previous) {
    cache.sweepPendingEntryMetadata = function () {
      if (this.pendingMetadataSweeps.size === 0) return;
      this.sweepEntryMetadata(new Set(this.pendingMetadataSweeps));
    };
  }
  const releases: Array<() => void> = [];
  cache.set("live", { data: "control", updatedAt: 0, staleAt: Infinity });
  for (let i = 0; i < count; i++) {
    const key = `key:${i}`;
    if (kind === "subscription") releases.push(cache.subscribe(key, () => {}));
    else {
      cache.setInflight(key, Promise.resolve(i));
      releases.push(() => cache.deleteInflight(key));
    }
    cache.set(key, { data: i, updatedAt: 0, staleAt: 1, gcAt: 2 });
    cache.invalidate(key, 1);
    cache.get(key, 3);
  }
  for (const release of releases) release();
  expect(cache.size).toBe(1);
  expect(cache.get("live", 3)?.data).toBe("control");
  expect(cache.pendingMetadataSweeps.size).toBe(0);
  expect(cache.invalidatedAt.size).toBe(0);
  expect(cache.listeners.size).toBe(0);
  expect(cache.inflight.size).toBe(0);
  cache.dispose();
}

for (const count of [100, 1000]) {
  for (const kind of ["subscription", "request"] as const) {
    describe(`${count} expired entries released by ${kind}`, () => {
      bench("previous global pending sweep", () => cycle(count, kind, true), {
        time: 500,
        iterations: 5,
      });
      bench("targeted pending sweep", () => cycle(count, kind, false), {
        time: 500,
        iterations: 5,
      });
    });
  }
}
