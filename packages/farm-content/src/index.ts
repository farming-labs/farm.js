import path from "node:path";
import { definePlugin } from "@farm.js/core/plugin";
import fg from "fast-glob";
import { collection, files, isSupportedContentFile } from "./config.js";
import { loadContentCollections, writeContentServerModule } from "./loader.js";
import type { ContentCollections, ContentOptions, ContentPlugin } from "./types.js";

const CONTENT_SERVER_ID = "@farm.js/content/server";

export { collection, files };
export type { ContentFilesOptions } from "./config.js";
export type {
  AppContentEntry,
  AppContentRegistry,
  ContentCollection,
  ContentCollectionInput,
  ContentCollectionName,
  ContentCollections,
  ContentEntry,
  ContentFileSource,
  ContentOptions,
  ContentPlugin,
  ContentSchema,
  ContentTransformContext,
  InferContentCollectionEntry,
  InferContentRegistry,
  InferContentSchema,
} from "./types.js";

/** Load schema-validated local content as a typed server-only collection registry. */
export function content<const TCollections extends ContentCollections>(
  options: ContentOptions<TCollections>,
): ContentPlugin<TCollections> {
  validateOptions(options);
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

  async function rebuild(): Promise<void> {
    const loaded = await loadContentCollections(root, options.collections);
    sourceFiles = new Set(loaded.sourceFiles);
    await writeContentServerModule(generatedFile, loaded.collections);
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
      },
    };
  }

  return plugin;
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
