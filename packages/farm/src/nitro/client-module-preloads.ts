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
   * The chunks of the modules the entry imports by itself to navigate (islands mode's router and
   * route table), and their static imports outside `entry`. Islands mode's boot fetches them with
   * the entry when a link starts it.
   */
  router: number[];
  /**
   * The chunks of the renderer modules the entry imports when it first renders or hydrates
   * (islands mode's React DOM and islx, RFC 0010), and their static imports outside `entry`.
   * Islands mode's boot fetches them with the entry unless a link that streams its page started it.
   */
  renderer?: number[];
  /**
   * The chunks of the module that renders a page or layout root, which islands mode's entry imports
   * when one hydrates or a navigation renders one (RFC 0013), and their static imports outside
   * `entry`.
   */
  root?: number[];
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
  moduleIds?: string[];
  imports?: string[];
}

/**
 * Collect the manifest from a finished client bundle. Returns null when the bundle
 * has no such entry.
 */
export function collectFarmClientModulePreloads(
  bundle: Record<string, { type: string }>,
  options: {
    root: string;
    entryName: string;
    routerModules?: string[];
    rootModules?: string[];
    rendererModules?: string[];
  },
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

  // The chunks of these dynamically imported modules, and their static imports outside `entry`.
  const dynamicFiles = (moduleIds: string[] | undefined) => {
    const into: string[] = [];
    const loaded = new Set(entryLoaded);
    for (const moduleId of moduleIds ?? []) {
      const is = (id: string) => path.resolve(id.split("?")[0]!) === path.resolve(moduleId);
      const chunk =
        chunks.find(
          (candidate) =>
            candidate.isDynamicEntry && candidate.facadeModuleId && is(candidate.facadeModuleId),
        ) ??
        // A module another dynamic import shares can land in a common chunk without a facade.
        chunks.find((candidate) => !candidate.isEntry && candidate.moduleIds?.some(is));
      if (!chunk || loaded.has(chunk.fileName)) continue;
      loaded.add(chunk.fileName);
      into.push(chunk.fileName);
      staticImports(chunk, loaded, into);
    }
    return into;
  };
  const rendererFiles = dynamicFiles(options.rendererModules);
  const rootFiles = dynamicFiles(options.rootModules);

  return {
    files,
    entry: entryFiles.map(index),
    router: dynamicFiles(options.routerModules).map(index),
    ...(rendererFiles.length > 0 ? { renderer: rendererFiles.map(index) } : {}),
    ...(rootFiles.length > 0 ? { root: rootFiles.map(index) } : {}),
    modules,
  };
}

/**
 * Client build plugin that writes the manifest next to the build output (not into
 * the public client directory). It always writes, so a rebuild replaces an earlier
 * manifest.
 *
 * It runs after Vite's CSS plugin, whose `generateBundle` deletes the chunks that hold
 * only stylesheets (their CSS goes into `farm-client.css`) and drops them from every
 * chunk's `imports`. Read before that, the manifest listed those chunks, and documents
 * preloaded files the build never wrote.
 */
export function createFarmClientModulePreloadPlugin(options: {
  root: string;
  buildDir: string;
  entryName: string;
  routerModules?: string[];
  rootModules?: string[];
  /** Specifiers the entry imports its renderer with, resolved from `rendererImporter`. */
  rendererImports?: string[];
  rendererImporter?: string;
}) {
  return {
    name: "farm-client-module-preloads",
    enforce: "post" as const,
    async generateBundle(
      this: {
        resolve(source: string, importer?: string): Promise<{ id: string } | null>;
      },
      _output: unknown,
      bundle: Record<string, { type: string }>,
    ) {
      // Resolved as the build resolved them, so they name the same files as the chunks' modules.
      const rendererModules: string[] = [];
      for (const specifier of options.rendererImports ?? []) {
        const resolved = await this.resolve(specifier, options.rendererImporter);
        if (resolved) rendererModules.push(resolved.id);
      }
      await fs.mkdir(options.buildDir, { recursive: true });
      await fs.writeFile(
        path.join(options.buildDir, FARM_CLIENT_MODULE_PRELOADS_FILE),
        JSON.stringify(collectFarmClientModulePreloads(bundle, { ...options, rendererModules })),
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
  return encodeFarmBuildJSONPlaceholder(manifest);
}

/**
 * A value as JSON in the contents of a JavaScript string literal of any quote style, for a
 * server bundle placeholder that the server reads with `JSON.parse`.
 */
export function encodeFarmBuildJSONPlaceholder(value: unknown): string {
  return JSON.stringify(JSON.stringify(value))
    .slice(1, -1)
    .replace(/'/g, "\\u0027")
    .replace(/`/g, "\\u0060")
    .replace(/\$/g, "\\u0024")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
