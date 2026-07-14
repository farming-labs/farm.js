export type FarmCacheInvalidationListener = (key: string) => void;

type FarmCacheInvalidationState = {
  listeners: Set<FarmCacheInvalidationListener>;
};

const FARM_CACHE_INVALIDATION_STATE = Symbol.for("farm.cacheInvalidationState");
const globalState = globalThis as typeof globalThis & {
  [FARM_CACHE_INVALIDATION_STATE]?: FarmCacheInvalidationState;
};

function getFarmCacheInvalidationState(): FarmCacheInvalidationState {
  return (globalState[FARM_CACHE_INVALIDATION_STATE] ??= {
    listeners: new Set(),
  });
}

export function notifyFarmCacheInvalidation(key: string): void {
  if (typeof key !== "string" || key.length === 0) return;

  for (const listener of getFarmCacheInvalidationState().listeners) {
    listener(key);
  }
}

export function applyFarmCacheInvalidations(keys: unknown): void {
  if (!Array.isArray(keys)) return;

  for (const key of keys) {
    if (typeof key === "string") {
      notifyFarmCacheInvalidation(key);
    }
  }
}

export function subscribeFarmCacheInvalidation(
  listener: FarmCacheInvalidationListener,
): () => void {
  const state = getFarmCacheInvalidationState();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
