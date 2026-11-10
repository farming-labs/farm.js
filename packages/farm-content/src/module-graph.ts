import { normalizePath } from "./loader.js";

export interface ContentModuleGraph {
  getModulesByFile?(file: string): Set<unknown> | undefined;
  invalidateModule(module: unknown): void;
}

/**
 * Invalidate the modules Vite loaded from `file`. Vite keys its module graph by forward-slash
 * paths, so a Windows path (`C:\app\...`) is normalized first or the lookup finds nothing.
 */
export function invalidateFileModules(moduleGraph: ContentModuleGraph, file: string): void {
  for (const module of moduleGraph.getModulesByFile?.(normalizePath(file)) ?? []) {
    moduleGraph.invalidateModule(module);
  }
}
