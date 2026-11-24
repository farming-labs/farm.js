import type { ChunkingContext, CodeSplittingGroup } from "rolldown";

/** A module of React, React DOM or the scheduler React DOM runs on. */
const REACT_MODULE = /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/;

/**
 * Islands mode's chunk group for React: React, its JSX runtime and React DOM in one chunk.
 *
 * The islands entry imports React and React DOM together when an island is due (RFC 0010), and
 * island modules import React and its JSX runtime, so the bundler would otherwise split them into
 * three chunks by importer. A page hydrates once the last of them arrives; one chunk is one request
 * and compresses better (RFC 0013).
 *
 * An entry that imports any of them statically, as the mobile client's and an app's with client
 * route slots do, keeps the bundler's split: React DOM would otherwise load with every page.
 */
export function createFarmIslandsReactChunkGroup(): CodeSplittingGroup {
  let entryImportsReact: boolean | undefined;
  return {
    debugName: "react",
    name(moduleId, context) {
      if (!REACT_MODULE.test(moduleId)) return null;
      entryImportsReact ??= reactLoadsWithAnEntry(moduleId, context);
      return entryImportsReact ? null : "react";
    },
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
