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

  /** Write straight into the local store; the engine persists it behind you. */
  insert(input: TInsert): SyncMutationHandle<TRow>;
  update(key: unknown, patch: Partial<TRow>): SyncMutationHandle<TRow>;
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

  const predicateRef = useRef(predicate);
  predicateRef.current = predicate;
  const optionsRef = useRef(options);
  optionsRef.current = options;

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

  // Recompute only when the underlying rows change; the predicate is read from
  // a ref so an inline arrow does not invalidate the memo every render.
  const visible = useMemo(() => {
    const current = predicateRef.current;
    const opts = optionsRef.current;
    let result = current ? (rows as TRow[]).filter((row) => current(row)) : (rows as TRow[]);

    if (opts.orderBy) {
      const direction = opts.direction === "desc" ? -1 : 1;
      result = [...result].sort((a, b) => {
        const left = opts.orderBy!(a);
        const right = opts.orderBy!(b);
        if (left === right) return 0;
        return (left < right ? -1 : 1) * direction;
      });
    }
    if (opts.offset || opts.limit !== undefined) {
      const start = opts.offset ?? 0;
      result = result.slice(start, opts.limit === undefined ? undefined : start + opts.limit);
    }
    return result;
  }, [rows]);

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

/**
 * Bind a server-defined function to a model so calling it behaves like every
 * other sync write: an optimistic layer when the effect is predictable, the
 * returned rows committed into the store every live query reads, rollback
 * into the failures queue when the server refuses.
 */
export function useSyncAction<K extends SyncModelName, TInput>(
  fn: (input: TInput) => Promise<unknown>,
  // The model is its own argument, not an options field, so TypeScript fixes
  // K before it contextually types the optimistic callback. In one options
  // object the two infer in the same round and the patch widens to string.
  model: K,
  options: SyncActionOptions<K, TInput> = {},
): SyncAction<TInput, SyncRowOf<K>> {
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

  const call = (input: TInput) => {
    const current = optionsRef.current;
    return runSyncAction(
      model as string,
      current.name || fnRef.current.name || "action",
      (value) => fnRef.current(value as TInput),
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
