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

/**
 * Split a request pathname and decode each segment exactly once.
 *
 * This is the pathname a route matcher compares against: every page matcher
 * decodes per segment before comparing to a static pattern segment, so
 * `/%64ashboard` and `/dashboard` are the same route. A guard that compares the
 * raw pathname instead disagrees with the router about which URL a request is
 * for, which is how a percent-encoded path slips past an auth gate while still
 * rendering the protected page.
 *
 * Splitting before decoding is the load-bearing part: `%2F` decodes to `/`
 * inside its own segment and must never become a new separator, or a decoded
 * slash grows a path segment that was not in the request.
 */
export function canonicalizeRequestPathSegments(pathname: string): string[] {
  const segments = pathname.split("/").filter(Boolean);
  // Nothing to decode on the overwhelmingly common request.
  if (!pathname.includes("%")) return segments;
  return segments.map(decodeRouteSegment);
}

/**
 * The string form of {@link canonicalizeRequestPathSegments}, for matchers that
 * run a regex or a prefix check over the whole pathname instead of walking
 * segments.
 *
 * A decoded `/` is re-encoded as `%2F` so it stays inside its segment for a
 * matcher that treats `/` as a separator, and so a capture that a redirect or
 * rewrite reuses keeps the encoding it arrived with. Separators, leading and
 * trailing slashes, empty segments, and case are otherwise left exactly as they
 * arrived: this changes which pathname a pattern is compared against, never what
 * the pattern means.
 *
 * Decoding happens once. A path that still contains `%` after decoding, such as
 * `%2541BC` decoding to `%41BC`, keeps it; decoding a second time would resolve
 * a different route than the request asked for.
 */
export function canonicalizeRequestPathname(pathname: string): string {
  // The overwhelmingly common case is a pathname with nothing to decode, so
  // keep it off the split/join path entirely.
  if (!pathname.includes("%")) return pathname;

  return pathname
    .split("/")
    .map((segment) => {
      const decoded = decodeRouteSegment(segment);
      return decoded === segment ? segment : decoded.replace(/\//g, "%2F");
    })
    .join("/");
}
