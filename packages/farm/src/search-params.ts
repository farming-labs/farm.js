/**
 * Convert URLSearchParams into the object handed to routes as `search` /
 * `searchParams`: single keys stay strings and repeated keys collect into
 * arrays, in order. The dev renderer, the production SSR entry, the SPA
 * page-data endpoint, and the generated client hydration runtime all share
 * this helper so every environment agrees on one representation.
 */
export function searchParamsToObject(
  searchParams: URLSearchParams,
): Record<string, string | string[] | undefined> {
  const output: Record<string, string | string[] | undefined> = {};

  searchParams.forEach((value, key) => {
    // Keys come from the request URL. Writing "__proto__" onto a plain object
    // replaces its prototype instead of adding an entry, so a crafted query
    // string could reshape the object handed to pages and workflow handlers.
    // The API route helper (entriesToObject in api/runtime.ts) already skips
    // these names; keep both representations consistent.
    if (key === "__proto__" || key === "constructor" || key === "prototype") return;
    const existing = Object.prototype.hasOwnProperty.call(output, key) ? output[key] : undefined;
    if (existing !== undefined) {
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        output[key] = [existing, value];
      }
    } else {
      output[key] = value;
    }
  });

  return output;
}

/** Page and layout `searchParams`: a promise (Farm's contract) whose query keys also read directly. */
export type FarmSearchParams<TSearch = Record<string, string | string[] | undefined>> =
  Promise<TSearch> & Readonly<TSearch>;

// Promise members, and names an object must never own as data.
const RESERVED_SEARCH_KEYS = new Set([
  "then",
  "catch",
  "finally",
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * The `searchParams` a page receives: `await searchParams` (Farm's typed contract) and
 * `searchParams.key` (as the RSC engine passes it, a plain object) both read the query, so a
 * page works on either engine. `then`, `catch` and `finally` are read only with `await`.
 */
export function createFarmSearchParams<TSearch extends object>(
  search: TSearch,
): FarmSearchParams<TSearch> {
  const promise = Promise.resolve(search) as unknown as FarmSearchParams<TSearch>;
  for (const key of Object.keys(search)) {
    if (RESERVED_SEARCH_KEYS.has(key)) continue;
    Object.defineProperty(promise, key, {
      value: (search as Record<string, unknown>)[key],
      enumerable: true,
    });
  }
  return promise;
}
