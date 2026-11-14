import type { ResolvedScrollRestorationOptions, ScrollRestorationOptions } from "./types.js";

export const DEFAULT_SCROLL_RESTORATION_STORAGE_KEY_PREFIX = "farm-scroll-restore";

export function resolveScrollRestorationOptions(
  options: ScrollRestorationOptions,
): ResolvedScrollRestorationOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("scrollRestoration options must be an object");
  }

  const known = new Set(["storageKeyPrefix"]);
  for (const key of Object.keys(options)) {
    if (!known.has(key)) {
      throw new TypeError(`scrollRestoration does not accept option "${key}"`);
    }
  }

  const storageKeyPrefix =
    (options as ScrollRestorationOptions).storageKeyPrefix ??
    DEFAULT_SCROLL_RESTORATION_STORAGE_KEY_PREFIX;
  if (typeof storageKeyPrefix !== "string" || !storageKeyPrefix.trim()) {
    throw new TypeError("scrollRestoration storageKeyPrefix must be a non-empty string");
  }

  return Object.freeze({ storageKeyPrefix: storageKeyPrefix.trim() });
}
