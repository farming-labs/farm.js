import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

/**
 * `universal-build.ts` generates the browser hydration entry with
 * `import { stripFarmLocaleFromPathname } from "@farm.js/core/i18n"`, so
 * everything that entry reaches at runtime is bundled for the browser. A
 * `node:` import anywhere in that graph breaks client-side navigation in every
 * localized app, and only an end-to-end run notices.
 */
function resolveLocal(fromFile: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Value imports only: `import type` and `export type` are erased at build. */
function valueSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(import|export)(\s+type\s+|\s+)([^;]*?)from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[2].includes("type")) continue;
    // `export { type A, foo }` still carries a value binding; a clause that is
    // only type specifiers does not.
    const clause = match[3];
    if (/^\s*\{[^}]*\}\s*$/.test(clause)) {
      const names = clause
        .replace(/[{}]/g, "")
        .split(",")
        .filter((n) => n.trim());
      if (names.length && names.every((n) => /^\s*type\s/.test(n))) continue;
    }
    specifiers.push(match[4]);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function collectNodeImports(entry: string): { file: string; specifier: string }[] {
  const seen = new Set<string>();
  const offenders: { file: string; specifier: string }[] = [];
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of valueSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith("node:")) {
        offenders.push({ file: path.relative(SRC, file), specifier });
        continue;
      }
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveLocal(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }

  return offenders;
}

describe("browser-reachable i18n entries", () => {
  it.each([
    ["@farm.js/core/i18n", "i18n/index.ts"],
    ["@farm.js/core/i18n/client", "i18n/client.tsx"],
  ])("keeps node builtins out of %s", (_specifier, relativeEntry) => {
    const offenders = collectNodeImports(path.join(SRC, relativeEntry));
    expect(offenders).toEqual([]);
  });

  it("detects a node builtin once one is reachable", () => {
    // Proves the walker actually follows the graph: `i18n/config.ts` imports
    // `node:path`, and re-exporting it from `i18n/index.ts` is the mistake this
    // guards against. `resolveFarmI18nConfig` belongs on `@farm.js/core/config`.
    const offenders = collectNodeImports(path.join(SRC, "i18n/config.ts"));
    expect(offenders).toContainEqual({ file: "i18n/config.ts", specifier: "node:path" });
  });
});
