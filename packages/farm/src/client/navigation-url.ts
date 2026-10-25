/**
 * Schemes a Farm router hands to the browser as a document navigation.
 * Anything else (`javascript:`, `data:`, `vbscript:`, `blob:`, ...) is refused:
 * `location.assign("javascript:...")` runs script in the page, which turns
 * `router.push(searchParams.get("next"))` into XSS. This is TanStack Router's
 * default allowlist; Next.js blocks `javascript:` alone.
 */
const FARM_NAVIGATION_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * True when a router must not navigate to `url`. Pass a URL parsed with
 * `new URL(href, base)`: that is the browser's own parser, so leading
 * whitespace, mixed case and embedded tabs or newlines are already normalized.
 * Logs rather than throws, like TanStack Router and Next.js's hard-navigation
 * path, so a hostile `?next=` value cannot break the caller's code after push().
 */
export function isFarmBlockedNavigationURL(url: URL): boolean {
  if (FARM_NAVIGATION_PROTOCOLS.has(url.protocol)) return false;
  console.error(`[Farm.js] Blocked navigation to a ${url.protocol} URL as a security precaution.`);
  return true;
}

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
