import { useSyncExternalStore } from "react";

export type StoreState = Record<string, any>;
export type StoreValueUpdater<T> = T | ((previous: T) => T);
export type StorePatch<T extends StoreState> = Partial<T> | ((state: T) => Partial<T>);
export type StoreListener<T extends StoreState> = (state: T, previousState: T) => void;
export type StoreKeyListener<T extends StoreState, K extends keyof T> = (
  value: T[K],
  previousValue: T[K],
) => void;
export type StoreKeysListener<T extends StoreState, K extends keyof T> = (
  value: Pick<T, K>,
  previousValue: Pick<T, K>,
) => void;

type StoreSubscription<T extends StoreState> = {
  keys: readonly (keyof T)[] | null;
  notify: (state: T, previousState: T) => void;
};

type ReservedStoreKey = "use" | "get" | "set" | "replace" | "reset" | "subscribe";

type FieldAccessor<T extends StoreState, K extends keyof T> = {
  (): T[K];
  get(): T[K];
  set(value: StoreValueUpdater<T[K]>): T[K];
  subscribe(listener: StoreKeyListener<T, K>): () => void;
};

export type StoreFields<T extends StoreState> = {
  [K in keyof T]: FieldAccessor<T, K>;
};

export interface StoreApi<T extends StoreState> {
  use(): T;
  use<K extends keyof T>(key: K): T[K];
  use<K extends keyof T>(keys: readonly K[]): Pick<T, K>;
  get(): T;
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: StoreValueUpdater<T[K]>): T[K];
  set(patch: StorePatch<T>): T;
  replace(nextState: T | ((state: T) => T)): T;
  reset(): T;
  subscribe(listener: StoreListener<T>): () => void;
  subscribe<K extends keyof T>(key: K, listener: StoreKeyListener<T, K>): () => void;
  subscribe<K extends keyof T>(keys: readonly K[], listener: StoreKeysListener<T, K>): () => void;
}

export type Store<T extends StoreState, TMethods extends Record<string, any> = {}> = StoreApi<T> &
  StoreFields<T> &
  TMethods;

const RESERVED_STORE_KEYS = new Set<ReservedStoreKey>([
  "use",
  "get",
  "set",
  "replace",
  "reset",
  "subscribe",
]);

function cloneState<T extends StoreState>(state: T): T {
  return { ...state };
}

function pickState<T extends StoreState, K extends keyof T>(
  state: T,
  keys: readonly K[],
): Pick<T, K> {
  const slice = {} as Pick<T, K>;

  for (const key of keys) {
    slice[key] = state[key];
  }

  return slice;
}

function getChangedKeys<T extends StoreState>(state: T, previousState: T): (keyof T)[] {
  const keys = new Set<keyof T>([
    ...(Object.keys(state) as (keyof T)[]),
    ...(Object.keys(previousState) as (keyof T)[]),
  ]);

  return [...keys].filter((key) => !Object.is(state[key], previousState[key]));
}

function normalizeKeys<T extends StoreState, K extends keyof T>(keys: readonly K[]): readonly K[] {
  return Array.from(new Set(keys));
}

function resolveValue<T>(value: StoreValueUpdater<T>, previousValue: T): T {
  return typeof value === "function" ? (value as (previousValue: T) => T)(previousValue) : value;
}

function isStoreKey(value: unknown): value is string | number | symbol {
  return typeof value === "string" || typeof value === "number" || typeof value === "symbol";
}

export function createStore<T extends StoreState, TMethods extends Record<string, any> = {}>(
  initialState: T,
  extend?: (store: Store<T>) => TMethods,
): Store<T, TMethods> {
  const initialSnapshot = cloneState(initialState);
  let state = cloneState(initialState);
  const subscriptions = new Set<StoreSubscription<T>>();

  const addSubscription = (
    keys: readonly (keyof T)[] | null,
    notify: (state: T, previousState: T) => void,
  ) => {
    const subscription: StoreSubscription<T> = { keys, notify };
    subscriptions.add(subscription);
    return () => {
      subscriptions.delete(subscription);
    };
  };

  const emit = (nextState: T, previousState: T) => {
    const changedKeys = getChangedKeys(nextState, previousState);

    if (changedKeys.length === 0) {
      return;
    }

    const changedKeySet = new Set(changedKeys);

    for (const subscription of subscriptions) {
      if (subscription.keys === null || subscription.keys.some((key) => changedKeySet.has(key))) {
        subscription.notify(nextState, previousState);
      }
    }
  };

  const getState = (key?: keyof T) => {
    return key === undefined ? state : state[key];
  };

  const replaceState = (nextState: T | ((state: T) => T)) => {
    const previousState = state;
    const resolvedState =
      typeof nextState === "function" ? (nextState as (state: T) => T)(previousState) : nextState;
    state = resolvedState;
    emit(state, previousState);
    return state;
  };

  const setState = (keyOrPatch: keyof T | StorePatch<T>, value?: StoreValueUpdater<T[keyof T]>) => {
    const previousState = state;
    let nextState: T;

    if (isStoreKey(keyOrPatch)) {
      const key = keyOrPatch as keyof T;
      const nextValue = resolveValue(value as StoreValueUpdater<T[keyof T]>, previousState[key]);

      if (Object.is(previousState[key], nextValue)) {
        return nextValue;
      }

      nextState = {
        ...previousState,
        [key]: nextValue,
      };
      state = nextState;
      emit(nextState, previousState);
      return nextValue;
    }

    const patch: Partial<T> =
      typeof keyOrPatch === "function"
        ? (keyOrPatch as (state: T) => Partial<T>)(previousState)
        : (keyOrPatch as Partial<T>);

    nextState = {
      ...previousState,
      ...patch,
    };
    state = nextState;
    emit(nextState, previousState);
    return nextState;
  };

  const subscribeState = (
    keyOrListener: keyof T | readonly (keyof T)[] | StoreListener<T>,
    listener?: StoreKeyListener<T, keyof T> | StoreKeysListener<T, keyof T>,
  ) => {
    if (typeof keyOrListener === "function") {
      return addSubscription(null, (nextState, previousState) => {
        (keyOrListener as StoreListener<T>)(nextState, previousState);
      });
    }

    if (Array.isArray(keyOrListener)) {
      const keys = normalizeKeys(keyOrListener);
      return addSubscription(keys, (nextState, previousState) => {
        (listener as StoreKeysListener<T, keyof T>)(
          pickState(nextState, keys),
          pickState(previousState, keys),
        );
      });
    }

    const key = keyOrListener as keyof T;
    return addSubscription([key], (nextState, previousState) => {
      (listener as StoreKeyListener<T, keyof T>)(nextState[key], previousState[key]);
    });
  };

  const useStateValue = <K extends keyof T>(keyOrKeys?: K | readonly K[]) => {
    if (Array.isArray(keyOrKeys)) {
      const keys = normalizeKeys(keyOrKeys);
      let lastState = state;
      let lastSlice = pickState(state, keys);
      const getSnapshot = () => {
        if (lastState !== state) {
          lastState = state;
          lastSlice = pickState(state, keys);
        }

        return lastSlice;
      };

      return useSyncExternalStore(
        (notify) => addSubscription(keys, () => notify()),
        getSnapshot,
        getSnapshot,
      );
    }

    if (typeof keyOrKeys === "string") {
      return useSyncExternalStore(
        (notify) => addSubscription([keyOrKeys], () => notify()),
        () => state[keyOrKeys],
        () => state[keyOrKeys],
      );
    }

    return useSyncExternalStore(
      (notify) => addSubscription(null, () => notify()),
      () => state,
      () => state,
    );
  };

  const store = {
    use: useStateValue,
    get: getState,
    set: setState,
    replace: replaceState,
    reset: () => replaceState(cloneState(initialSnapshot)),
    subscribe: subscribeState,
  } as Store<T>;

  for (const key of Object.keys(initialSnapshot) as (keyof T)[]) {
    if (RESERVED_STORE_KEYS.has(key as ReservedStoreKey)) {
      throw new Error(
        `createStore does not allow the reserved key "${String(key)}" in the initial state.`,
      );
    }

    const field = (() => useStateValue(key)) as FieldAccessor<T, typeof key>;
    field.get = () => state[key];
    field.set = (value) => setState(key, value) as T[typeof key];
    field.subscribe = (listener) => subscribeState(key, listener as StoreKeyListener<T, keyof T>);

    Object.defineProperty(store, key, {
      configurable: false,
      enumerable: true,
      value: field,
      writable: false,
    });
  }

  if (extend) {
    const methods = extend(store);

    for (const [name, method] of Object.entries(methods)) {
      if (name in store) {
        throw new Error(
          `createStore cannot attach the method "${name}" because it already exists.`,
        );
      }

      Object.defineProperty(store, name, {
        configurable: false,
        enumerable: true,
        value: method,
        writable: false,
      });
    }
  }

  return store as Store<T, TMethods>;
}
