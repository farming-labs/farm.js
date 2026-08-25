/**
 * Decode a percent-encoded path segment, falling back to the raw value.
 *
 * Request paths are not guaranteed to be validly percent-encoded, so
 * `decodeURIComponent` can throw on input that is still a legal URL: a
 * latin-1 escape such as `caf%E9` from an old link, or a truncated `%ZZ`
 * from a crawler. A malformed segment simply will not match a known route,
 * which is a 404, so it must not throw out of route matching.
 */
export function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
