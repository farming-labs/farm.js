"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { getSyncStore, hydrateModel, type SyncModelClient } from "./client.js";
import type { SyncRow, SyncStoreStatus } from "./store.js";

const EMPTY_ROWS: SyncRow[] = [];

export type LiveQueryOptions<TRow> = {
  orderBy?: (row: TRow) => string | number | Date;
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
  enabled?: boolean;
};

export type LiveQueryResult<TRow> = {
  rows: TRow[];
  status: SyncStoreStatus;
  error: Error | null;
  /** Writes in flight against this model. */
  pending: number;
  /** Writes waiting for the connection to return. */
  paused: number;
  isEmpty: boolean;
  refresh(): Promise<void>;
};

/**
 * Subscribe to rows of a model, filtered in the browser.
 *
 * The predicate runs over the model's rows on every change; it never leaves
 * the browser, so any expression is fair game. Which rows reach the device is
 * decided separately by the server's row filter.
 */
export function useLiveQuery<TRow extends SyncRow = SyncRow>(
  model: SyncModelClient,
  predicate?: (row: TRow) => boolean,
  options: LiveQueryOptions<TRow> = {},
): LiveQueryResult<TRow> {
  const name = model.__farmSyncModel;
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

  return {
    rows: visible,
    status,
    error,
    pending,
    paused,
    isEmpty: visible.length === 0,
    refresh: () => model.refresh(),
  };
}

/** Subscribe to a single row by key. */
export function useRow<TRow extends SyncRow = SyncRow>(
  model: SyncModelClient,
  key: unknown,
): TRow | undefined {
  const store = getSyncStore(model.__farmSyncModel);
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
