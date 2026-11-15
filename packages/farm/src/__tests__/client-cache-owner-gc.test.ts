import { describe, expect, it, vi } from "vitest";
import { FarmClientDataCache } from "../client-cache";

const create = () =>
  new FarmClientDataCache({ subscribeToInvalidation: false, gcSweepIntervalMs: false });
const expired = { data: 1, updatedAt: 0, staleAt: 1, gcAt: 2 };

describe("targeted expiry ownership checks", () => {
  it("does not scan unrelated subscriptions or in-flight keys during lazy eviction", () => {
    const cache = create();
    const internal = cache as any;
    const listener = vi.fn();
    for (let i = 0; i < 1_000; i++) {
      cache.set(`expired:${i}`, expired);
      cache.set(`live:${i}`, { data: i, updatedAt: 0, staleAt: Infinity });
      cache.subscribe(`live:${i}`, listener);
      cache.setInflight(`pending:${i}`, Promise.resolve(i));
    }
    let visits = 0;
    for (const map of [internal.listeners, internal.inflight]) {
      const keys = map.keys;
      map.keys = function* () {
        for (const key of keys.call(this)) {
          visits++;
          yield key;
        }
      };
    }
    for (let i = 0; i < 1_000; i++) expect(cache.get(`expired:${i}`, 3)).toBeUndefined();
    expect(visits).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(cache.size).toBe(1_000);
    expect(internal.inflight.size).toBe(1_000);
    expect(internal.pendingMetadataSweeps.size).toBe(0);
    cache.dispose();
  });

  it("keeps shared alias metadata until both watched branches release ownership", () => {
    const cache = create();
    cache.alias("a", "middle");
    cache.alias("b", "middle");
    cache.alias("middle", "target");
    cache.set("target", expired);
    cache.invalidate("target", 1);
    const releaseA = cache.subscribe("a", () => {});
    const releaseB = cache.subscribe("b", () => {});
    cache.get("target", 3);
    releaseA();
    expect(cache.resolveKey("a")).toBe("target");
    expect((cache as any).invalidatedAt.get("target")).toBe(1);
    releaseB();
    expect(cache.resolveKey("a")).toBe("a");
    expect(cache.resolveKey("b")).toBe("b");
    expect((cache as any).aliasesByTarget.size).toBe(0);
    expect((cache as any).invalidatedAt.size).toBe(0);
    cache.dispose();
  });

  it("preserves in-flight ownership migrated from a provisional alias", () => {
    const cache = create();
    cache.set("provisional", expired);
    const work = Promise.resolve(1);
    cache.setInflight("provisional", work);
    cache.alias("provisional", "target");
    cache.invalidate("target", 1);
    cache.get("target", 3);
    expect(cache.getInflight("provisional")).toBe(work);
    expect(cache.resolveKey("provisional")).toBe("target");
    cache.deleteInflight("provisional");
    expect(cache.resolveKey("provisional")).toBe("provisional");
    expect((cache as any).invalidatedAt.size).toBe(0);
    cache.dispose();
  });
});
