/**
 * The `react-server` export condition in islands mode. A package written for React Server
 * Components can ship a build for server code under `react-server` (react-tweet renders its
 * `Tweet` on the server there; its default build fetches the tweet in the browser). React Server
 * Components resolve every import in the server graph with that condition. Islands render server
 * and client components in one graph, so Farm resolves it per import: a server module's import of
 * such a package points at its `react-server` build, and the packages that build imports do too.
 *
 * React's own packages keep their default build: server and client components share one React.
 * A name the `react-server` build re-exports from a `"use client"` module stays a client component:
 * it renders through its client reference (`islands-package-references.ts`), which the browser
 * loads from the package's default build, as React Server Components send a client reference.
 */
import fs from "node:fs";
import path from "node:path";
import { parseAst } from "rolldown/parseAst";
import { parseSync } from "rolldown/utils";
import { FARM_VERSION } from "./version";
import {
  farmSourceSnapshotPathKey,
  memoizeInFarmSourceSnapshot,
  noteFarmSourceRead,
} from "./utils/source-snapshot";

type AstNode = Record<string, any>;

/** Packages that must stay one copy for server and client components. */
const REACT_PACKAGES = new Set([
  "react",
  "react-dom",
  "scheduler",
  "react-server-dom-webpack",
  "react-server-dom-esm",
  "react-server-dom-turbopack",
]);

const CLIENT_ONLY_PACKAGE = "client-only";
const SERVER_CONDITIONS = ["react-server", "node", "import", "module", "default"];
const DEFAULT_CONDITIONS = ["node", "import", "module", "default"];
const SCRIPT_EXTENSIONS = ["", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts"];
const INDEX_FILES = ["index.js", "index.mjs", "index.cjs", "index.ts", "index.tsx"];

function packageNameOf(specifier: string): { name: string; subpath: string } | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.includes(":") ||
    specifier.includes("\0")
  ) {
    return null;
  }
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  if (!name || (specifier.startsWith("@") && parts.length < 2)) return null;
  return { name, subpath: parts.slice(name.startsWith("@") ? 2 : 1).join("/") };
}

function findPackageDirectory(importer: string, name: string): string | null {
  for (let current = path.dirname(importer); ; current = path.dirname(current)) {
    const directory = path.join(current, "node_modules", name);
    if (fs.existsSync(path.join(directory, "package.json"))) return fs.realpathSync(directory);
    if (path.dirname(current) === current) return null;
  }
}

/** Node's conditional export resolution: the first key, in object order, that matches. */
function pickTarget(value: unknown, conditions: readonly string[]): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const target = pickTarget(entry, conditions);
      if (target) return target;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "types" || !conditions.includes(key)) continue;
    const target = pickTarget(entry, conditions);
    if (target) return target;
  }
  return null;
}

function exportEntry(exportsField: unknown, subpath: string): unknown {
  const key = subpath ? `./${subpath}` : ".";
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    return key === "." ? exportsField : undefined;
  }
  if (!exportsField || typeof exportsField !== "object") return undefined;
  const entries = exportsField as Record<string, unknown>;
  if (!Object.keys(entries).some((entry) => entry.startsWith("."))) {
    return key === "." ? entries : undefined;
  }
  if (entries[key] !== undefined) return entries[key];
  for (const [pattern, value] of Object.entries(entries)) {
    const star = pattern.indexOf("*");
    if (star === -1) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      const match = key.slice(prefix.length, key.length - suffix.length);
      const replace = (target: unknown): unknown =>
        typeof target === "string"
          ? target.replace("*", match)
          : target && typeof target === "object" && !Array.isArray(target)
            ? Object.fromEntries(
                Object.entries(target as Record<string, unknown>).map(([k, v]) => [k, replace(v)]),
              )
            : target;
      return replace(value);
    }
  }
  return undefined;
}

const cache = new Map<string, string | null>();

/**
 * The file `specifier` resolves to with the `react-server` condition, from `importer`, when that
 * differs from the file it resolves to without it; otherwise null. React's packages are always null.
 */
export function resolveFarmReactServerExport(importer: string, specifier: string): string | null {
  const parsed = packageNameOf(specifier);
  // Farm's own packages ship `react-server` builds for its RSC engine; islands run their default
  // builds, which carry islands' client navigation and runtime.
  if (!parsed || REACT_PACKAGES.has(parsed.name) || parsed.name.startsWith("@farm.js/"))
    return null;
  const directory = findPackageDirectory(importer, parsed.name);
  if (!directory) return null;
  const key = `${directory}\0${parsed.subpath}`;
  if (cache.has(key)) return cache.get(key)!;
  let resolved: string | null = null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    const entry = exportEntry(manifest.exports, parsed.subpath);
    const server = pickTarget(entry, SERVER_CONDITIONS);
    const fallback = pickTarget(entry, DEFAULT_CONDITIONS);
    if (server && server !== fallback && server.startsWith("./")) {
      const file = path.resolve(directory, server);
      if (fs.existsSync(file)) resolved = file;
    }
  } catch {
    resolved = null;
  }
  cache.set(key, resolved);
  return resolved;
}

/** The language Farm's analyses parse `file` as: TypeScript, with JSX outside `.ts` files. */
function parseLang(file: string): "ts" | "tsx" {
  const extension = path.extname(file).slice(1);
  return extension === "ts" || extension === "mts" || extension === "cts" ? "ts" : "tsx";
}

const parsedModules = new Map<string, { size: number; mtimeMs: number; program: AstNode | null }>();

/** `file` parsed, once per version of it: tracing reads the same package files for every import. */
function readModule(file: string): AstNode | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  noteFarmSourceRead(file);
  const cached = parsedModules.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.program;
  let program: AstNode | null = null;
  try {
    const code = fs.readFileSync(file, "utf8");
    program = parseAst(code, { lang: parseLang(file) }) as unknown as AstNode;
  } catch {
    program = null;
  }
  parsedModules.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, program });
  return program;
}

function isClientModule(program: AstNode): boolean {
  for (const node of program.body ?? []) {
    if (node.type !== "ExpressionStatement" || typeof node.directive !== "string") break;
    if (node.directive === "use client") return true;
  }
  return false;
}

function resolveRelative(from: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(from), specifier);
  for (const extension of SCRIPT_EXTENSIONS) {
    const file = `${base}${extension}`;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  for (const index of INDEX_FILES) {
    const file = path.join(base, index);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function exportedName(node: AstNode | undefined): string | undefined {
  return node?.type === "Identifier" ? node.name : node?.value;
}

/** The file a bare `specifier` resolves to from `importer` with the default (browser) build. */
export function resolveFarmPackageDefaultEntry(
  importer: string,
  specifier: string,
  conditions: readonly string[] = ["browser", ...DEFAULT_CONDITIONS],
): string | null {
  const parsed = packageNameOf(specifier);
  if (!parsed) return null;
  const directory = findPackageDirectory(importer, parsed.name);
  if (!directory) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    const target =
      pickTarget(exportEntry(manifest.exports, parsed.subpath), conditions) ??
      (!parsed.subpath ? (manifest.module ?? manifest.main ?? "index.js") : parsed.subpath);
    return resolveRelative(
      path.join(directory, "package.json"),
      `./${String(target).replace(/^\.\//, "")}`,
    );
  } catch {
    return null;
  }
}

/** Where `source`, imported or re-exported by `file`, resolves: relative files and packages. */
function resolveSource(file: string, source: string): string | null {
  if (source.startsWith(".")) return resolveRelative(file, source);
  return resolveFarmPackageDefaultEntry(file, source);
}

interface TracedExport {
  kind: "client" | "server";
  /** The module that defines the name (the `"use client"` module for a client name). */
  file: string;
}

function traceExport(file: string, name: string, depth: number): TracedExport | undefined {
  if (depth > 8) return undefined;
  const program = readModule(file);
  if (!program) return undefined;
  const client = isClientModule(program);
  const here = (kind: "client" | "server"): TracedExport => ({ kind, file });
  // A CommonJS client module has no export statements to read, so it answers for every name.
  if (
    client &&
    !(program.body ?? []).some((node: AstNode) => (node.type ?? "").startsWith("Export"))
  ) {
    return here("client");
  }
  const follow = (source: string, imported: string) => {
    const target = resolveSource(file, source);
    return target ? traceExport(target, imported, depth + 1) : undefined;
  };
  const imports = new Map<string, { source: string; imported: string }>();
  for (const node of program.body ?? []) {
    if (node.type !== "ImportDeclaration" || typeof node.source?.value !== "string") continue;
    for (const specifier of node.specifiers ?? []) {
      if (specifier.type === "ImportNamespaceSpecifier") continue;
      const imported =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : (exportedName(specifier.imported) ?? specifier.local.name);
      imports.set(specifier.local.name, { source: node.source.value, imported });
    }
  }
  const local = (localName: string) => {
    const binding = imports.get(localName);
    return binding ? follow(binding.source, binding.imported) : here("server");
  };
  // A `"use client"` module's own exports are client components, wherever their code comes from.
  const own = (traced: () => TracedExport | undefined) => (client ? here("client") : traced());
  const stars: string[] = [];
  for (const node of program.body ?? []) {
    if (node.type === "ExportNamedDeclaration" && node.source) {
      for (const specifier of node.specifiers ?? []) {
        if (exportedName(specifier.exported) !== name) continue;
        return own(() => follow(node.source.value, exportedName(specifier.local) ?? name));
      }
    } else if (node.type === "ExportAllDeclaration" && node.source && !node.exported) {
      stars.push(node.source.value);
    } else if (node.type === "ExportNamedDeclaration" && !node.source) {
      for (const specifier of node.specifiers ?? []) {
        if (exportedName(specifier.exported) === name) {
          return own(() => local(exportedName(specifier.local) ?? name));
        }
      }
      const declared = [
        ...(node.declaration?.id ? [node.declaration.id.name] : []),
        ...(node.declaration?.declarations ?? []).map((declarator: AstNode) => declarator.id?.name),
      ];
      if (declared.includes(name)) return here(client ? "client" : "server");
    } else if (node.type === "ExportDefaultDeclaration" && name === "default") {
      return own(() =>
        node.declaration?.type === "Identifier" ? local(node.declaration.name) : here("server"),
      );
    }
  }
  // `export *` passes on only the names its module exports, so a `"use client"` module it reaches
  // claims those names and no others.
  for (const source of stars) {
    const traced = follow(source, name);
    if (traced) return own(() => traced);
  }
  return undefined;
}

/**
 * Where `name`, as `file` exports it, comes from: `"client"` for a `"use client"` module,
 * `"server"` for any other module that defines it, undefined when that cannot be told (not found,
 * CommonJS, too deep). Follows re-exports (`export { x } from`, `export * from`) and local names
 * bound by imports (`import { x } from "./x.js"; export { x }`), through relative files and
 * packages.
 */
export function traceFarmExport(file: string, name: string): "client" | "server" | undefined {
  return traceExport(file, name, 0)?.kind;
}

/**
 * Whether `name`, as `file` exports it, comes from a `"use client"` module, following re-exports
 * and imported local names through relative files and packages.
 */
export function isFarmClientExport(file: string, name: string): boolean {
  return traceFarmExport(file, name) === "client";
}

/**
 * Whether `specifier`'s `name` export, imported from `importer`, is not known to be server code,
 * so a server component gets it as a client reference, as RSC would. A name the package defines
 * outside any `"use client"` module (`dehydrate`, `QueryClient`) stays a plain import.
 */
export function isFarmPackageClientExport(
  importer: string,
  specifier: string,
  name: string,
): boolean {
  // A hydration plan asks this for each name each route imports from a package; the answer
  // depends on the importer only through the directory it resolves the package from.
  return memoizeInFarmSourceSnapshot(
    "package-client-export",
    `${farmSourceSnapshotPathKey(path.dirname(importer))}\0${specifier}\0${name}`,
    () => {
      const entry = resolveFarmPackageDefaultEntry(importer, specifier);
      return !entry || traceFarmExport(entry, name) !== "server";
    },
  );
}

/** A module's imports of packages, with the names each reads. */
interface PackageImport {
  start: number;
  end: number;
  specifier: string;
  sideEffect: boolean;
  defaultLocal?: string;
  named: Array<{ imported: string; local: string }>;
  namespace?: { local: string; members: string[] | null };
}

function parseCode(code: string, file: string): AstNode | null {
  const lang = parseLang(file);
  // The scope islands-package-references.ts parses in: a build's transform of a server module
  // parses it once for both rewrites.
  return memoizeInFarmSourceSnapshot(`ast:${lang}`, code, () => {
    try {
      return parseAst(code, { lang }) as unknown as AstNode;
    } catch {
      return null;
    }
  });
}

function namespaceMembers(program: AstNode, local: string): string[] | null {
  const members = new Set<string>();
  let opaque = false;
  const visit = (node: unknown, parent: AstNode | null) => {
    if (opaque || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent);
      return;
    }
    const current = node as AstNode;
    if (typeof current.type !== "string") return;
    if (
      (current.type === "Identifier" || current.type === "JSXIdentifier") &&
      current.name === local &&
      parent?.type !== "ImportNamespaceSpecifier"
    ) {
      const property =
        (parent?.type === "MemberExpression" || parent?.type === "JSXMemberExpression") &&
        parent.object === current &&
        !parent.computed
          ? parent.property?.name
          : undefined;
      if (property) members.add(property);
      else opaque = true;
      return;
    }
    for (const [key, value] of Object.entries(current)) {
      if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
      if (value && typeof value === "object") visit(value, current);
    }
  };
  visit(program, null);
  return opaque ? null : [...members];
}

function findPackageImports(program: AstNode, accept: (specifier: string) => boolean) {
  const found: PackageImport[] = [];
  for (const node of program.body ?? []) {
    if (node.type !== "ImportDeclaration" || node.importKind === "type") continue;
    const specifier = node.source?.value;
    if (typeof specifier !== "string" || !accept(specifier)) continue;
    const specifiers: AstNode[] = (node.specifiers ?? []).filter(
      (entry: AstNode) => entry.importKind !== "type",
    );
    if ((node.specifiers ?? []).length > 0 && specifiers.length === 0) continue;
    const entry: PackageImport = {
      start: node.start,
      end: node.end,
      specifier,
      sideEffect: specifiers.length === 0,
      named: [],
    };
    for (const binding of specifiers) {
      if (binding.type === "ImportDefaultSpecifier") entry.defaultLocal = binding.local.name;
      else if (binding.type === "ImportNamespaceSpecifier") {
        entry.namespace = {
          local: binding.local.name,
          members: namespaceMembers(program, binding.local.name),
        };
      } else {
        const imported = exportedName(binding.imported);
        if (imported) entry.named.push({ imported, local: binding.local.name });
      }
    }
    found.push(entry);
  }
  return found;
}

/** The names a server module imports from `specifier` that are client components there. */
export function findFarmReactServerClientNames(
  code: string,
  file: string,
  specifier: string,
): string[] | null {
  const target = resolveFarmReactServerExport(file, specifier);
  if (!target) return null;
  const program = parseCode(code, file);
  if (!program) return null;
  const names = new Set<string>();
  for (const entry of findPackageImports(program, (candidate) => candidate === specifier)) {
    const wanted = [
      ...(entry.defaultLocal ? ["default"] : []),
      ...entry.named.map((binding) => binding.imported),
      ...(entry.namespace?.members ?? []),
    ];
    for (const name of wanted) if (isFarmClientExport(target, name)) names.add(name);
  }
  return [...names];
}

/**
 * Whether a module statement loads `"use client"` code that a server module renders: an import, or
 * a named re-export (a barrel's `export { Video } from "./video.js"`). `export *` is left out: it
 * passes a client module's names on (react-tweet's hooks) rather than rendering them.
 */
function clientModuleSource(node: AstNode): string | null {
  if (node.importKind === "type" || node.exportKind === "type") return null;
  const source =
    (node.type === "ImportDeclaration" ||
      (node.type === "ExportNamedDeclaration" && node.source)) &&
    node.source?.value;
  return typeof source === "string" && source.startsWith(".") ? source : null;
}

function isClientModuleFile(file: string): boolean {
  const program = readModule(file);
  return program !== null && isClientModule(program);
}

/**
 * The `"use client"` modules inside a package that its `react-server` build renders for the names
 * a server module imports from `specifier` (react-tweet's server `Tweet` renders its video and copy
 * button from `"use client"` files). React Server Components send each as a client reference;
 * islands render them through one (`ensureFarmInternalClientReference`). Null when the package
 * has no `react-server` build.
 */
export function findFarmReactServerClientModules(
  code: string,
  file: string,
  specifier: string,
): string[] | null {
  const target = resolveFarmReactServerExport(file, specifier);
  if (!target) return null;
  const program = parseCode(code, file);
  if (!program) return null;
  const found = new Set<string>();
  const seen = new Set<string>();
  const walk = (current: string, depth: number) => {
    if (depth > 8 || seen.has(current)) return;
    seen.add(current);
    const module = readModule(current);
    if (!module || isClientModule(module)) return;
    for (const node of module.body ?? []) {
      const source =
        clientModuleSource(node) ??
        (node.type === "ExportAllDeclaration" && typeof node.source?.value === "string"
          ? node.source.value
          : null);
      if (!source?.startsWith(".")) continue;
      const child = resolveRelative(current, source);
      if (!child) continue;
      if (isClientModuleFile(child)) {
        if (clientModuleSource(node)) found.add(child);
      } else walk(child, depth + 1);
    }
  };
  for (const entry of findPackageImports(program, (candidate) => candidate === specifier)) {
    const wanted = [
      ...(entry.defaultLocal ? ["default"] : []),
      ...entry.named.map((binding) => binding.imported),
      ...(entry.namespace?.members ?? []),
    ];
    for (const name of wanted) {
      const traced = traceExport(target, name, 0);
      if (traced?.kind === "server") walk(traced.file, 0);
    }
  }
  return [...found].sort();
}

/**
 * A file of a package's `react-server` build with its imports of the package's own `"use client"`
 * modules pointed at their client references (`reference(file)`), or null when it has none.
 */
export function rewriteFarmReactServerClientModuleImports(options: {
  code: string;
  file: string;
  /** The client reference for a `"use client"` file, or null to keep its import as it is. */
  reference(clientFile: string): string | null;
}): string | null {
  if (!options.code.includes("import") && !options.code.includes("export")) return null;
  const program = parseCode(options.code, options.file);
  if (!program) return null;
  const sources: Array<{ start: number; end: number; reference: string }> = [];
  for (const node of program.body ?? []) {
    const source = clientModuleSource(node);
    if (!source) continue;
    const child = resolveRelative(options.file, source);
    if (!child || !isClientModuleFile(child)) continue;
    const reference = options.reference(child);
    if (reference) sources.push({ start: node.source.start, end: node.source.end, reference });
  }
  if (sources.length === 0) return null;
  let output = options.code;
  for (const entry of sources.sort((left, right) => right.start - left.start)) {
    output =
      output.slice(0, entry.start) + JSON.stringify(entry.reference) + output.slice(entry.end);
  }
  return output;
}

/**
 * A server module with its imports of packages that ship a `react-server` build pointed at it
 * (names that are client components there go through `reference(specifier, name)`), or null when
 * it has none. `onServerFile` receives each `react-server` file it points at.
 */
export function rewriteFarmReactServerImports(options: {
  code: string;
  file: string;
  reference(specifier: string, exportName: string): string;
  onServerFile?(file: string): void;
}): string | null {
  if (!options.code.includes("import")) return null;
  const program = parseCode(options.code, options.file);
  if (!program) return null;
  const targets = new Map<string, string>();
  const imports = findPackageImports(program, (specifier) => {
    const target = resolveFarmReactServerExport(options.file, specifier);
    if (target) targets.set(specifier, target);
    return target !== null;
  });
  if (imports.length === 0) return null;
  let output = options.code;
  let next = 0;
  for (const entry of [...imports].sort((left, right) => right.start - left.start)) {
    const target = targets.get(entry.specifier)!;
    options.onServerFile?.(target);
    const server = JSON.stringify(target);
    const lines: string[] = [];
    const bind = (name: string, local: string) => {
      if (isFarmClientExport(target, name)) {
        lines.push(
          `import { ${name} as ${local} } from ${JSON.stringify(options.reference(entry.specifier, name))};`,
        );
      } else lines.push(`import { ${name} as ${local} } from ${server};`);
    };
    if (entry.sideEffect) lines.push(`import ${server};`);
    if (entry.defaultLocal) bind("default", entry.defaultLocal);
    for (const binding of entry.named) bind(binding.imported, binding.local);
    if (entry.namespace) {
      if (entry.namespace.members === null) {
        lines.push(`import * as ${entry.namespace.local} from ${server};`);
      } else {
        const fields: string[] = [];
        for (const member of entry.namespace.members) {
          const local = `__farm_react_server_${next++}__`;
          bind(member, local);
          fields.push(`${member}: ${local}`);
        }
        lines.push(`const ${entry.namespace.local} = Object.freeze({ ${fields.join(", ")} });`);
      }
    }
    output = output.slice(0, entry.start) + lines.join("\n") + output.slice(entry.end);
  }
  return output;
}

/** The modules `program` loads statically; type-only imports are not loaded. */
function staticImportSources(program: AstNode): string[] {
  const sources: string[] = [];
  for (const node of program.body ?? []) {
    if (
      node.type !== "ImportDeclaration" &&
      node.type !== "ExportAllDeclaration" &&
      !(node.type === "ExportNamedDeclaration" && node.source)
    ) {
      continue;
    }
    if (node.importKind === "type" || node.exportKind === "type") continue;
    if (typeof node.source?.value === "string") sources.push(node.source.value);
  }
  return sources;
}

interface StaticImports {
  /** What `staticImportSources` returns for the module's program. */
  sources: string[];
  /** Whether the module starts with `"use client"` (`isClientModule`). */
  client: boolean;
}

// `export {} from "mod"` loads "mod", but the module record has no entry for it. Whitespace and
// comments may separate the tokens; matching more than that only costs a program.
const GAP = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n\r\u2028\u2029]*)*`;
const EMPTY_EXPORT_LIST = new RegExp(String.raw`\bexport${GAP}\{${GAP}\}`);

/**
 * A module's static imports and its `"use client"` directive, or null when it does not parse, as
 * `staticImportSources` and `isClientModule` read them from its program. The parser's module record
 * lists them without building that program, the bulk of a parse; a module whose record cannot
 * tell (a type-only import or export, an empty export list, a prologue that mentions
 * "use client") reads them from the program.
 */
function scanFarmStaticImports(code: string, lang: "ts" | "tsx"): StaticImports | null {
  let result: ReturnType<typeof parseSync>;
  try {
    // The options `parseAst` passes, so a module parses (or fails to) as it does there.
    result = parseSync("file.js", code, { lang, preserveParens: false });
  } catch {
    return null;
  }
  if (result.errors.length > 0) return null;
  const fromProgram = (): StaticImports => {
    const program = result.program as unknown as AstNode;
    return { sources: staticImportSources(program), client: isClientModule(program) };
  };
  const statements: Array<{ start: number; source: string }> = [];
  for (const entry of result.module.staticImports) {
    // `import type { a }` loads nothing and `import { type a }` loads the module; both are types.
    if (entry.entries.some((binding) => binding.isType)) return fromProgram();
    statements.push({ start: entry.start, source: entry.moduleRequest.value });
  }
  const imported = new Set(statements.map((statement) => statement.start));
  for (const entry of result.module.staticExports) {
    if (entry.entries.some((binding) => binding.isType)) return fromProgram();
    // `import { a } from "mod"; export { a }` records an export of "mod" at the import statement:
    // only a request inside an export statement of its own is that statement's `from`.
    const request = entry.entries[0]?.moduleRequest;
    if (
      request &&
      !imported.has(entry.start) &&
      request.start >= entry.start &&
      request.end <= entry.end
    ) {
      statements.push({ start: entry.start, source: request.value });
    }
  }
  if (EMPTY_EXPORT_LIST.test(code)) return fromProgram();
  statements.sort((left, right) => left.start - right.start);
  // Directives come before every statement: without "use client" before the first import, the
  // module has none.
  const prologueEnd = statements[0]?.start ?? code.length;
  if (code.slice(0, prologueEnd).includes("use client")) return fromProgram();
  return { sources: statements.map((statement) => statement.source), client: false };
}

const scannedModules = new Map<
  string,
  { size: number; mtimeMs: number; imports: StaticImports | null }
>();

/** `scanFarmStaticImports` of `file`, once per version of it. */
function readModuleImports(file: string): StaticImports | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  noteFarmSourceRead(file);
  const cached = scannedModules.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.imports;
  const parsed = parsedModules.get(file);
  let imports: StaticImports | null;
  if (parsed && parsed.size === stat.size && parsed.mtimeMs === stat.mtimeMs) {
    // Another analysis has the program already.
    imports = parsed.program
      ? { sources: staticImportSources(parsed.program), client: isClientModule(parsed.program) }
      : null;
  } else {
    let code: string | undefined;
    try {
      code = fs.readFileSync(file, "utf8");
    } catch {
      code = undefined;
    }
    imports = code === undefined ? null : scanFarmStaticImports(code, parseLang(file));
  }
  scannedModules.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, imports });
  return imports;
}

/** Files already walked without reaching `client-only`. */
const clientOnlyFreeFiles = new Set<string>();

/** Forgets the walked files (a file changed in development). */
export function invalidateFarmClientOnlyScan(): void {
  clientOnlyFreeFiles.clear();
}

/** The build of `specifier` a server module loads. */
function resolveServerEntry(importer: string, specifier: string): string | null {
  const parsed = packageNameOf(specifier);
  if (!parsed || REACT_PACKAGES.has(parsed.name) || parsed.name.startsWith("@farm.js/")) {
    return null;
  }
  return (
    resolveFarmReactServerExport(importer, specifier) ??
    resolveFarmPackageDefaultEntry(importer, specifier, DEFAULT_CONDITIONS)
  );
}

/**
 * `resolved` holds the files the imports seen so far resolve to, by importing directory and source:
 * an icon library's every icon module imports the same factory.
 */
function walkToClientOnly(
  file: string,
  seen: Set<string>,
  resolved: Map<string, string | null>,
): string[] | null {
  if (seen.has(file) || clientOnlyFreeFiles.has(file)) return null;
  seen.add(file);
  const imports = readModuleImports(file);
  // `"use client"` is the boundary: what it imports is client code.
  if (!imports || imports.client) return null;
  for (const source of imports.sources) {
    if (source === CLIENT_ONLY_PACKAGE) return [file];
    const key = `${path.dirname(file)}\0${source}`;
    let child = resolved.get(key);
    if (child === undefined) {
      child = source.startsWith(".")
        ? resolveRelative(file, source)
        : resolveServerEntry(file, source);
      resolved.set(key, child);
    }
    const chain = child && walkToClientOnly(child, seen, resolved);
    if (chain) return [file, ...chain];
  }
  return null;
}

/**
 * The first package import in a server module whose server build reaches `client-only` without
 * crossing `"use client"`, with the files between them. React Server Components fail that build.
 * In islands mode the module would render its markup and never hydrate.
 */
export function findFarmClientOnlyImport(
  code: string,
  file: string,
): { specifier: string; chain: string[] } | null {
  if (!code.includes("import") && !code.includes("export")) return null;
  const imports = scanFarmStaticImports(code, parseLang(file));
  if (!imports) return null;
  // Within one check, each import resolves once from each directory.
  const resolved = new Map<string, string | null>();
  for (const specifier of imports.sources) {
    const entry = resolveServerEntry(file, specifier);
    if (!entry) continue;
    const seen = new Set<string>();
    const chain = walkToClientOnly(entry, seen, resolved);
    if (chain) return { specifier, chain };
    for (const walked of seen) clientOnlyFreeFiles.add(walked);
  }
  return null;
}

/** The files a module imports by relative path, resolved. */
export function farmRelativeImportFiles(code: string, file: string): string[] {
  const program = parseCode(code, file);
  if (!program) return [];
  const files: string[] = [];
  for (const node of program.body ?? []) {
    const source =
      (node.type === "ImportDeclaration" ||
        node.type === "ExportAllDeclaration" ||
        (node.type === "ExportNamedDeclaration" && node.source)) &&
      node.source?.value;
    if (typeof source !== "string" || !source.startsWith(".")) continue;
    const resolved = resolveRelative(file, source);
    if (resolved) files.push(resolved);
  }
  return files;
}

/**
 * Whether the build of `specifier` that server components get, from `importer`, reaches an internal
 * `"use client"` module. React Server Components' dev server loads that module straight from the
 * package for the browser, so the same package pre-bundled by Vite would be a second copy (two
 * React contexts).
 */
export function farmReactServerBuildReachesClientModules(
  importer: string,
  specifier: string,
  /**
   * A server module imports the package: its default build then serves server components too,
   * and its internal `"use client"` modules are client references (React Query's
   * `HydrationBoundary`).
   */
  serverImported = false,
): boolean {
  const target =
    resolveFarmReactServerExport(importer, specifier) ??
    (serverImported ? resolveFarmPackageDefaultEntry(importer, specifier) : null);
  if (!target) return false;
  const seen = new Set<string>();
  const reaches = (file: string, depth: number): boolean => {
    if (depth > 6 || seen.has(file)) return false;
    seen.add(file);
    const program = readModule(file);
    if (!program) return false;
    if (depth > 0 && isClientModule(program)) return true;
    for (const node of program.body ?? []) {
      const source =
        (node.type === "ExportAllDeclaration" ||
          (node.type === "ExportNamedDeclaration" && node.source) ||
          node.type === "ImportDeclaration") &&
        node.source?.value;
      if (typeof source !== "string" || !source.startsWith(".")) continue;
      const child = resolveRelative(file, source);
      if (child && reaches(child, depth + 1)) return true;
    }
    return false;
  };
  return reaches(target, 0);
}

/** The package directory `specifier` resolves to from `importer`, for its manifest. */
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'./][^"']*)["']/g;
const STYLESHEET_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'][^"']+\.(?:css|scss|sass|less|styl)["']/;
const MAX_SCANNED_FILES = 2000;
const FARM_FONT_MODULE = "@farm.js/core/font";

interface PackageScan {
  /** The bare specifiers its script files import. */
  imports: Set<string>;
  /** Whether a script file imports a stylesheet, which Node cannot load. */
  stylesheets: boolean;
}

const packageScans = new Map<string, PackageScan>();

/** A path a scan read, relative to the package directory, with its size, mtimeMs and ctimeMs. */
type PackageScanStamp = [path: string, size: number, mtimeMs: number, ctimeMs: number];

interface StoredPackageScan {
  imports: string[];
  stylesheets: boolean;
  /** Every directory the scan listed and file it read. */
  paths: PackageScanStamp[];
}

/** Bump when the scan's semantics or the stored shape change. */
const PACKAGE_SCAN_CACHE_SCHEMA = 1;
const packageScanStamps = new Map<string, PackageScanStamp[]>();
let packageScanCache:
  | { file: string; stored: Map<string, StoredPackageScan>; dirty: boolean }
  | undefined;

function stampScannedPath(directory: string, target: string): PackageScanStamp | undefined {
  try {
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat) return undefined;
    return [path.relative(directory, target), stat.size, stat.mtimeMs, stat.ctimeMs];
  } catch {
    return undefined;
  }
}

function isUnchangedScanStamp(directory: string, stamp: PackageScanStamp): boolean {
  const current = stampScannedPath(directory, path.join(directory, stamp[0]));
  return (
    current !== undefined &&
    current[1] === stamp[1] &&
    current[2] === stamp[2] &&
    current[3] === stamp[3]
  );
}

/**
 * @internal Reuse the package scans saved in `file`, and save new ones there with
 * `persistPackageScanCache`. A saved scan applies again only while every directory it listed and
 * file it read keeps its size, mtime and ctime, so a package installed or patched since is read
 * again.
 */
export function usePackageScanCacheFile(file: string): void {
  if (packageScanCache?.file === file) return;
  const stored = new Map<string, StoredPackageScan>();
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      value?.schema === PACKAGE_SCAN_CACHE_SCHEMA &&
      value.farm === FARM_VERSION &&
      value.scans &&
      typeof value.scans === "object"
    ) {
      for (const [directory, scan] of Object.entries(value.scans)) {
        if (isStoredPackageScan(scan)) stored.set(directory, scan);
      }
    }
  } catch {
    // No saved scans yet, or a file this version cannot read: every package is scanned.
  }
  packageScanCache = { file, stored, dirty: false };
}

function isStoredPackageScan(value: unknown): value is StoredPackageScan {
  const scan = value as StoredPackageScan | null;
  return (
    !!scan &&
    Array.isArray(scan.imports) &&
    scan.imports.every((item) => typeof item === "string") &&
    typeof scan.stylesheets === "boolean" &&
    Array.isArray(scan.paths) &&
    scan.paths.every(
      (stamp) =>
        Array.isArray(stamp) &&
        stamp.length === 4 &&
        typeof stamp[0] === "string" &&
        stamp.slice(1).every((part) => typeof part === "number"),
    )
  );
}

/** @internal Write the scans this process made to the file `usePackageScanCacheFile` named. */
export function persistPackageScanCache(): void {
  const cache = packageScanCache;
  if (!cache?.dirty) return;
  // Only the packages this process reached, so the file follows the app's current dependencies.
  const scans: Record<string, StoredPackageScan> = {};
  for (const [directory, paths] of packageScanStamps) {
    const scan = packageScans.get(directory);
    if (scan)
      scans[directory] = { imports: [...scan.imports], stylesheets: scan.stylesheets, paths };
  }
  const temporary = `${cache.file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(cache.file), { recursive: true });
    fs.writeFileSync(
      temporary,
      JSON.stringify({ schema: PACKAGE_SCAN_CACHE_SCHEMA, farm: FARM_VERSION, scans }),
    );
    fs.renameSync(temporary, cache.file);
    cache.dirty = false;
  } catch {
    // The cache only saves work; a run that cannot write it is still correct.
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Nothing to clean up.
    }
  }
}

/** The script files under `directory`, read once, skipping nested packages. */
function scanPackage(directory: string): PackageScan {
  const cached = packageScans.get(directory);
  if (cached) return cached;
  const stored = packageScanCache?.stored.get(directory);
  if (stored && stored.paths.every((stamp) => isUnchangedScanStamp(directory, stamp))) {
    const scan: PackageScan = { imports: new Set(stored.imports), stylesheets: stored.stylesheets };
    packageScans.set(directory, scan);
    packageScanStamps.set(directory, stored.paths);
    return scan;
  }
  const scan: PackageScan = { imports: new Set(), stylesheets: false };
  // Each path is stamped before it is read, so a write racing the read invalidates the scan.
  const stamps: Array<PackageScanStamp | undefined> = [];
  const pending = [directory];
  let scanned = 0;
  while (pending.length > 0 && scanned < MAX_SCANNED_FILES) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
    stamps.push(stampScannedPath(directory, current));
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (/\.(?:[cm]?js|jsx)$/.test(entry.name) && scanned++ < MAX_SCANNED_FILES) {
        let code: string;
        stamps.push(stampScannedPath(directory, file));
        try {
          code = fs.readFileSync(file, "utf8");
        } catch {
          continue;
        }
        for (const match of code.matchAll(IMPORT_SPECIFIER)) scan.imports.add(match[1]!);
        if (!scan.stylesheets && STYLESHEET_IMPORT.test(code)) scan.stylesheets = true;
      }
    }
  }
  packageScans.set(directory, scan);
  if (stamps.every((stamp) => stamp !== undefined)) {
    packageScanStamps.set(directory, stamps as PackageScanStamp[]);
    if (packageScanCache) packageScanCache.dirty = true;
  }
  return scan;
}

/**
 * The name of the package `specifier` names, from `importer`, when Node cannot load it the way a
 * bundler does, so a server graph has to bundle it instead of importing it natively; otherwise
 * null. That is a package whose own script files import stylesheets (react-tweet's CSS modules),
 * or one that ships an ES module build only through `module` beside a CommonJS `main`
 * (react-wrap-balancer), whose default export Node would read as the whole CommonJS exports object.
 * A package that defines fonts with `@farm.js/core/font` is bundled too, because its `localFont`
 * calls only work once Farm's font compiler has transformed them.
 */
export function findFarmServerBundledPackage(
  importer: string,
  specifier: string,
): FarmServerBundledPackage | null {
  const parsed = packageNameOf(specifier);
  // Farm's own packages stay external: bundling a second copy of the core would split its
  // module state (route definitions, request context) from the copy the server runtime loads.
  if (!parsed || REACT_PACKAGES.has(parsed.name) || parsed.name.startsWith("@farm.js/")) {
    return null;
  }
  const directory = findPackageDirectory(importer, parsed.name);
  if (!directory) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    if (
      manifest.exports === undefined &&
      manifest.type !== "module" &&
      typeof manifest.module === "string" &&
      typeof manifest.main === "string" &&
      path.resolve(directory, manifest.main) !== path.resolve(directory, manifest.module)
    ) {
      return { name: parsed.name, prebundle: isSelfContainedPackage(manifest, importer) };
    }
  } catch {
    return null;
  }
  const scan = scanPackage(directory);
  if (scan.imports.has(FARM_FONT_MODULE))
    return { name: parsed.name, prebundle: false, fonts: true };
  return scan.stylesheets ? { name: parsed.name, prebundle: false } : null;
}

/**
 * Whether a package's bundle can hold only its own modules: it has no dependencies, and every
 * peer it requires resolves from `importer`, as it will from the bundle Vite writes under the
 * app's `node_modules/.vite`. Under pnpm a package's own dependencies resolve only from its
 * directory, so a bundle that left them as imports could not load them.
 */
function isSelfContainedPackage(
  manifest: {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  },
  importer: string,
): boolean {
  if (Object.keys(manifest.dependencies ?? {}).length > 0) return false;
  return Object.keys(manifest.peerDependencies ?? {}).every(
    (peer) =>
      manifest.peerDependenciesMeta?.[peer]?.optional === true ||
      findPackageDirectory(importer, peer) !== null,
  );
}

/** A package the server graph bundles, and how development serves it. */
export interface FarmServerBundledPackage {
  name: string;
  /**
   * Development pre-bundles it for SSR: its ES module build is only a `module` field beside a
   * CommonJS `main`, it has no dependencies, and the app resolves every peer it requires. A
   * package bundled for its stylesheet imports is never pre-bundled.
   */
  prebundle: boolean;
  /**
   * It defines fonts with `@farm.js/core/font`. No dependency optimizer may bundle it, for the
   * browser either, because only Farm's font compiler can turn its `localFont` calls into fonts.
   */
  fonts?: true;
}

/**
 * The package `specifier` names, from `importer`: its name, and the specifiers of its dependencies
 * that its own files import (`use-sync-external-store/shim`), which a bundler that serves the
 * package unbundled still has to pre-bundle when they are CommonJS.
 */
export function findFarmPackageManifest(
  importer: string,
  specifier: string,
): { name: string; dependencies: string[] } | null {
  const parsed = packageNameOf(specifier);
  if (!parsed) return null;
  const directory = findPackageDirectory(importer, parsed.name);
  if (!directory) return null;
  let names: Set<string>;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    names = new Set(Object.keys(manifest.dependencies ?? {}));
  } catch {
    return null;
  }
  const dependencies = [...scanPackage(directory).imports].filter((imported) => {
    const name = packageNameOf(imported)?.name;
    return name !== undefined && names.has(name);
  });
  return { name: parsed.name, dependencies: dependencies.sort() };
}

/**
 * Every name `specifier`'s default build exports, from `importer`, following `export *` and named
 * re-exports through relative files; null when the entry cannot be read as ES modules (a CommonJS
 * package).
 */
export function listFarmPackageExports(importer: string, specifier: string): string[] | null {
  const entry = resolveFarmPackageDefaultEntry(importer, specifier);
  return entry ? listFarmModuleExports(entry) : null;
}

/**
 * Every name the ES module `entry` exports, following `export *` and named re-exports through
 * relative files; null when it cannot be read as an ES module.
 */
export function listFarmModuleExports(entry: string): string[] | null {
  const names = new Set<string>();
  const seen = new Set<string>();
  const collect = (file: string, depth: number): boolean => {
    if (depth > 8 || seen.has(file)) return true;
    seen.add(file);
    const program = readModule(file);
    if (!program) return false;
    let esm = false;
    for (const node of program.body ?? []) {
      if (node.type === "ExportAllDeclaration" && node.source && !node.exported) {
        esm = true;
        const child = resolveRelative(file, node.source.value);
        if (!child || !collect(child, depth + 1)) return false;
      } else if (node.type === "ExportAllDeclaration" && node.exported) {
        esm = true;
        const name = exportedName(node.exported);
        if (name) names.add(name);
      } else if (node.type === "ExportNamedDeclaration") {
        esm = true;
        for (const specifier of node.specifiers ?? []) {
          const name = exportedName(specifier.exported);
          if (name) names.add(name);
        }
        if (node.declaration?.id?.name) names.add(node.declaration.id.name);
        for (const declarator of node.declaration?.declarations ?? []) {
          if (declarator.id?.type === "Identifier") names.add(declarator.id.name);
        }
      } else if (node.type === "ExportDefaultDeclaration") {
        esm = true;
        names.add("default");
      } else if (node.type === "ImportDeclaration") {
        esm = true;
      }
    }
    return esm || depth > 0;
  };
  if (!collect(entry, 0)) return null;
  return [...names].filter((name) => /^[A-Za-z_$][\w$]*$/.test(name)).sort();
}
