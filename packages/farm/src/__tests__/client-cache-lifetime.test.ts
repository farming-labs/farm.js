// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { notifyFarmCacheInvalidation } from "../cache-invalidation";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function setup(finalizers = true) {
  vi.resetModules();
  const references: Array<{ value: object | undefined }> = [];
  const registrations: Array<{ target: object; cleanup: () => void; token: object }> = [];
  const unregister = vi.fn();
  vi.stubGlobal(
    "WeakRef",
    class {
      value: object | undefined;
      constructor(value: object) {
        this.value = value;
        references.push(this);
      }
      deref() {
        return this.value;
      }
    },
  );
  vi.stubGlobal(
    "FinalizationRegistry",
    finalizers
      ? class {
          constructor(private cleanup: (held: () => void) => void) {}
          register(target: object, held: () => void, token: object) {
            registrations.push({ target, cleanup: () => this.cleanup(held), token });
          }
          unregister = unregister;
        }
      : undefined,
  );
  const { FarmClientDataCache } = await import("../client-cache");
  const state = (globalThis as any)[Symbol.for("farm.cacheInvalidationState")];
  return {
    FarmClientDataCache,
    references,
    registrations,
    unregister,
    listeners: state.listeners as Set<unknown>,
  };
}

it("keeps live caches invalidated and unregisters their subscription on finalization", async () => {
  const { FarmClientDataCache, registrations, listeners } = await setup();
  const before = listeners.size;
  const cache = new FarmClientDataCache();
  cache.set("private", { data: "value", updatedAt: 1, staleAt: Infinity });
  notifyFarmCacheInvalidation("private");
  expect(cache.isStale("private")).toBe(true);
  const registration = registrations.find((entry) => entry.target === cache);
  expect(registration).toBeDefined();
  registration!.cleanup();
  expect(listeners.size).toBe(before);
});

it("removes dead subscriptions on invalidation when finalizers are unavailable", async () => {
  const { FarmClientDataCache, references, listeners } = await setup(false);
  const before = listeners.size;
  const cache = new FarmClientDataCache();
  const reference = references.find((entry) => entry.value === cache);
  expect(reference).toBeDefined();
  reference!.value = undefined; // deterministic stand-in for collection
  notifyFarmCacheInvalidation("unrelated");
  expect(listeners.size).toBe(before);
});

it("unregisters finalizers during explicit disposal without affecting other caches", async () => {
  const { FarmClientDataCache, registrations, unregister, listeners } = await setup();
  const before = listeners.size;
  const cache = new FarmClientDataCache();
  const other = new FarmClientDataCache();
  const registration = registrations.find((entry) => entry.target === cache);
  cache.dispose();
  cache.dispose();
  expect(registration).toBeDefined();
  expect(unregister).toHaveBeenCalledWith(registration!.token);
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(listeners.size).toBe(before + 1);
  other.set("live", { data: "value", updatedAt: 1, staleAt: Infinity });
  notifyFarmCacheInvalidation("live");
  expect(other.isStale("live")).toBe(true);
  other.dispose();
});

it("does not subscribe request-local caches", async () => {
  const { FarmClientDataCache, registrations, listeners } = await setup();
  const before = listeners.size;
  const cache = new FarmClientDataCache({ subscribeToInvalidation: false });
  expect(registrations.some((entry) => entry.target === cache)).toBe(false);
  expect(listeners.size).toBe(before);
  cache.dispose();
});

it("preserves invalidation and disposal on runtimes without WeakRef", async () => {
  const { FarmClientDataCache, listeners } = await setup();
  vi.stubGlobal("WeakRef", undefined);
  const before = listeners.size;
  const cache = new FarmClientDataCache();
  cache.set("fallback", { data: "value", updatedAt: 1, staleAt: Infinity });
  notifyFarmCacheInvalidation("fallback");
  expect(cache.isStale("fallback")).toBe(true);
  cache.dispose();
  expect(listeners.size).toBe(before);
});
