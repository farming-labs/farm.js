import fs from "node:fs";

interface SnapshotEntry {
  value: unknown;
  /** The source files computing the value read. */
  files: readonly string[];
}

type SnapshotEntries = Map<string, Map<string, SnapshotEntry>>;

/**
 * What one synchronous source analysis (a hydration plan) has read, parsed and resolved. A plan
 * walks every route's import graph, and the routes of a large app share most of it (a component
 * library, its barrels, the layouts, the packages they import), so without a snapshot a plan read,
 * tokenized, parsed and resolved each shared module once per route that reaches it.
 */
let snapshot: SnapshotEntries | undefined;
// Entries of the active snapshot that only hold for the current plan (a file that was missing).
let volatile: Array<[scope: string, key: string]> | undefined;

// The source files read while `traceFarmSourceReads` runs, so a result can say what it depends on.
let trace: Set<string> | undefined;

function stampOf(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

/**
 * @internal A snapshot the dev server keeps between plans. A replan after an edit then reads,
 * parses and resolves only what the edit changed: each entry stays while every file it read keeps
 * the size and mtime it had when the plan that read it finished. Entries keyed by source text
 * (tokens, import lists, ASTs) cannot go stale; the source text an edit replaces is dropped with
 * them, so the snapshot does not grow with every edit.
 */
export class FarmSourceSnapshotStore {
  readonly entries: SnapshotEntries = new Map();
  private readonly stamps = new Map<string, string>();

  /**
   * Drops the entries that read a file changed on disk since the last plan, or one of `edited`
   * (edits the watcher reported, which a coarse mtime can miss). Returns each such file with the
   * source text the snapshot held for it, if any.
   */
  refresh(edited: Iterable<string> = []): Map<string, string | undefined> {
    const changed = new Map<string, string | undefined>();
    for (const file of edited) changed.set(file, undefined);
    for (const [file, stamp] of this.stamps) {
      if (stampOf(file) !== stamp) changed.set(file, undefined);
    }
    if (changed.size === 0) return changed;
    const replaced = new Set<string>();
    for (const [scope, entries] of this.entries) {
      for (const [key, entry] of entries) {
        if (!entry.files.some((file) => changed.has(file))) continue;
        entries.delete(key);
        if (scope !== "source" || typeof entry.value !== "string") continue;
        replaced.add(entry.value);
        if (changed.has(key)) changed.set(key, entry.value);
      }
    }
    for (const entries of this.entries.values()) {
      for (const source of replaced) entries.delete(source);
    }
    for (const file of changed.keys()) this.stamps.delete(file);
    return changed;
  }

  /** The source text the last plan read for `file`, if it read it. */
  peekSource(file: string): string | undefined {
    const value = this.entries.get("source")?.get(file)?.value;
    return typeof value === "string" ? value : undefined;
  }

  /** Records the stamp of every file an entry read that has none yet. */
  stamp(): void {
    for (const entries of this.entries.values()) {
      for (const entry of entries.values()) {
        for (const file of entry.files) {
          if (!this.stamps.has(file)) this.stamps.set(file, stampOf(file));
        }
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.stamps.clear();
  }
}

/**
 * @internal Runs `operation`, which must be synchronous, with the analysis helpers memoizing what
 * they read and resolve until it returns. Nothing can change a file while a synchronous plan
 * runs, so it sees what it would have seen without the snapshot. With `store`, what it learned is
 * kept for the next plan.
 */
export function withFarmSourceSnapshot<T>(operation: () => T, store?: FarmSourceSnapshotStore): T {
  if (snapshot) return operation();
  const entries = store?.entries ?? new Map();
  snapshot = entries;
  volatile = [];
  try {
    return operation();
  } finally {
    for (const [scope, key] of volatile) entries.get(scope)?.delete(key);
    snapshot = undefined;
    volatile = undefined;
    store?.stamp();
  }
}

/**
 * @internal `compute()`, memoized by `scope` and `key` while a snapshot is active, and computed
 * every time outside one. A memoized answer reports the files its computation read to the active
 * trace again, so a result traced inside a snapshot depends on the same files as outside one. An
 * answer `lasting` rejects (a file that was missing, an import that did not resolve) holds only for
 * the current plan: the next one asks again.
 */
export function memoizeInFarmSourceSnapshot<T>(
  scope: string,
  key: string,
  compute: () => T,
  lasting?: (value: T) => boolean,
): T {
  if (!snapshot) return compute();
  let entries = snapshot.get(scope);
  if (!entries) snapshot.set(scope, (entries = new Map()));
  const memoized = entries.get(key);
  if (memoized) {
    if (trace) for (const file of memoized.files) trace.add(file);
    return memoized.value as T;
  }
  const { result, files } = traceFarmSourceReads(compute);
  entries.set(key, { value: result, files });
  if (lasting && !lasting(result)) volatile?.push([scope, key]);
  return result;
}

/** @internal Reports a source file an analysis read to the active trace. */
export function noteFarmSourceRead(file: string): void {
  trace?.add(file);
}

/**
 * @internal Runs `operation` (synchronous) and returns the source files the analysis read while
 * it ran, nested traces included, so a caller can reuse the result while they are unchanged.
 */
export function traceFarmSourceReads<T>(operation: () => T): { result: T; files: string[] } {
  const outer = trace;
  const files = new Set<string>();
  trace = files;
  try {
    return { result: operation(), files: [...files] };
  } finally {
    trace = outer;
    if (outer) for (const file of files) outer.add(file);
  }
}
