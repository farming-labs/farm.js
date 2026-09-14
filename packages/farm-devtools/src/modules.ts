import path from "node:path";
import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import type { ModuleNode, ViteDevServer } from "vite";
import type { InspectedModule, ModuleDetails } from "./types.js";

const SOURCE_LIMIT = 1024 * 1024;
const MODULE_LIMIT = 500;
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|css|vue|svelte)$/i;

export class ModuleInspectionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

/** Only already-transformed browser modules are eligible. Never transform or execute on request. */
export function createModuleInspector(server: ViteDevServer) {
  const root = path.resolve(server.config.root);
  const rootReal = realpath(root);
  function entries() {
    return [...server.moduleGraph.idToModuleMap.values()]
      .filter(
        (module) =>
          module.id &&
          module.file &&
          module.transformResult &&
          contained(root, module.file) &&
          SOURCE_EXTENSION.test(module.file) &&
          !path
            .relative(root, module.file)
            .split(path.sep)
            .some((part) => part.startsWith(".") || part === "node_modules"),
      )
      .sort((a, b) => a.id!.localeCompare(b.id!));
  }
  function summary(module: ModuleNode): InspectedModule {
    return {
      id: createHash("sha256").update(module.id!).digest("hex"),
      path: path.relative(root, module.file!).split(path.sep).join("/"),
      url: module.url,
    };
  }
  async function safe(module: ModuleNode): Promise<string | undefined> {
    try {
      const canonical = await realpath(module.file!);
      const realRoot = await rootReal;
      return contained(realRoot, canonical) &&
        SOURCE_EXTENSION.test(canonical) &&
        !path
          .relative(realRoot, canonical)
          .split(path.sep)
          .some((part) => part.startsWith(".") || part === "node_modules")
        ? canonical
        : undefined;
    } catch {
      return undefined;
    }
  }
  return {
    async list(): Promise<{ modules: InspectedModule[]; limited: boolean }> {
      const candidates = entries();
      const modules: InspectedModule[] = [];
      for (const module of candidates) {
        if (await safe(module)) modules.push(summary(module));
        if (modules.length === MODULE_LIMIT) break;
      }
      return {
        modules,
        limited: candidates.length > modules.length && modules.length === MODULE_LIMIT,
      };
    },
    async read(id: string): Promise<ModuleDetails> {
      if (!/^[a-f0-9]{64}$/.test(id))
        throw new ModuleInspectionError("Unknown browser module", 404);
      const module = entries().find((entry) => summary(entry).id === id);
      const canonical = module && (await safe(module));
      // Vite can invalidate the transform while the filesystem check is pending.
      const transformed = module?.transformResult?.code;
      if (!module || !canonical || transformed === undefined)
        throw new ModuleInspectionError(
          "Module is no longer available. Reload the app and refresh Inspect.",
          404,
        );
      if (Buffer.byteLength(transformed) > SOURCE_LIMIT)
        throw new ModuleInspectionError("Module exceeds the 1 MiB inspection limit", 413);
      const file = await open(canonical, "r");
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > SOURCE_LIMIT)
          throw new ModuleInspectionError("Source exceeds the 1 MiB inspection limit", 413);
        const buffer = Buffer.alloc(SOURCE_LIMIT + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
          const chunk = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
          if (!chunk.bytesRead) break;
          bytesRead += chunk.bytesRead;
        }
        if (bytesRead > SOURCE_LIMIT)
          throw new ModuleInspectionError("Source exceeds the 1 MiB inspection limit", 413);
        return {
          ...summary(module),
          source: buffer.subarray(0, bytesRead).toString("utf8"),
          transformed,
          imports: [...module.importedModules].map((entry) => entry.url).sort(),
          importers: [...module.importers].map((entry) => entry.url).sort(),
        };
      } finally {
        await file.close();
      }
    },
  };
}
