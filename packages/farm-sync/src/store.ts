export type SyncRow = Record<string, unknown>;

export type SyncModelDescriptor = {
  key: string;
  access: "read" | "write";
  persist: boolean;
  cursor: string | null;
  /** Schema column names, for deriving an action's optimistic patch from its
   *  input. Absent on configs emitted before this field existed. */
  fields?: readonly string[];
};

export type SyncRuntimeConfig = {
  path: string;
  models: Record<string, SyncModelDescriptor>;
};

export type SyncStoreStatus = "idle" | "loading" | "ready" | "error";

/** A write the server refused, kept until the user retries or dismisses it. */
export type SyncWriteFailure = {
  id: number;
  /** "insert" | "update" | "delete", or a server action name. */
  operation: string;
  input: unknown;
  error: Error;
  at: number;
  /** Re-apply the optimistic state and send the write again. */
  retry: () => unknown;
  dismiss: () => void;
};

type OptimisticLayer =
  | { type: "upsert"; key: unknown; row: SyncRow }
  | { type: "delete"; key: unknown };

/**
 * In-memory rows for one model: confirmed server rows plus an ordered stack of
 * optimistic layers. Visible rows are the confirmed set with layers applied, so
 * a rollback is removing one layer rather than reconstructing prior state.
 */
export class SyncModelStore {
  private confirmed = new Map<string, SyncRow>();
  private layers: OptimisticLayer[] = [];
  private listeners = new Set<() => void>();
  private snapshot: SyncRow[] = [];
  private snapshotDirty = true;

  status: SyncStoreStatus = "idle";
  error: Error | null = null;
  cursor: string | null = null;
  pending = 0;
  paused = 0;
  /** Rolled-back writes awaiting the user. Replaced, never mutated, so a
   *  useSyncExternalStore snapshot of it stays referentially stable. */
  failures: readonly SyncWriteFailure[] = [];
  private nextFailureId = 1;

  constructor(
    readonly name: string,
    readonly descriptor: SyncModelDescriptor,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stable array identity between changes so `useSyncExternalStore` stays quiet. */
  getRows(): SyncRow[] {
    if (!this.snapshotDirty) return this.snapshot;

    const rows = new Map(this.confirmed);
    for (const layer of this.layers) {
      const id = String(layer.key);
      if (layer.type === "delete") rows.delete(id);
      else rows.set(id, layer.row);
    }

    this.snapshot = Array.from(rows.values());
    this.snapshotDirty = false;
    return this.snapshot;
  }

  get(key: unknown): SyncRow | undefined {
    return this.getRows().find((row) => String(row[this.descriptor.key]) === String(key));
  }

  setStatus(status: SyncStoreStatus, error: Error | null = null): void {
    this.status = status;
    this.error = error;
    this.emit();
  }

  /** Apply a server snapshot or delta. A full result replaces confirmed rows. */
  applyServerRows(rows: SyncRow[], options: { full: boolean; cursor: string | null }): void {
    if (options.full) this.confirmed.clear();
    for (const row of rows) {
      this.confirmed.set(String(row[this.descriptor.key]), row);
    }
    this.cursor = options.cursor ?? this.cursor;
    this.status = "ready";
    this.error = null;
    this.invalidate();
  }

  addLayer(layer: OptimisticLayer): () => void {
    this.layers.push(layer);
    this.invalidate();
    return () => this.removeLayer(layer);
  }

  removeLayer(layer: OptimisticLayer): void {
    const index = this.layers.indexOf(layer);
    if (index === -1) return;
    this.layers.splice(index, 1);
    this.invalidate();
  }

  /** Fold a confirmed server row in and drop the layer that predicted it. */
  commitLayer(layer: OptimisticLayer, confirmed: SyncRow | null): void {
    const index = this.layers.indexOf(layer);
    if (index !== -1) this.layers.splice(index, 1);

    if (layer.type === "delete") {
      this.confirmed.delete(String(layer.key));
    } else if (confirmed) {
      this.confirmed.set(String(confirmed[this.descriptor.key] ?? layer.key), confirmed);
    } else {
      this.confirmed.set(String(layer.key), layer.row);
    }
    this.invalidate();
  }

  mergeRow(key: unknown, changes: SyncRow): SyncRow {
    const current = this.get(key) ?? { [this.descriptor.key]: key };
    return { ...current, ...changes };
  }

  /** Rows worth persisting: confirmed only, never optimistic guesses. */
  confirmedRows(): SyncRow[] {
    return Array.from(this.confirmed.values());
  }

  hydrate(rows: SyncRow[], cursor: string | null): void {
    if (this.confirmed.size > 0) return; // live data always wins
    for (const row of rows) {
      this.confirmed.set(String(row[this.descriptor.key]), row);
    }
    this.cursor = cursor;
    if (rows.length > 0) this.status = "ready";
    this.invalidate();
  }

  /** True when no optimistic layer still shadows this row's key. */
  isPersisted(row: SyncRow): boolean {
    const key = String(row[this.descriptor.key]);
    return !this.layers.some((layer) => String(layer.key) === key);
  }

  recordFailure(entry: {
    operation: string;
    input: unknown;
    error: Error;
    retry: () => unknown;
  }): void {
    const id = this.nextFailureId++;
    const failure: SyncWriteFailure = {
      id,
      operation: entry.operation,
      input: entry.input,
      error: entry.error,
      at: Date.now(),
      // Retrying is a fresh write; the stale entry goes first so a second
      // refusal records once instead of stacking duplicates.
      retry: () => {
        this.dismissFailure(id);
        return entry.retry();
      },
      dismiss: () => this.dismissFailure(id),
    };
    this.failures = [...this.failures, failure];
    this.emit();
  }

  dismissFailure(id: number): void {
    if (!this.failures.some((failure) => failure.id === id)) return;
    this.failures = this.failures.filter((failure) => failure.id !== id);
    this.emit();
  }

  trackPending(delta: number): void {
    this.pending = Math.max(0, this.pending + delta);
    this.emit();
  }

  trackPaused(delta: number): void {
    this.paused = Math.max(0, this.paused + delta);
    this.emit();
  }

  private invalidate(): void {
    this.snapshotDirty = true;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
