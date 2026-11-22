import type { FarmClientStore } from "./renderer-client";

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
  keys: readonly PropertyKey[] | null;
  notify: (state: T, previousState: T) => void;
};

type ReservedStoreKey = "use" | "get" | "getSnapshot" | "set" | "replace" | "reset" | "subscribe";

type FieldAccessor<T extends StoreState, K extends keyof T> = {
  /** Reads the field's current value. */
  (): T[K];
  get(): T[K];
  set(value: StoreValueUpdater<T[K]>): T[K];
  subscribe(listener: StoreKeyListener<T, K>): () => void;
};

export type StoreFields<T extends StoreState> = {
  [K in keyof T]: FieldAccessor<T, K>;
};

/**
 * A store's methods without a renderer. It is a `FarmClientStore`, so any renderer binds it the
 * way it binds Farm's router or query stores.
 */
export interface StoreApi<T extends StoreState> extends FarmClientStore<T> {
  get(): T;
  get<K extends keyof T>(key: K): T[K];
  /** The whole state. Its identity changes only when a value changes. */
  getSnapshot(): T;
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

/**
 * Lets a renderer entry add a `use()` hook to the store. It receives the finished store API and
 * returns the hook; field accessors then call the hook instead of reading the value.
 */
export type StoreUseBinding = (
  store: StoreApi<StoreState>,
) => (keyOrKeys?: PropertyKey | readonly PropertyKey[]) => unknown;

const RESERVED_STORE_KEYS = new Set<ReservedStoreKey>([
  "use",
  "get",
  "getSnapshot",
  "set",
  "replace",
  "reset",
  "subscribe",
]);

function cloneState<T extends StoreState>(state: T): T {
  return { ...state };
}

export function pickStoreState<T extends StoreState, K extends keyof T>(
  state: T,
  keys: readonly K[],
): Pick<T, K> {
  const slice = {} as Pick<T, K>;

  for (const key of keys) {
    slice[key] = state[key];
  }

  return slice;
}

function getEnumerableKeys<T extends StoreState>(state: T): (keyof T)[] {
  return Reflect.ownKeys(state).filter((key) =>
    Object.prototype.propertyIsEnumerable.call(state, key),
  ) as (keyof T)[];
}

function getChangedKeys<T extends StoreState>(state: T, previousState: T): (keyof T)[] {
  const keys = new Set<keyof T>([...getEnumerableKeys(state), ...getEnumerableKeys(previousState)]);

  return [...keys].filter((key) => !Object.is(state[key], previousState[key]));
}

export function normalizeStoreKeys<T extends StoreState, K extends keyof T>(
  keys: readonly K[],
): readonly K[] {
  return Array.from(new Set(keys));
}

function resolveValue<T>(value: StoreValueUpdater<T>, previousValue: T): T {
  return typeof value === "function" ? (value as (previousValue: T) => T)(previousValue) : value;
}

export function isStoreKey(value: unknown): value is string | number | symbol {
  return typeof value === "string" || typeof value === "number" || typeof value === "symbol";
}

/** Builds a store. `bindUse` is how the React entry adds `use()`; without it there is none. */
export function createStoreInstance<
  T extends StoreState,
  TMethods extends Record<string, any> = {},
>(
  initialState: T,
  extend: ((store: any) => TMethods) | undefined,
  bindUse?: StoreUseBinding,
): Store<T, TMethods> {
  const initialSnapshot = cloneState(initialState);
  let state = cloneState(initialState);
  const subscriptions = new Set<StoreSubscription<T>>();

  const addSubscription = (
    keys: readonly (keyof T)[] | null,
    notify: (state: T, previousState: T) => void,
  ) => {
    const subscription: StoreSubscription<T> = {
      // Object property enumeration returns numeric keys as strings.
      keys: keys?.map((key) => (typeof key === "number" ? String(key) : key)) ?? null,
      notify,
    };
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

    const changedKeySet = new Set<PropertyKey>(changedKeys);

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
      const keys = normalizeStoreKeys(keyOrListener);
      return addSubscription(keys, (nextState, previousState) => {
        (listener as StoreKeysListener<T, keyof T>)(
          pickStoreState(nextState, keys),
          pickStoreState(previousState, keys),
        );
      });
    }

    const key = keyOrListener as keyof T;
    return addSubscription([key], (nextState, previousState) => {
      (listener as StoreKeyListener<T, keyof T>)(nextState[key], previousState[key]);
    });
  };

  const store = {
    get: getState,
    getSnapshot: () => state,
    set: setState,
    replace: replaceState,
    reset: () => replaceState(cloneState(initialSnapshot)),
    subscribe: subscribeState,
  } as unknown as Store<T> & { use?: (keyOrKeys?: PropertyKey | readonly PropertyKey[]) => any };

  const use = bindUse?.(store as unknown as StoreApi<StoreState>);
  if (use) store.use = use;

  for (const key of getEnumerableKeys(initialSnapshot)) {
    if (RESERVED_STORE_KEYS.has(key as ReservedStoreKey)) {
      throw new Error(
        `createStore does not allow the reserved key "${String(key)}" in the initial state.`,
      );
    }

    const field = (use ? () => use(key) : () => state[key]) as FieldAccessor<T, typeof key>;
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
      // Reserved even where this store has no such method, so one `extend` works with both entries.
      if (RESERVED_STORE_KEYS.has(name as ReservedStoreKey)) {
        throw new Error(`createStore cannot attach the method "${name}" because it is reserved.`);
      }

      Object.defineProperty(store, name, {
        configurable: false,
        enumerable: true,
        value: method,
        writable: false,
      });
    }
  }

  return store as unknown as Store<T, TMethods>;
}

/**
 * Creates an in-memory store that works with every renderer. Read it with `get()` or a field
 * accessor, and bind it with your renderer's binding (`useStore` in Solid and Vue,
 * `createReadable` in Svelte) or with any code that reads a `FarmClientStore`. React apps can
 * import `createStore` from `@farm.js/core/client` instead, which adds the `use()` hook.
 */
export function createStore<T extends StoreState, TMethods extends Record<string, any> = {}>(
  initialState: T,
  extend?: (store: Store<T>) => TMethods,
): Store<T, TMethods> {
  return createStoreInstance(initialState, extend);
}
