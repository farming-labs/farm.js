import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { definePlugin } from "@farm.js/core/plugin";
import fg from "fast-glob";
import { asset } from "./assets.js";
import { collection, files, isSupportedContentFile } from "./config.js";
import { loadContentCollections, writeContentServerModule } from "./loader.js";
import { registerContentWriteRuntime, setContentAfterWrite } from "./runtime.js";
import type { ContentCollections, ContentOptions, ContentPlugin } from "./types.js";

const CONTENT_SERVER_ID = "@farm.js/content/server";

export { asset, collection, files };
export { remote } from "./config.js";
export type { ContentRemoteOptions } from "./config.js";
export type { ContentFilesOptions } from "./config.js";
export type {
  AppContentEntry,
  AppContentRegistry,
  ContentAssetField,
  ContentAssetFields,
  ContentAssetsInput,
  ContentAssetValue,
  ContentCollection,
  ContentCollectionInput,
  ContentCollectionName,
  ContentCollections,
  ContentEntry,
  ContentFileAsset,
  ContentFileSource,
  ContentRemoteDocument,
  ContentRemoteSource,
  ContentSource,
  ContentImageAsset,
  ContentOptions,
  ContentPlugin,
  ContentSchema,
  ContentTransformContext,
  InferContentCollectionEntry,
  InferContentAssetFields,
  InferContentRegistry,
  InferContentSchema,
} from "./types.js";

/** Load schema-validated local content as a typed server-only collection registry. */
export function content<const TCollections extends ContentCollections>(
  options: ContentOptions<TCollections>,
): ContentPlugin<TCollections> {
  validateOptions(options);

  // Writes need the live sources and schemas; the snapshot module carries
  // only data. Registered here so both dev and the production runtime (where
  // the config module is evaluated too) can reach them.
  registerContentWriteRuntime(
    Object.fromEntries(
      Object.entries(options.collections).map(([name, definition]) => [
        name,
        {
          ...(definition.source.kind === "remote" ? { source: definition.source } : {}),
          schema: definition.schema,
        },
      ]),
    ),
  );

  let root = process.cwd();
  let generatedFile = "";
  let sourceFiles = new Set<string>();

  const plugin = definePlugin({
    name: "farm:content",
    enforce: "pre",

    async configure(config) {
      if (
        (config.plugins ?? []).filter((candidate) => candidate.name === "farm:content").length > 1
      ) {
        throw new Error(
          "[farm:content] Configure all collections in one content() plugin instance",
        );
      }

      root = path.resolve(config.root ?? ".");
      generatedFile = path.join(root, ".farm", "content", "server.mjs");
      await rebuild();

      const vite = config.vite ?? {};
      return {
        ...config,
        vite: {
          ...vite,
          optimizeDeps: {
            ...vite.optimizeDeps,
            exclude: [...new Set([CONTENT_SERVER_ID, ...(vite.optimizeDeps?.exclude ?? [])])],
          },
          plugins: [createContentVitePlugin(), ...(vite.plugins ?? [])],
        },
      };
    },
  }) as ContentPlugin<TCollections>;

  async function rebuild(): Promise<boolean> {
    const attemptedSourceFiles = new Set<string>();
    try {
      await assertGeneratedOutputInsideRoot(root, generatedFile);
      const loaded = await loadContentCollections(root, options.collections, attemptedSourceFiles);
      const changed = await writeContentServerModule(
        generatedFile,
        loaded.collections,
        loaded.assetImports,
      );
      sourceFiles = new Set(loaded.sourceFiles);
      return changed;
    } catch (error) {
      sourceFiles = new Set([...sourceFiles, ...attemptedSourceFiles]);
      throw error;
    }
  }

  function createContentVitePlugin() {
    let rebuildQueue = Promise.resolve();

    return {
      name: "farm:content-runtime",
      enforce: "pre" as const,
      resolveId(id: string, importer: string | undefined, resolveOptions?: { ssr?: boolean }) {
        if (id !== CONTENT_SERVER_ID) return undefined;
        const environmentName = (this as { environment?: { name?: string } }).environment?.name;
        const serverEnvironment =
          resolveOptions?.ssr || environmentName === "ssr" || environmentName === "rsc";
        if (!serverEnvironment) {
          throw new Error(
            `[farm:content] ${CONTENT_SERVER_ID} is server-only and cannot be imported into the client environment${
              importer ? ` by ${importer}` : ""
            }`,
          );
        }
        return generatedFile;
      },
      configureServer(server: ContentViteDevServer) {
        const onFile = (event: string, filePath: string) => {
          if (event !== "add" && event !== "change" && event !== "unlink") return;
          const absoluteFile = path.resolve(filePath);

          rebuildQueue = rebuildQueue
            .then(async () => {
              if (
                !(await shouldRebuildForFile(
                  root,
                  absoluteFile,
                  event,
                  sourceFiles,
                  options.collections,
                ))
              ) {
                return;
              }
              await rebuild();
              const modules = server.moduleGraph.getModulesByFile?.(generatedFile);
              for (const module of modules ?? []) server.moduleGraph.invalidateModule(module);
              server.ws.send({ type: "full-reload" });
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              server.ws.send({
                type: "error",
                err: { message, stack: error instanceof Error ? error.stack : undefined },
              });
            });
        };
        server.watcher.on("all", onFile);
        server.httpServer?.once("close", () => server.watcher.off?.("all", onFile));

        // A successful write refreshes the snapshot immediately in development.
        setContentAfterWrite(async () => {
          const settled = (rebuildQueue = rebuildQueue.then(async () => {
            if (!(await rebuild())) return;
            const modules = server.moduleGraph.getModulesByFile?.(generatedFile);
            for (const module of modules ?? []) server.moduleGraph.invalidateModule(module);
            server.ws.send({ type: "full-reload" });
          }));
          await settled;
        });
        server.httpServer?.once("close", () => setContentAfterWrite(undefined));

        // Remote sources have no file events; poll the ones that asked for it.
        // One timer at the smallest requested cadence keeps ordering simple,
        // and a reload only goes out when the generated module actually changed.
        const intervals = Object.values(options.collections)
          .map((definition) => definition.source)
          .filter((candidate) => candidate.kind === "remote")
          .map((candidate) => candidate.refreshInterval)
          .filter((value): value is number => typeof value === "number");
        if (intervals.length > 0) {
          const timer = setInterval(
            () => {
              rebuildQueue = rebuildQueue
                .then(async () => {
                  if (!(await rebuild())) return;
                  const modules = server.moduleGraph.getModulesByFile?.(generatedFile);
                  for (const module of modules ?? []) server.moduleGraph.invalidateModule(module);
                  server.ws.send({ type: "full-reload" });
                })
                .catch((error) => {
                  const message = error instanceof Error ? error.message : String(error);
                  server.ws.send({
                    type: "error",
                    err: { message, stack: error instanceof Error ? error.stack : undefined },
                  });
                });
            },
            Math.min(...intervals),
          );
          timer.unref?.();
          server.httpServer?.once("close", () => clearInterval(timer));
        }
      },
    };
  }

  return plugin;
}

async function assertGeneratedOutputInsideRoot(root: string, outputFile: string): Promise<void> {
  const actualRoot = await realpath(root);
  const missingSegments: string[] = [];
  let existingAncestor = outputFile;
  const unsafeOutput = () =>
    new Error(
      "[farm:content] Generated content output must stay inside the Farm project root, including through symlinks",
    );

  // Check the prospective destination before mkdir or writeFile can follow a link.
  while (true) {
    let actualAncestor: string;
    try {
      actualAncestor = await realpath(existingAncestor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const entry = await lstat(existingAncestor).catch((statError: NodeJS.ErrnoException) => {
        if (statError.code !== "ENOENT") throw statError;
        return undefined;
      });
      if (entry) throw unsafeOutput(); // A dangling symlink is not a missing directory.
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
      continue;
    }
    const destination = path.join(actualAncestor, ...missingSegments);
    const relative = path.relative(actualRoot, destination);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw unsafeOutput();
    }
    return;
  }
}

interface ContentViteDevServer {
  watcher: {
    on(event: "all", listener: (event: string, filePath: string) => void): void;
    off?(event: "all", listener: (event: string, filePath: string) => void): void;
  };
  moduleGraph: {
    getModulesByFile?(file: string): Set<unknown> | undefined;
    invalidateModule(module: unknown): void;
  };
  ws: {
    send(payload: Record<string, unknown>): void;
  };
  httpServer?: {
    once(event: "close", listener: () => void): unknown;
  } | null;
}

async function shouldRebuildForFile(
  root: string,
  filePath: string,
  event: string,
  sourceFiles: Set<string>,
  collections: ContentCollections,
): Promise<boolean> {
  if (sourceFiles.has(filePath)) return true;
  const relative = path.relative(root, filePath);
  if (
    event !== "add" ||
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !isSupportedContentFile(filePath)
  ) {
    return false;
  }

  for (const definition of Object.values(collections)) {
    if (definition.source.kind !== "files") continue;
    const matches = await fg([...definition.source.patterns], {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: [...definition.source.ignore],
    });
    if (matches.some((candidate) => path.resolve(candidate) === filePath)) return true;
  }
  return false;
}

function validateOptions(options: ContentOptions<ContentCollections>): void {
  if (!options || typeof options !== "object" || !options.collections) {
    throw new TypeError("Content plugin needs a collections object");
  }
  if (Object.keys(options.collections).length === 0) {
    throw new TypeError("Content plugin needs at least one collection");
  }
  for (const [name, definition] of Object.entries(options.collections)) {
    if (!definition || typeof definition !== "object") {
      throw new TypeError(`Content collection "${name}" must come from collection()`);
    }
  }
}
