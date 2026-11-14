/**
 * What one synchronous source analysis (a hydration plan) has read, parsed and resolved. A plan
 * walks every route's import graph, and the routes of a large app share most of it (a component
 * library, its barrels, the layouts, the packages they import), so without a snapshot a plan read,
 * tokenized, parsed and resolved each shared module once per route that reaches it.
 */
let snapshot: Map<string, Map<string, { value: unknown; files: readonly string[] }>> | undefined;

// The source files read while `traceFarmSourceReads` runs, so a result can say what it depends on.
let trace: Set<string> | undefined;

/**
 * @internal Runs `operation`, which must be synchronous, with the analysis helpers memoizing what
 * they read and resolve until it returns. Nothing can change a file while a synchronous plan
 * runs, so it sees what it would have seen without the snapshot.
 */
export function withFarmSourceSnapshot<T>(operation: () => T): T {
  if (snapshot) return operation();
  snapshot = new Map();
  try {
    return operation();
  } finally {
    snapshot = undefined;
  }
}

/**
 * @internal `compute()`, memoized by `scope` and `key` while a snapshot is active, and computed
 * every time outside one. A memoized answer reports the files its computation read to the active
 * trace again, so a result traced inside a snapshot depends on the same files as outside one.
 */
export function memoizeInFarmSourceSnapshot<T>(scope: string, key: string, compute: () => T): T {
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
