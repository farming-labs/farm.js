/**
 * Pure, DOM-free decisions for the scroll-restoration runtime: per-route
 * scroll keys, sessionStorage key building, and stored-position parsing.
 * Everything here is unit-testable in Node.
 */

export interface ScrollRoute {
  pattern?: string | null;
  params?: Record<string, string>;
}

export interface ScrollLocation {
  pathname: string;
  search?: string;
  hash?: string;
}

export interface ScrollPosition {
  x: number;
  y: number;
}

/** The smallest storage surface the runtime needs. `sessionStorage`
 * satisfies it; a fake object works in tests. */
export interface ScrollStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function stableParams(params: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) {
    sorted[key] = params[key];
  }
  return JSON.stringify(sorted);
}

/**
 * The key a scroll position is saved under for one route.
 *
 * When the navigation session carries a route, the key is the route pattern
 * plus its params (`/posts/[id]#{"id":"7"}`), so every visit to the same
 * route instance shares one saved position and the query string does not
 * split it. When no route is carried — the router does not populate
 * `session.route` today — the key falls back to the pathname, which is the
 * same granularity core uses for its own `farm-scroll-*` keys.
 */
export function scrollKeyFor(location: ScrollLocation, route?: ScrollRoute): string {
  const pattern = route?.pattern?.trim();
  if (pattern) {
    const params = route?.params;
    if (params && Object.keys(params).length > 0) {
      return `${pattern}#${stableParams(params)}`;
    }
    return pattern;
  }
  return location.pathname;
}

/** The `sessionStorage` key for a scroll key. Kept in its own namespace
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

/** Save a scroll position. A throwing or missing storage is ignored —
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
