/**
 * Pure, DOM-free policy decisions for the prefetch runtime: route-pattern
 * matching, allow/deny lists, data-saving detection, same-origin URL checks
 * and the concurrency queue. Everything here is unit-testable in Node.
 */

function splitPath(value: string): string[] {
  const trimmed = value === "/" ? value : value.replace(/\/+$/, "");
  return trimmed.split("/").filter((segment) => segment.length > 0);
}

/**
 * Match a concrete pathname against a Farm route pattern. Literal segments
 * must match exactly; `[param]` matches one non-empty segment; `[...rest]`
 * (last segment only) matches zero or more remaining segments. This is a
 * subset of the framework's route syntax (`packages/farm/src/api/route-pattern.ts`)
 * — enough for allow/deny lists, without importing server code into the
 * browser bundle.
 */
export function matchesRoutePattern(pathname: string, pattern: string): boolean {
  const pathSegments = splitPath(pathname);
  const patternSegments = splitPath(pattern);

  for (let index = 0; index < patternSegments.length; index += 1) {
    const segment = patternSegments[index];
    if (segment.startsWith("[...") && segment.endsWith("]")) {
      return index === patternSegments.length - 1;
    }
    if (index >= pathSegments.length) return false;
    if (segment.startsWith("[") && segment.endsWith("]")) {
      if (pathSegments[index].length === 0) return false;
      continue;
    }
    if (segment !== pathSegments[index]) return false;
  }
  return pathSegments.length === patternSegments.length;
}

/**
 * `deny` wins over `allow`; an empty `allow` list allows every path.
 * Patterns match against the pathname only — query strings never gate a
 * prefetch decision.
 */
export function isPathAllowed(
  pathname: string,
  allow: readonly string[],
  deny: readonly string[],
): boolean {
  if (deny.some((pattern) => matchesRoutePattern(pathname, pattern))) return false;
  if (allow.length === 0) return true;
  return allow.some((pattern) => matchesRoutePattern(pathname, pattern));
}

/**
 * The smallest window surface `isDataSaving` needs. `navigator` and
 * `matchMedia` are `unknown` on purpose: the DOM `Navigator` type has no
 * `connection` property, so a narrower type would make passing a real
 * `Window` a type error. The runtime checks narrow them below.
 */
export interface DataSavingWindow {
  navigator?: unknown;
  matchMedia?: unknown;
}

/** True when the user asked the browser to save data, via `Save-Data` or
 * the `prefers-reduced-data` media query. Never throws: a missing or
 * hostile `matchMedia` is treated as "not saving". */
export function isDataSaving(target: DataSavingWindow): boolean {
  try {
    const connection = (
      target.navigator as { connection?: { saveData?: boolean } } | null | undefined
    )?.connection;
    if (connection?.saveData === true) return true;
    if (typeof target.matchMedia === "function") {
      return (target.matchMedia as (query: string) => { matches: boolean })(
        "(prefers-reduced-data: reduce)",
      ).matches;
    }
  } catch {
    return false;
  }
  return false;
}

export interface PrefetchTarget {
  /** The absolute URL the link points at. */
  href: string;
  /** The page the link sits on, for same-origin and same-page checks. */
  baseHref: string;
}

/**
 * Decide whether an href is prefetchable at the URL level: same-origin,
 * http(s), and not a same-page (hash-only) jump. The caller applies the
 * allow/deny lists against the returned pathname.
 */
export function resolvePrefetchTarget(
  target: PrefetchTarget,
): { ok: true; href: string; pathname: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(target.href, target.baseHref);
  } catch {
    return { ok: false, reason: "unparseable href" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "non-http(s) href" };
  }
  let base: URL;
  try {
    base = new URL(target.baseHref);
  } catch {
    return { ok: false, reason: "unparseable base href" };
  }
  if (url.origin !== base.origin) return { ok: false, reason: "cross-origin href" };
  if (url.pathname === base.pathname && url.search === base.search) {
    return { ok: false, reason: "same-page href" };
  }
  return { ok: true, href: url.href, pathname: url.pathname };
}

/** FIFO queue with a concurrency cap and dedupe across queued + in-flight
 * hrefs. A failed fetch never blocks the queue. */
export class PrefetchQueue {
  private readonly fetch: (href: string) => Promise<void>;
  private readonly maxConcurrent: number;
  private readonly queued: string[] = [];
  private readonly queuedSet = new Set<string>();
  private readonly inFlight = new Set<string>();

  constructor(fetch: (href: string) => Promise<void>, maxConcurrent: number) {
    this.fetch = fetch;
    this.maxConcurrent = maxConcurrent;
  }

  get queuedCount(): number {
    return this.queued.length;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  enqueue(href: string): void {
    if (this.inFlight.has(href) || this.queuedSet.has(href)) return;
    this.queued.push(href);
    this.queuedSet.add(href);
    void this.pump();
  }

  /** Drop everything not yet started. In-flight fetches run to completion. */
  clear(): void {
    this.queued.length = 0;
    this.queuedSet.clear();
  }

  private pump(): void {
    while (this.inFlight.size < this.maxConcurrent && this.queued.length > 0) {
      const href = this.queued.shift() as string;
      this.queuedSet.delete(href);
      this.inFlight.add(href);
      void this.fetch(href).then(
        () => this.finish(href),
        () => this.finish(href),
      );
    }
  }

  private finish(href: string): void {
    this.inFlight.delete(href);
    this.pump();
  }
}
