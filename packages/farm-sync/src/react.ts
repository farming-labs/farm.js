"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  getSyncModelClient,
  getSyncStore,
  hydrateModel,
  runSyncAction,
  type SyncInsertOf,
  type SyncModelClient,
  type SyncModelName,
  type SyncMutationHandle,
  type SyncRowOf,
} from "./client.js";
import type { SyncRow, SyncStoreStatus, SyncWriteFailure } from "./store.js";

export type { SyncModelInputs, SyncModels } from "./client.js";

const EMPTY_ROWS: SyncRow[] = [];
const EMPTY_FAILURES: readonly SyncWriteFailure[] = [];

/** A model reference: its generated name, or a legacy client handle. */
type SyncModelRef = SyncModelName | SyncModelClient;

function resolveModelName(model: SyncModelRef): string {
  return typeof model === "string" ? model : model.__farmSyncModel;
}

export type LiveQueryOptions<TRow> = {
  orderBy?: (row: TRow) => string | number | Date;
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
  enabled?: boolean;
};

export type LiveQueryResult<TRow, TInsert = TRow> = {
  rows: TRow[];
  status: SyncStoreStatus;
  error: Error | null;
  /** Writes in flight against this model. */
  pending: number;
  /** Writes waiting for the connection to return. */
  paused: number;
  /** Same as `paused`, named for what the user sees: queued until reconnect. */
  queued: number;
  isEmpty: boolean;
  refresh(): Promise<void>;

  /** @deprecated A query result is for reading; write through `useSyncAction(model).insert`. */
  insert(input: TInsert): SyncMutationHandle<TRow>;
  /** @deprecated Write through `useSyncAction(model).update`. */
  update(key: unknown, patch: Partial<TRow>): SyncMutationHandle<TRow>;
  /** @deprecated Write through `useSyncAction(model).delete`. */
  delete(key: unknown): SyncMutationHandle<TRow>;

  /** True once the server confirmed this row; false while it is optimistic. */
  isPersisted(row: TRow): boolean;
  /** Rolled-back writes awaiting the user, each with retry() and dismiss(). */
  failures: readonly SyncWriteFailure[];
};

/**
 * Subscribe to rows of a model, filtered in the browser.
 *
 * The predicate runs over the model's rows on every change; it never leaves
 * the browser, so any expression is fair game. Which rows reach the device is
 * decided separately by the server's row filter.
 */
export function useLiveQuery<K extends SyncModelName>(
  model: K,
  predicate?: (row: SyncRowOf<K>) => boolean,
  options?: LiveQueryOptions<SyncRowOf<K>>,
): LiveQueryResult<SyncRowOf<K>, SyncInsertOf<K>>;
export function useLiveQuery<TRow extends SyncRow = SyncRow>(
  model: SyncModelClient,
  predicate?: (row: TRow) => boolean,
  options?: LiveQueryOptions<TRow>,
): LiveQueryResult<TRow>;
export function useLiveQuery<TRow extends SyncRow = SyncRow>(
  model: SyncModelRef,
  predicate?: (row: TRow) => boolean,
  options: LiveQueryOptions<TRow> = {},
): LiveQueryResult<TRow> {
  const name = resolveModelName(model);
  const store = getSyncStore(name);

  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);

  // Rows live in the browser, so the server has none. Both sides must agree on
  // that first snapshot or hydration mismatches; the real rows arrive on the
  // store's first update right after.
  const rows = useSyncExternalStore(
    subscribe,
    () => store.getRows(),
    () => EMPTY_ROWS,
  );
  const status = useSyncExternalStore(
    subscribe,
    () => store.status,
    () => "loading" as SyncStoreStatus,
  );
  const error = useSyncExternalStore(
    subscribe,
    () => store.error,
    () => null,
  );
  const pending = useSyncExternalStore(
    subscribe,
    () => store.pending,
    () => 0,
  );
  const paused = useSyncExternalStore(
    subscribe,
    () => store.paused,
    () => 0,
  );
  const failures = useSyncExternalStore(
    subscribe,
    () => store.failures,
    () => EMPTY_FAILURES,
  );

  useEffect(() => {
    if (options.enabled === false) return;
    hydrateModel(name);
  }, [name, options.enabled]);

  // The memo depends on the real predicate and options, not refs: a predicate
  // that closes over changed state (row => row.status === filter) must produce
  // fresh rows on the next render, not stay frozen until some row mutates. An
  // inline arrow recomputes every render, which is the correct trade; a caller
  // with a large collection keeps memoization by passing a stable predicate.
  const visible = useMemo(() => {
    let result = predicate ? (rows as TRow[]).filter((row) => predicate(row)) : (rows as TRow[]);

    if (options.orderBy) {
      const direction = options.direction === "desc" ? -1 : 1;
      const orderBy = options.orderBy;
      result = [...result].sort((a, b) => {
        const left = orderBy(a);
        const right = orderBy(b);
        if (left === right) return 0;
        return (left < right ? -1 : 1) * direction;
      });
    }
    if (options.offset || options.limit !== undefined) {
      const start = options.offset ?? 0;
      result = result.slice(start, options.limit === undefined ? undefined : start + options.limit);
    }
    return result;
  }, [rows, predicate, options.orderBy, options.direction, options.offset, options.limit]);

  const client = useMemo(() => getSyncModelClient(name), [name]);

  return {
    rows: visible,
    status,
    error,
    pending,
    paused,
    queued: paused,
    isEmpty: visible.length === 0,
    refresh: () => client.refresh(),
    insert: (input) => client.insert(input as SyncRow) as SyncMutationHandle<TRow>,
    update: (key, patch) =>
      client.update({
        ...patch,
        [store.descriptor.key]: key,
      } as SyncRow) as SyncMutationHandle<TRow>,
    delete: (key) =>
      client.delete({ [store.descriptor.key]: key } as SyncRow) as SyncMutationHandle<TRow>,
    isPersisted: (row) => store.isPersisted(row as SyncRow),
    failures,
  };
}

/** Subscribe to a single row by key. */
export function useRow<K extends SyncModelName>(model: K, key: unknown): SyncRowOf<K> | undefined;
export function useRow<TRow extends SyncRow = SyncRow>(
  model: SyncModelClient,
  key: unknown,
): TRow | undefined;
export function useRow<TRow extends SyncRow = SyncRow>(
  model: SyncModelRef,
  key: unknown,
): TRow | undefined {
  const store = getSyncStore(resolveModelName(model));
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const rows = useSyncExternalStore(
    subscribe,
    () => store.getRows(),
    () => store.getRows(),
  );
  return useMemo(
    () => (rows as TRow[]).find((row) => String(row[store.descriptor.key]) === String(key)),
    [rows, key, store.descriptor.key],
  );
}

export type SyncActionOptions<K extends SyncModelName, TInput> = {
  /**
   * What to show while the server decides, for transitions the input does not
   * spell out. Left out, input fields that are schema columns become the
   * patch; failing that the screen updates when the server's rows arrive.
   */
  optimistic?: Partial<SyncRowOf<K>> | ((input: TInput) => Partial<SyncRowOf<K>>);
  /** Name shown in the failures queue; defaults to the function's name. */
  name?: string;
};

export type SyncAction<TInput, TRow> = ((input: TInput) => SyncMutationHandle<TRow>) & {
  /** Calls persisting right now. */
  inFlight: number;
  /** Calls waiting for the connection to return. */
  queued: number;
  /** Rolled-back calls awaiting the user, shared with the model's store. */
  failures: readonly SyncWriteFailure[];
};

/** The plain write surface of a model, with the shared durability counters. */
export type SyncModelActions<TRow, TInsert = TRow> = {
  insert(input: TInsert): SyncMutationHandle<TRow>;
  update(key: unknown, patch: Partial<TRow>): SyncMutationHandle<TRow>;
  delete(key: unknown): SyncMutationHandle<TRow>;
  /** Writes persisting right now. */
  inFlight: number;
  /** Writes waiting for the connection to return. */
  queued: number;
  /** Rolled-back writes awaiting the user, shared with the model's store. */
  failures: readonly SyncWriteFailure[];
};

/**
 * The mutation side of a model. `useLiveQuery` reads; this writes.
 *
 * The model-name form is the plain CRUD surface. The function form binds a
 * server-defined action so calling it behaves like every other sync write:
 * an optimistic layer when the effect is predictable, the returned rows
 * committed into the store every live query reads, rollback into the
 * failures queue when the server refuses.
 */
export function useSyncAction<K extends SyncModelName>(
  model: K,
): SyncModelActions<SyncRowOf<K>, SyncInsertOf<K>>;
export function useSyncAction<K extends SyncModelName, TInput>(
  fn: (input: TInput) => Promise<unknown>,
  // The model is its own argument, not an options field, so TypeScript fixes
  // K before it contextually types the optimistic callback. In one options
  // object the two infer in the same round and the patch widens to string.
  model: K,
  options?: SyncActionOptions<K, TInput>,
): SyncAction<TInput, SyncRowOf<K>>;
export function useSyncAction<K extends SyncModelName, TInput>(
  fnOrModel: ((input: TInput) => Promise<unknown>) | K,
  maybeModel?: K,
  options: SyncActionOptions<K, TInput> = {},
): SyncAction<TInput, SyncRowOf<K>> | SyncModelActions<SyncRowOf<K>, SyncInsertOf<K>> {
  const fn = typeof fnOrModel === "function" ? fnOrModel : undefined;
  const model = (typeof fnOrModel === "string" ? fnOrModel : maybeModel) as string;
  const store = getSyncStore(model);

  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const failures = useSyncExternalStore(
    subscribe,
    () => store.failures,
    () => EMPTY_FAILURES,
  );
  const inFlight = useSyncExternalStore(
    subscribe,
    () => store.pending,
    () => 0,
  );
  const queued = useSyncExternalStore(
    subscribe,
    () => store.paused,
    () => 0,
  );

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const fnRef = useRef(fn);
  fnRef.current = fn;

  if (!fn) {
    const client = getSyncModelClient(model);
    const crud: SyncModelActions<SyncRowOf<K>, SyncInsertOf<K>> = {
      insert: (input) => client.insert(input as SyncRow) as SyncMutationHandle<SyncRowOf<K>>,
      update: (key, patch) =>
        client.update({ ...patch, [store.descriptor.key]: key } as SyncRow) as SyncMutationHandle<
          SyncRowOf<K>
        >,
      delete: (key) =>
        client.delete({ [store.descriptor.key]: key } as SyncRow) as SyncMutationHandle<
          SyncRowOf<K>
        >,
      inFlight,
      queued,
      failures,
    };
    return crud;
  }

  const call = (input: TInput) => {
    const current = optionsRef.current;
    const bound = fnRef.current!;
    return runSyncAction(
      model,
      current.name || bound.name || "action",
      (value) => bound(value as TInput),
      input,
      (typeof current.optimistic === "function" ? current.optimistic(input) : current.optimistic) as
        | SyncRow
        | undefined,
    ) as SyncMutationHandle<SyncRowOf<K>>;
  };
  call.inFlight = inFlight;
  call.queued = queued;
  call.failures = failures;

  return call as SyncAction<TInput, SyncRowOf<K>>;
}
