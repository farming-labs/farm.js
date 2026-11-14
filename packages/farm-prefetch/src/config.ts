import type { PrefetchOptions, PrefetchStrategy, ResolvedPrefetchOptions } from "./types.js";

const STRATEGIES: readonly PrefetchStrategy[] = ["hover", "viewport", "both"];

export function resolvePrefetchOptions(options: PrefetchOptions): ResolvedPrefetchOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("prefetch options must be an object");
  }

  const known = new Set(["strategy", "maxConcurrent", "allow", "deny", "hoverDelayMs"]);
  for (const key of Object.keys(options)) {
    if (!known.has(key)) {
      throw new TypeError(`prefetch does not accept option "${key}"`);
    }
  }

  const strategy = (options as PrefetchOptions).strategy ?? "both";
  if (!STRATEGIES.includes(strategy as PrefetchStrategy)) {
    throw new TypeError(`prefetch strategy must be one of ${STRATEGIES.join(", ")}`);
  }

  const maxConcurrent = (options as PrefetchOptions).maxConcurrent ?? 6;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new TypeError("prefetch maxConcurrent must be a positive integer");
  }

  const allow = (options as PrefetchOptions).allow ?? [];
  const deny = (options as PrefetchOptions).deny ?? [];
  for (const [name, list] of [
    ["allow", allow],
    ["deny", deny],
  ] as const) {
    if (
      !Array.isArray(list) ||
      list.some((pattern) => typeof pattern !== "string" || !pattern.trim())
    ) {
      throw new TypeError(`prefetch ${name} must be an array of non-empty strings`);
    }
  }

  const hoverDelayMs = (options as PrefetchOptions).hoverDelayMs ?? 50;
  if (typeof hoverDelayMs !== "number" || !Number.isFinite(hoverDelayMs) || hoverDelayMs < 0) {
    throw new TypeError("prefetch hoverDelayMs must be a non-negative number");
  }

  return Object.freeze({
    strategy: strategy as PrefetchStrategy,
    maxConcurrent,
    allow: Object.freeze(allow.map((pattern) => pattern.trim())),
    deny: Object.freeze(deny.map((pattern) => pattern.trim())),
    hoverDelayMs,
  });
}
