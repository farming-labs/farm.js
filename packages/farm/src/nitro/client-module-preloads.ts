import fs from "node:fs/promises";
import path from "node:path";
import { toViteModuleId } from "../utils";

/**
 * The client modules a page needs before it can hydrate, listed in its document as
 * `<link rel="modulepreload">` so the browser fetches them alongside the entry.
 *
 * Without them the browser finds the entry's static imports only after the entry
 * has downloaded and parsed, and the page's own modules (a hydrating page, the
 * client components of its islands or server tree) only after the entry has run:
 * a round trip each. Vite writes the first list into an SPA's index.html.
 *
 * The links are low priority: on a page that imports many chunks they otherwise
 * compete with the stylesheet and fonts the first paint waits on.
 */
export interface FarmClientModulePreloadManifest {
  /** Client chunk file names, referenced by index below. */
  files: string[];
  /** The entry's static imports, directly or through another chunk. Every page loads them. */
  entry: number[];
  /**
   * Each dynamically imported module's chunk and that chunk's static imports outside
   * `entry`, by the module id the client loads it with (`/src/app/page.tsx`).
   */
  modules: Record<string, number[]>;
}

/** Replaced in the server bundle once the client build has written the manifest. */
export const FARM_CLIENT_MODULE_PRELOADS_PLACEHOLDER = "__farm_client_module_preloads__";

export const FARM_CLIENT_MODULE_PRELOADS_FILE = "client-module-preloads.json";

interface ClientBundleChunk {
  type: "chunk";
  fileName: string;
  name?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: string[];
}

/**
 * Collect the manifest from a finished client bundle. Returns null when the bundle
 * has no such entry.
 */
export function collectFarmClientModulePreloads(
  bundle: Record<string, { type: string }>,
  options: { root: string; entryName: string },
): FarmClientModulePreloadManifest | null {
  const chunks = Object.values(bundle).filter(
    (output): output is ClientBundleChunk => output.type === "chunk",
  );
  const entry = chunks.find((chunk) => chunk.isEntry && chunk.name === options.entryName);
  if (!entry) return null;
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));

  const files: string[] = [];
  const indexOf = new Map<string, number>();
  const index = (fileName: string) => {
    let value = indexOf.get(fileName);
    if (value === undefined) {
      value = files.push(fileName) - 1;
      indexOf.set(fileName, value);
    }
    return value;
  };
  // Static imports in import order, skipping what `loaded` already holds.
  const staticImports = (chunk: ClientBundleChunk, loaded: Set<string>, into: string[]) => {
    for (const fileName of chunk.imports ?? []) {
      const imported = byFile.get(fileName);
      if (loaded.has(fileName) || !imported) continue;
      loaded.add(fileName);
      into.push(fileName);
      staticImports(imported, loaded, into);
    }
    return into;
  };

  const entryFiles = staticImports(entry, new Set([entry.fileName]), []);
  const entryLoaded = new Set([entry.fileName, ...entryFiles]);
  const modules: Record<string, number[]> = {};
  for (const chunk of chunks) {
    if (!chunk.isDynamicEntry || !chunk.facadeModuleId || entryLoaded.has(chunk.fileName)) {
      continue;
    }
    const moduleId = chunk.facadeModuleId.split("?")[0]!;
    if (!path.isAbsolute(moduleId)) continue;
    const loaded = new Set([...entryLoaded, chunk.fileName]);
    modules[toViteModuleId(moduleId, options.root)] = [
      chunk.fileName,
      ...staticImports(chunk, loaded, []),
    ].map(index);
  }

  return { files, entry: entryFiles.map(index), modules };
}

/**
 * Client build plugin that writes the manifest next to the build output (not into
 * the public client directory). It always writes, so a rebuild replaces an earlier
 * manifest.
 */
export function createFarmClientModulePreloadPlugin(options: {
  root: string;
  buildDir: string;
  entryName: string;
}) {
  return {
    name: "farm-client-module-preloads",
    async generateBundle(_output: unknown, bundle: Record<string, { type: string }>) {
      await fs.mkdir(options.buildDir, { recursive: true });
      await fs.writeFile(
        path.join(options.buildDir, FARM_CLIENT_MODULE_PRELOADS_FILE),
        JSON.stringify(collectFarmClientModulePreloads(bundle, options)),
      );
    },
  };
}

/** Read the manifest a client build wrote, or null when there is none. */
export async function readFarmClientModulePreloads(
  buildDir: string,
): Promise<FarmClientModulePreloadManifest | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(buildDir, FARM_CLIENT_MODULE_PRELOADS_FILE), "utf8"),
    ) as FarmClientModulePreloadManifest | null;
  } catch {
    return null;
  }
}

/**
 * The manifest as the contents of a JavaScript string literal of any quote style,
 * for the server bundle's placeholder.
 */
export function encodeFarmClientModulePreloads(
  manifest: FarmClientModulePreloadManifest | null,
): string {
  return JSON.stringify(JSON.stringify(manifest))
    .slice(1, -1)
    .replace(/'/g, "\\u0027")
    .replace(/`/g, "\\u0060")
    .replace(/\$/g, "\\u0024")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
