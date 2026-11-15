import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Patterns for Rolldown/Vite hook filters. A hook with a filter is only called for ids that match
 * it, so the bundler skips the call into JavaScript for every other module. A filter must match
 * every id the handler acts on; the handler keeps its own checks.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches exactly these ids, with or without a `?query`. */
export function exactIdPattern(ids: readonly string[]): RegExp {
  return new RegExp(`^(?:${ids.map(escapeRegExp).join("|")})(?:\\?.*)?$`);
}

/**
 * Matches any id whose file name is one of these files' names, with or without a `?query`. For a
 * handler that compares real paths: a symlinked id keeps the file name the handler resolves.
 */
export function fileNamePattern(files: readonly string[]): RegExp {
  const names = new Set<string>();
  for (const file of files) {
    names.add(path.basename(file));
    try {
      names.add(path.basename(realpathSync(file)));
    } catch {
      // A file that does not exist yet keeps its configured name.
    }
  }
  return new RegExp(`(?:^|/)(?:${[...names].map(escapeRegExp).join("|")})(?:\\?.*)?$`);
}
