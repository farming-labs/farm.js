import type { AddonFunction, ChunkingContext, OutputOptions } from "rolldown";

/** A module of React, React DOM or the scheduler React DOM runs on. */
const REACT_MODULE = /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/;
const REACT_DOM_MODULE = /[\\/]node_modules[\\/]react-dom[\\/]/;

/**
 * Asks V8 to compile every function of the script while it streams in, off the main thread,
 * instead of each on the main thread when it first runs (V8's explicit compile hints). Other
 * engines ignore it as a comment.
 */
export const FARM_EAGER_COMPILE_HINT = "//# allFunctionsCalledOnLoad";

/**
 * Islands mode's output for React: React, its JSX runtime and React DOM in one chunk, compiled as
 * it streams in.
 *
 * The islands entry imports React and React DOM together when an island is due (RFC 0010), and
 * island modules import React and its JSX runtime, so the bundler would otherwise split them into
 * three chunks by importer. A page hydrates once the last of them arrives; one chunk is one request
 * and compresses better (RFC 0013). Hydrating runs much of React DOM as soon as the chunk arrives,
 * so the chunk carries the compile hint.
 *
 * An entry that imports any of them statically, as the mobile client's and an app's with client
 * route slots do, keeps the bundler's split and no hint: React DOM would otherwise load with every
 * page.
 */
export function createFarmIslandsReactOutput(): Pick<
  OutputOptions,
  "codeSplitting" | "postBanner"
> {
  let entryImportsReact: boolean | undefined;
  return {
    codeSplitting: {
      groups: [
        {
          debugName: "react",
          name(moduleId, context) {
            if (!REACT_MODULE.test(moduleId)) return null;
            entryImportsReact ??= reactLoadsWithAnEntry(moduleId, context);
            return entryImportsReact ? null : "react";
          },
        },
      ],
    },
    // After minification, so the hint stays the chunk's first line; its source map accounts for it.
    // Rolldown adds a line after any string, an empty one too, so other chunks get none.
    postBanner: ((chunk) =>
      entryImportsReact === false && chunk.moduleIds.some((id) => REACT_DOM_MODULE.test(id))
        ? FARM_EAGER_COMPILE_HINT
        : undefined) as AddonFunction,
  };
}

/** Whether an entry imports, directly or through other modules, any of React's that `moduleId` is. */
function reactLoadsWithAnEntry(moduleId: string, context: ChunkingContext): boolean {
  // React's packages import each other, so every one of their modules is linked to `moduleId`.
  const react = new Set<string>();
  const pending = [moduleId];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (react.has(id) || !REACT_MODULE.test(id)) continue;
    react.add(id);
    const info = context.getModuleInfo(id);
    if (info) pending.push(...info.importedIds, ...info.importers);
  }
  // `importers` holds static imports only: a dynamic import doesn't load React with its importer.
  const seen = new Set<string>();
  pending.push(...react);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const info = context.getModuleInfo(id);
    if (!info) continue;
    if (info.isEntry) return true;
    pending.push(...info.importers);
  }
  return false;
}

/** Whether an app's own Vite config decides how the client build splits chunks. */
export function configuresFarmClientChunks(vite: unknown): boolean {
  const build = (vite as { build?: Record<string, { output?: unknown } | undefined> } | undefined)
    ?.build;
  const outputs = [build?.rollupOptions?.output, build?.rolldownOptions?.output].flat();
  return outputs.some(
    (output) =>
      !!output &&
      typeof output === "object" &&
      ["manualChunks", "advancedChunks", "codeSplitting", "inlineDynamicImports"].some(
        (key) => (output as Record<string, unknown>)[key] !== undefined,
      ),
  );
}
