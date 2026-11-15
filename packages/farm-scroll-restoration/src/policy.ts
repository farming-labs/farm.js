/**
 * Pure, DOM-free decisions for the scroll-restoration runtime: history entry
 * ids, sessionStorage key building, and stored-position parsing.
 */

export interface ScrollPosition {
  x: number;
  y: number;
}

/** The smallest storage surface the runtime needs. `sessionStorage`
 * satisfies it. */
export interface ScrollStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The `history.state` field that names a history entry for this plugin. */
export const SCROLL_ENTRY_STATE_KEY = "__farmScrollEntry";

/**
 * The id stored in a history entry's state, or `undefined` when the entry
 * has none. Positions are saved per history entry, like the browser and
 * React Router do, so the same URL twice in history keeps two positions.
 */
export function readScrollEntryId(state: unknown): string | undefined {
  if (!state || typeof state !== "object") return undefined;
  const id = (state as Record<string, unknown>)[SCROLL_ENTRY_STATE_KEY];
  return typeof id === "string" && id.length > 0 && id.length <= 64 ? id : undefined;
}

/** A new history entry id. It includes the time so ids stay unique across
 * reloads, which keep `sessionStorage`. */
export function createScrollEntryId(random: () => number = Math.random): string {
  return `${Date.now().toString(36)}-${random().toString(36).slice(2, 10)}`;
}

/** The `sessionStorage` key for a history entry id. Kept in its own namespace
 * (`farm-scroll-restore:*`) so this plugin never reads or overwrites
 * core's `farm-scroll-*` entries. */
export function scrollStorageKey(prefix: string, key: string): string {
  return `${prefix}:${key}`;
}

export function isValidScrollPosition(value: unknown): value is ScrollPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return (
    typeof x === "number" &&
    Number.isFinite(x) &&
    x >= 0 &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    y >= 0
  );
}

/** Parse a stored scroll position. Never throws: malformed JSON, a wrong
 * shape, or an out-of-range value all read as "nothing saved". */
export function parseStoredScrollPosition(raw: string | null): ScrollPosition | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidScrollPosition(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Read a saved scroll position. A throwing or missing storage reads as
 * "nothing saved". */
export function readStoredScrollPosition(
  storage: ScrollStorage | null | undefined,
  storageKey: string,
): ScrollPosition | undefined {
  if (!storage) return undefined;
  try {
    return parseStoredScrollPosition(storage.getItem(storageKey));
  } catch {
    return undefined;
  }
}

/** Save a scroll position. A throwing or missing storage is ignored:
 * scroll restoration is best-effort and must never break a navigation. */
export function writeStoredScrollPosition(
  storage: ScrollStorage | null | undefined,
  storageKey: string,
  position: ScrollPosition,
): void {
  if (!storage) return;
  try {
    storage.setItem(storageKey, JSON.stringify(position));
  } catch {
    // Ignore storage errors (private mode, quota, disabled storage).
  }
}
