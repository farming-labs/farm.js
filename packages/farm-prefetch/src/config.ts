import { matchFarmRoute } from "@farm.js/core/router";
import { PREFETCH_MODES } from "./policy.js";
import type { PrefetchMode, PrefetchOptions, ResolvedPrefetchOptions } from "./types.js";

const OPTIONS = new Set(["mode", "intentDelayMs", "allow", "deny"]);

/** Validate `prefetch()` options. Every problem is reported at once, so a
 * bad config fails the build with the full list of fixes. */
export function resolvePrefetchOptions(options: PrefetchOptions): ResolvedPrefetchOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("[farm:prefetch] Pass prefetch() an options object, or nothing.");
  }

  const problems: string[] = [];
  for (const key of Object.keys(options)) {
    if (!OPTIONS.has(key)) {
      problems.push(`\`${key}\` is not an option. Use ${[...OPTIONS].join(", ")}.`);
    }
  }

  const mode = options.mode ?? "intent";
  if (!PREFETCH_MODES.includes(mode as PrefetchMode)) {
    problems.push(`\`mode\` must be one of ${PREFETCH_MODES.map((m) => `"${m}"`).join(", ")}.`);
  }

  const intentDelayMs = options.intentDelayMs ?? 50;
  if (typeof intentDelayMs !== "number" || !Number.isFinite(intentDelayMs) || intentDelayMs < 0) {
    problems.push("`intentDelayMs` must be a number of milliseconds, 0 or more.");
  }

  const lists = { allow: options.allow ?? [], deny: options.deny ?? [] };
  for (const [name, list] of Object.entries(lists)) {
    if (!Array.isArray(list)) {
      problems.push(`\`${name}\` must be an array of route patterns, such as "/posts/[id]".`);
      continue;
    }
    for (const pattern of list) {
      if (typeof pattern !== "string" || !pattern.startsWith("/")) {
        problems.push(
          `\`${name}\` entry ${JSON.stringify(pattern)} must be a route pattern starting with "/".`,
        );
        continue;
      }
      try {
        matchFarmRoute(pattern, "/");
      } catch (error) {
        problems.push(
          `\`${name}\` entry "${pattern}" is not a valid route pattern: ${(error as Error).message}`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new TypeError(`[farm:prefetch] Invalid options:\n- ${problems.join("\n- ")}`);
  }

  return Object.freeze({
    mode: mode as PrefetchMode,
    intentDelayMs,
    allow: Object.freeze([...lists.allow]),
    deny: Object.freeze([...lists.deny]),
  });
}
