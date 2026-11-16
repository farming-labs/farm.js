/**
 * Pure decisions for the prefetch runtime: link modes, which anchors the
 * router navigates, allow/deny route patterns and data-saving detection.
 */
import { matchFarmRoute } from "@farm.js/core/router";
import type { PrefetchMode } from "./types.js";

export const PREFETCH_MODES: readonly PrefetchMode[] = ["intent", "viewport", "render", "none"];

/** Per-link override, the same values as `Link`'s `prefetch` prop. */
export const PREFETCH_ATTRIBUTE = "data-farm-prefetch";

/** Set by core `Link`, which prefetches its own anchor. */
const LINK_ATTRIBUTE = "data-farm-link";

/**
 * The mode of one link: its `data-farm-prefetch` value, or the plugin
 * default when it has none. An unknown value never prefetches, so a typo
 * cannot turn prefetching on.
 */
export function readPrefetchMode(value: string | null, fallback: PrefetchMode): PrefetchMode {
  if (value === null) return fallback;
  return PREFETCH_MODES.includes(value as PrefetchMode) ? (value as PrefetchMode) : "none";
}

export interface AnchorAttributes {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

/**
 * The href of an anchor the router navigates on click, or `null`. Mirrors
 * core's link click filter: a relative href, no `download`, no other
 * `target`. An absolute URL, even same-origin, loads a new document, so
 * prefetching it would be wasted. `Link` anchors prefetch themselves.
 */
export function readNavigableHref(anchor: AnchorAttributes): string | null {
  if (anchor.hasAttribute(LINK_ATTRIBUTE) || anchor.hasAttribute("download")) return null;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return null;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return null;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href) || href.startsWith("//")) return null;
  return href;
}

/** `deny` wins over `allow`; an empty `allow` allows every path. Patterns
 * use core's route matcher, so they read like `app/` routes. */
export function isPathAllowed(
  pathname: string,
  allow: readonly string[],
  deny: readonly string[],
): boolean {
  if (deny.some((pattern) => matchFarmRoute(pattern, pathname))) return false;
  return allow.length === 0 || allow.some((pattern) => matchFarmRoute(pattern, pathname));
}

/**
 * The smallest window surface `isDataSaving` needs. `navigator` is `unknown`
 * because the DOM `Navigator` type has no `connection` property.
 */
export interface DataSavingWindow {
  navigator?: unknown;
  matchMedia?: unknown;
}

/** True when the user asked the browser to save data, via `Save-Data` or
 * `prefers-reduced-data`. A missing or throwing `matchMedia` reads as
 * "not saving". */
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
