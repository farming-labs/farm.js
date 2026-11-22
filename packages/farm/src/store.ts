import { useSyncExternalStore } from "react";
import {
  createStoreInstance,
  isStoreKey,
  normalizeStoreKeys,
  pickStoreState,
  type StoreApi as RendererStoreApi,
  type StoreKeyListener,
  type StoreState,
  type StoreUseBinding,
  type StoreValueUpdater,
} from "./store-core";

export type {
  StoreKeyListener,
  StoreKeysListener,
  StoreListener,
  StorePatch,
  StoreState,
  StoreValueUpdater,
} from "./store-core";

type FieldAccessor<T extends StoreState, K extends keyof T> = {
  /** A React hook that returns the field's value and re-renders when it changes. */
  (): T[K];
  get(): T[K];
  set(value: StoreValueUpdater<T[K]>): T[K];
  subscribe(listener: StoreKeyListener<T, K>): () => void;
};

export type StoreFields<T extends StoreState> = {
  [K in keyof T]: FieldAccessor<T, K>;
};

/** The renderer-neutral store API plus React's `use()` hook. */
export interface StoreApi<T extends StoreState> extends RendererStoreApi<T> {
  use(): T;
  use<K extends keyof T>(key: K): T[K];
  use<K extends keyof T>(keys: readonly K[]): Pick<T, K>;
}

export type Store<T extends StoreState, TMethods extends Record<string, any> = {}> = StoreApi<T> &
  StoreFields<T> &
  TMethods;

const bindReactUse: StoreUseBinding = (store) => (keyOrKeys) => {
  if (Array.isArray(keyOrKeys)) {
    const keys = normalizeStoreKeys(keyOrKeys);
    let lastState = store.getSnapshot();
    let lastSlice = pickStoreState(lastState, keys);
    const getSnapshot = () => {
      const state = store.getSnapshot();
      if (lastState !== state) {
        lastState = state;
        lastSlice = pickStoreState(state, keys);
      }

      return lastSlice;
    };

    return useSyncExternalStore(
      (notify) => store.subscribe(keys, () => notify()),
      getSnapshot,
      getSnapshot,
    );
  }

  if (isStoreKey(keyOrKeys)) {
    // Numeric and symbol keys are valid state keys; the binding's store type only names strings.
    const key = keyOrKeys as string;
    return useSyncExternalStore(
      (notify) => store.subscribe(key, () => notify()),
      () => store.get(key),
      () => store.get(key),
    );
  }

  return useSyncExternalStore(
    (notify) => store.subscribe(() => notify()),
    store.getSnapshot,
    store.getSnapshot,
  );
};

/**
 * Creates an in-memory store with React hooks: `store.use()`, `store.use(key)`, and field
 * accessors such as `store.count()`. Other renderers import the same store, without the hooks,
 * from `@farm.js/core/renderer-client`.
 */
export function createStore<T extends StoreState, TMethods extends Record<string, any> = {}>(
  initialState: T,
  extend?: (store: Store<T>) => TMethods,
): Store<T, TMethods> {
  return createStoreInstance(initialState, extend, bindReactUse) as unknown as Store<T, TMethods>;
}
