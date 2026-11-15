import { isBuiltin } from "node:module";

/**
 * Browser modules for Node builtins that reach client code.
 *
 * Vite resolves a builtin with no browser implementation (no alias, no
 * installed polyfill) to a browser external: `__vite-browser-external`, with
 * the specifier appended in development, and `browser-external:<id>` inside
 * the dependency optimizer. Vite's module for that id has no named exports, so
 * `import { randomUUID } from "node:crypto"` gets undefined.
 *
 * Farm's module declares every export the builtin has, so named imports link.
 * An export the browser implements with the same contract forwards to it
 * (Web Crypto for `node:crypto`); every other export is undefined, as it is in
 * Vite's module, which keeps the feature checks of isomorphic packages taking
 * their browser path.
 */

export const FARM_BROWSER_BUILTIN_PREFIX = "\0farm:browser-builtin:";

const BROWSER_IMPLEMENTATIONS: Record<string, Record<string, string>> = {
  crypto: {
    webcrypto: "globalThis.crypto",
    subtle: "globalThis.crypto?.subtle",
    getRandomValues: "(array) => globalThis.crypto.getRandomValues(array)",
    randomUUID: "() => globalThis.crypto.randomUUID()",
  },
};

const BROWSER_EXTERNAL_RE = /^(?:__vite-)?browser-external(?::|$)/;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

type ResolveContext<Resolved> = {
  resolve(
    source: string,
    importer: string | undefined,
    options: { skipSelf: true },
  ): Promise<Resolved | null>;
};

/**
 * How the rest of the resolver chain resolves a builtin specifier, with a
 * browser external replaced by Farm's browser module for the builtin.
 */
export async function resolveFarmBrowserBuiltin<Resolved extends { id: string }>(
  context: ResolveContext<Resolved>,
  source: string,
  importer: string | undefined,
  options: object | undefined,
): Promise<Resolved | string | null> {
  const resolved = await context.resolve(source, importer, { ...options, skipSelf: true });
  if (!resolved || !BROWSER_EXTERNAL_RE.test(resolved.id)) return resolved;
  return FARM_BROWSER_BUILTIN_PREFIX + source.replace(/^node:/, "");
}

export function loadFarmBrowserBuiltin(id: string): string | undefined {
  if (!id.startsWith(FARM_BROWSER_BUILTIN_PREFIX)) return undefined;
  const name = id.slice(FARM_BROWSER_BUILTIN_PREFIX.length);
  const implementations = BROWSER_IMPLEMENTATIONS[name] ?? {};
  const exports = Object.keys(process.getBuiltinModule(`node:${name}`) ?? {}).filter(
    (key) => key !== "default" && IDENTIFIER_RE.test(key),
  );
  const implemented = exports.filter((key) => key in implementations);
  return [
    ...exports.map((key) => `export const ${key} = ${implementations[key] ?? "undefined"};`),
    `export default { ${implemented.join(", ")} };`,
  ].join("\n");
}

/** The same resolution inside Vite's dependency optimizer, which runs no Vite plugins. */
export function farmBrowserBuiltinsOptimizerPlugin() {
  return {
    name: "farm:browser-builtins-optimizer",
    resolveId(
      this: ResolveContext<{ id: string }>,
      source: string,
      importer?: string,
      options?: object,
    ) {
      return isBuiltin(source) ? resolveFarmBrowserBuiltin(this, source, importer, options) : null;
    },
    load(id: string) {
      return loadFarmBrowserBuiltin(id) ?? null;
    },
  };
}
