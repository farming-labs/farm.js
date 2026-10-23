import fs from "node:fs/promises";
import path from "node:path";

/**
 * Browser chunks a docs page needs before it can hydrate, recorded by the client
 * build so the docs server can list them as `<link rel="modulepreload">`. Without
 * them the browser discovers each chunk only after the previous one has run: the
 * client entry, then the docs adapter, then the page's compiled Markdown.
 */
export interface FarmDocsModulePreloadManifest {
  /** Client chunk file names, referenced by index below. */
  files: string[];
  /** Chunks every docs page loads at startup: the client entry and the docs adapter graph. */
  runtime: number[];
  /** Each compiled Markdown page's own chunks, by root-relative source path. */
  pages: Record<string, number[]>;
}

/** Replaced in the server bundle once the client build has written the manifest. */
export const FARM_DOCS_MODULE_PRELOADS_PLACEHOLDER = "__farm_docs_module_preloads__";

export const FARM_DOCS_MODULE_PRELOADS_FILE = "docs-module-preloads.json";

interface ClientBundleChunk {
  type: "chunk";
  fileName: string;
  name?: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: string[];
}

function normalizeModuleId(id: string): string {
  return id.split("?")[0]!.replace(/\\/g, "/");
}

/**
 * Collect the manifest from a finished client bundle. Returns null when the
 * bundle has no chunk for the docs adapter, so no page gets a partial list.
 */
export function collectFarmDocsModulePreloads(
  bundle: Record<string, { type: string }>,
  options: { root: string; entryName: string; runtimeModuleIds: readonly string[] },
): FarmDocsModulePreloadManifest | null {
  const chunks = Object.values(bundle).filter(
    (output): output is ClientBundleChunk => output.type === "chunk",
  );
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const byModule = new Map(
    chunks
      .filter((chunk) => chunk.facadeModuleId)
      .map((chunk) => [normalizeModuleId(chunk.facadeModuleId!), chunk]),
  );
  const withStaticImports = (fileName: string, into: Set<string>) => {
    if (into.has(fileName) || !byFile.has(fileName)) return into;
    into.add(fileName);
    for (const imported of byFile.get(fileName)!.imports ?? []) withStaticImports(imported, into);
    return into;
  };

  const runtimeChunks = options.runtimeModuleIds
    .map((id) => byModule.get(normalizeModuleId(id)))
    .filter((chunk): chunk is ClientBundleChunk => Boolean(chunk));
  const entry = chunks.find((chunk) => chunk.isEntry && chunk.name === options.entryName);
  if (!entry || runtimeChunks.length === 0) return null;

  const runtime = withStaticImports(entry.fileName, new Set());
  for (const chunk of runtimeChunks) withStaticImports(chunk.fileName, runtime);

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

  const pages: Record<string, number[]> = {};
  const root = normalizeModuleId(path.resolve(options.root));
  for (const [moduleId, chunk] of byModule) {
    if (!/\.mdx?$/.test(moduleId) || !moduleId.startsWith(`${root}/`)) continue;
    const own = [...withStaticImports(chunk.fileName, new Set())].filter(
      (fileName) => !runtime.has(fileName),
    );
    pages[moduleId.slice(root.length)] = own.map(index);
  }

  return { files, runtime: [...runtime].map(index), pages };
}

/**
 * Client build plugin that writes the manifest next to the build output (not
 * into the public client directory). It always writes, so a rebuild without a
 * docs adapter chunk replaces an earlier manifest with `null`.
 */
export function createFarmDocsModulePreloadPlugin(options: {
  root: string;
  buildDir: string;
  importer: string;
  entryName: string;
  modules: readonly string[];
}) {
  let runtimeModuleIds: string[] = [];
  return {
    name: "farm-docs-module-preloads",
    async buildStart(this: {
      resolve: (source: string, importer?: string) => Promise<{ id: string } | null>;
    }) {
      const resolved = await Promise.all(
        options.modules.map((specifier) => this.resolve(specifier, options.importer)),
      );
      runtimeModuleIds = resolved.filter((value) => value !== null).map((value) => value!.id);
    },
    async generateBundle(_output: unknown, bundle: Record<string, { type: string }>) {
      const manifest = collectFarmDocsModulePreloads(bundle, {
        root: options.root,
        entryName: options.entryName,
        runtimeModuleIds,
      });
      await fs.mkdir(options.buildDir, { recursive: true });
      await fs.writeFile(
        path.join(options.buildDir, FARM_DOCS_MODULE_PRELOADS_FILE),
        JSON.stringify(manifest),
      );
    },
  };
}

/** Read the manifest a client build wrote, or null when there is none. */
export async function readFarmDocsModulePreloads(
  buildDir: string,
): Promise<FarmDocsModulePreloadManifest | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(buildDir, FARM_DOCS_MODULE_PRELOADS_FILE), "utf8"),
    ) as FarmDocsModulePreloadManifest | null;
  } catch {
    return null;
  }
}

/**
 * The manifest as the contents of a JavaScript string literal of any quote
 * style, for the server bundle's placeholder.
 */
export function encodeFarmDocsModulePreloads(
  manifest: FarmDocsModulePreloadManifest | null,
): string {
  return JSON.stringify(JSON.stringify(manifest))
    .slice(1, -1)
    .replace(/'/g, "\\u0027")
    .replace(/`/g, "\\u0060")
    .replace(/\$/g, "\\u0024")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
