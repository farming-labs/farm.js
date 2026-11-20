import type { ResolvedViewTransitionsOptions, ViewTransitionsOptions } from "./types.js";

export function resolveViewTransitionsOptions(
  options: ViewTransitionsOptions,
): ResolvedViewTransitionsOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("viewTransitions options must be an object");
  }

  const known = new Set(["exclude"]);
  for (const key of Object.keys(options)) {
    if (!known.has(key)) {
      throw new TypeError(`viewTransitions does not accept option "${key}"`);
    }
  }

  const exclude = (options as ViewTransitionsOptions).exclude ?? [];
  if (!Array.isArray(exclude)) {
    throw new TypeError("viewTransitions exclude must be an array of route patterns");
  }
  const patterns = exclude.map((pattern) => {
    if (typeof pattern !== "string" || !pattern.trim().startsWith("/")) {
      throw new TypeError(
        `viewTransitions exclude patterns must be pathnames starting with "/", got ${JSON.stringify(pattern)}`,
      );
    }
    return pattern.trim();
  });

  return Object.freeze({ exclude: Object.freeze(patterns) as string[] });
}
