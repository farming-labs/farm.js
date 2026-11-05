/**
 * Server functions called from React Native screens: `import { createNote } from "./server"` in a
 * `page.native.tsx`, then `await createNote(input)`, as a web page calls them.
 *
 * The native bundle never holds the server module. `@farm.js/native`'s Metro resolver swaps a
 * module that defines server functions for stubs that post `{ id, input }` to
 * `FARM_NATIVE_SERVER_FN_PATH` on the app's server, and the server runs the function with its own
 * pipeline (input schema, middleware, handler, output schema). An id names one export of one
 * module, by a hash of its path from the app root, so the bundle and the server agree without
 * sharing a build.
 *
 * The server only runs functions a native screen imports: this scan follows each native screen's
 * app imports to the server function modules it reaches. Build time only (Node).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { transformFarmServerFns } from "../server-fn-transform";
import { readAliases, resolveFile } from "./analyzer";

export { FARM_NATIVE_SERVER_FN_PATH } from "./native-server-fn-names";

export interface FarmNativeServerFnModule {
  /** Absolute module file. */
  file: string;
  /** Each server function it exports, by export name, with its id. */
  exports: Array<{ name: string; id: string }>;
}

const SCRIPT = /\.(?:tsx|ts|jsx|js|mjs)$/;
const NATIVE_SCREEN = /^(?:page|layout)\.(?:native|android|ios)\.(?:tsx|ts|jsx|js)$/;
const IMPORT_SPECIFIERS =
  /(?:^|[^\w$.])(?:import|export)\s*(?:type\s+)?(?:[\w$*{}\s,]+\s+from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function posix(file: string): string {
  return file.split(path.sep).join("/");
}

function real(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/** The id of one exported server function: stable across builds of the same source tree. */
export function farmNativeServerFnId(root: string, file: string, exportName: string): string {
  const relative = posix(path.relative(real(root), real(file)));
  return createHash("sha256").update(`${relative}#${exportName}`).digest("base64url").slice(0, 20);
}

/** The server functions a module defines, or `undefined` for a module that defines none. */
export function describeFarmNativeServerFnModule(
  root: string,
  file: string,
  code: string,
): FarmNativeServerFnModule | undefined {
  if (!code.includes("createServerFn") && !code.includes("createServerQuery")) return undefined;
  const analysis = transformFarmServerFns(code, file, { environment: "client" });
  if (!analysis || analysis.exports.length === 0) return undefined;
  return {
    file,
    exports: analysis.exports.map((name) => ({ name, id: farmNativeServerFnId(root, file, name) })),
  };
}

/** `page.native.tsx`, `page.android.tsx`, `layout.native.tsx`, ... under the app directories. */
export function findFarmNativeScreenFiles(appDirs: readonly string[]): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (NATIVE_SCREEN.test(entry.name)) files.push(file);
    }
  };
  for (const dir of appDirs) visit(dir);
  return files.sort();
}

/**
 * The server function modules the native screens reach through the app's own imports (relative,
 * `@/`, and tsconfig paths). A server function module ends the walk: its own imports are server
 * code the native bundle never loads.
 */
export function collectFarmNativeServerFns(options: {
  root: string;
  srcDir: string;
  entries: readonly string[];
}): FarmNativeServerFnModule[] {
  const { root, srcDir } = options;
  const aliases = readAliases(root, srcDir);
  const seen = new Set<string>();
  const found = new Map<string, FarmNativeServerFnModule>();
  const queue = [...options.entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let code: string;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const module = describeFarmNativeServerFnModule(root, file, code);
    if (module) {
      found.set(file, module);
      continue;
    }
    for (const match of code.matchAll(IMPORT_SPECIFIERS)) {
      const specifier = match[1] ?? match[2]!;
      let candidates: string[] | undefined;
      if (specifier.startsWith(".")) candidates = [path.resolve(path.dirname(file), specifier)];
      else {
        const alias = aliases.find(
          (entry) =>
            specifier.startsWith(entry.prefix) || specifier === entry.prefix.replace(/\/$/, ""),
        );
        if (alias) {
          candidates = alias.targets.map((target) =>
            path.join(target, specifier.slice(alias.prefix.length)),
          );
        }
      }
      for (const candidate of candidates ?? []) {
        const resolved = resolveFile(candidate);
        if (
          resolved &&
          SCRIPT.test(resolved) &&
          !resolved.includes(`${path.sep}node_modules${path.sep}`)
        ) {
          queue.push(resolved);
          break;
        }
      }
    }
  }
  return [...found.values()].sort((left, right) => (left.file < right.file ? -1 : 1));
}

/** Set by Farm's dev server: loads a module in its SSR environment, as API routes load. */
export const FARM_DEV_SERVER_MODULE_LOADER = Symbol.for("farm.dev.loadServerModule");

/**
 * The dev server's `resolve` for the native server function endpoint: scans the native screens on
 * every call, so a function a screen just started importing is callable at once, and loads its
 * module where API routes load theirs, so both see the same module state.
 */
export function createFarmDevNativeServerFnResolver(options: {
  root: string;
  srcDir: string;
  appDirs: () => readonly string[];
}): (id: string) => Promise<unknown> {
  return async (id) => {
    const modules = collectFarmNativeServerFns({
      root: options.root,
      srcDir: options.srcDir,
      entries: findFarmNativeScreenFiles(options.appDirs()),
    });
    for (const module of modules) {
      const entry = module.exports.find((candidate) => candidate.id === id);
      if (!entry) continue;
      const load = (globalThis as Record<symbol, unknown>)[FARM_DEV_SERVER_MODULE_LOADER] as
        | ((file: string) => Promise<Record<string, unknown>>)
        | undefined;
      if (!load) {
        throw new Error(
          "Native server function calls need the Farm dev server or a production build.",
        );
      }
      return (await load(module.file))[entry.name];
    }
    return undefined;
  };
}
