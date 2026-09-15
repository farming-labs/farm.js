export type FarmCacheInvalidationListener = (key: string) => void;
export type FarmCacheTaskListener = (task: Promise<void>) => void;

export const FARM_CACHE_INVALIDATION_HEADER = "x-farm-cache-invalidations";

type FarmCacheInvalidationState = {
  listeners: Set<FarmCacheInvalidationListener>;
  taskListeners: Set<FarmCacheTaskListener>;
};

const FARM_CACHE_INVALIDATION_STATE = Symbol.for("farm.cacheInvalidationState");
const globalState = globalThis as typeof globalThis & {
  [FARM_CACHE_INVALIDATION_STATE]?: FarmCacheInvalidationState;
};

function getFarmCacheInvalidationState(): FarmCacheInvalidationState {
  return (globalState[FARM_CACHE_INVALIDATION_STATE] ??= {
    listeners: new Set(),
    taskListeners: new Set(),
  });
}

function formatFarmCacheListenerError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

export function notifyFarmCacheInvalidation(key: string): void {
  if (typeof key !== "string" || key.length === 0) return;

  for (const listener of getFarmCacheInvalidationState().listeners) {
    // Isolate listeners: one throwing observer must not abort the remaining
    // listeners (or the rest of a multi-key batch in applyFarmCacheInvalidations)
    // and must not surface as a 500 when invalidation runs inside a request.
    try {
      listener(key);
    } catch (error) {
      console.warn(
        `[farm:cache] invalidation listener failed: ${formatFarmCacheListenerError(error)}`,
      );
    }
  }
}

export function notifyFarmCacheTask(task: Promise<void>): void {
  for (const listener of getFarmCacheInvalidationState().taskListeners) {
    try {
      listener(task);
    } catch (error) {
      console.warn(
        `[farm:cache] task listener failed: ${formatFarmCacheListenerError(error)}`,
      );
    }
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

export function encodeFarmCacheInvalidations(keys: readonly string[]): string | null {
  const normalized = Array.from(
    new Set(keys.filter((key) => typeof key === "string" && key.length > 0)),
  );
  if (normalized.length === 0) return null;
  return encodeURIComponent(JSON.stringify(normalized));
}

export function decodeFarmCacheInvalidations(value: string | null | undefined): readonly string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed)
      ? Array.from(
          new Set(parsed.filter((key): key is string => typeof key === "string" && key.length > 0)),
        )
      : [];
  } catch {
    return [];
  }
}

export function subscribeFarmCacheInvalidation(
  listener: FarmCacheInvalidationListener,
): () => void {
  const state = getFarmCacheInvalidationState();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function subscribeFarmCacheTask(listener: FarmCacheTaskListener): () => void {
  const state = getFarmCacheInvalidationState();
  state.taskListeners.add(listener);
  return () => state.taskListeners.delete(listener);
}
