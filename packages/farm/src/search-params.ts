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
    const existing = output[key];
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
