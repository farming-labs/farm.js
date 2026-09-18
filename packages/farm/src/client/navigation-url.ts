export function isFarmExternalNavigationURL(url: URL, currentOrigin: string): boolean {
  return (url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== currentOrigin;
}

/**
 * Resolve a navigation target the way the platform does.
 *
 * Relative references resolve against the *document's* URL, not the origin.
 * Basing on the origin turns `?tab=2` into `/?tab=2` and `details` into
 * `/details`, discarding the directory the user is actually on, so every
 * navigation entry point has to resolve through here.
 *
 * Absolute paths and absolute URLs are unaffected by the choice of base.
 */
export function resolveFarmNavigationURL(href: string, documentUrl: string): URL {
  return new URL(href, documentUrl);
}
