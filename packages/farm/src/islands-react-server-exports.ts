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

const parsedModules = new Map<string, { size: number; mtimeMs: number; program: AstNode | null }>();

/** `file` parsed, once per version of it: tracing reads the same package files for every import. */
function readModule(file: string): AstNode | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = parsedModules.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.program;
  let program: AstNode | null = null;
  try {
    const code = fs.readFileSync(file, "utf8");
    const extension = path.extname(file).slice(1);
    const lang = extension === "ts" || extension === "mts" || extension === "cts" ? "ts" : "tsx";
    program = parseAst(code, { lang: lang as "tsx" }) as unknown as AstNode;
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

/**
 * Where `name`, as `file` exports it, comes from: `"client"` for a `"use client"` module,
 * `"server"` for any other module that defines it, undefined when that cannot be told (not found,
 * CommonJS, too deep). Follows re-exports (`export { x } from`, `export * from`) and local names
 * bound by imports (`import { x } from "./x.js"; export { x }`), through relative files and
 * packages.
 */
export function traceFarmExport(
  file: string,
  name: string,
  depth = 0,
): "client" | "server" | undefined {
  if (depth > 8) return undefined;
  const program = readModule(file);
  if (!program) return undefined;
  if (isClientModule(program)) return "client";
  const follow = (source: string, imported: string) => {
    const target = resolveSource(file, source);
    return target ? traceFarmExport(target, imported, depth + 1) : undefined;
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
    return binding ? follow(binding.source, binding.imported) : "server";
  };
  const stars: string[] = [];
  for (const node of program.body ?? []) {
    if (node.type === "ExportNamedDeclaration" && node.source) {
      for (const specifier of node.specifiers ?? []) {
        if (exportedName(specifier.exported) !== name) continue;
        return follow(node.source.value, exportedName(specifier.local) ?? name);
      }
    } else if (node.type === "ExportAllDeclaration" && node.source && !node.exported) {
      stars.push(node.source.value);
    } else if (node.type === "ExportNamedDeclaration" && !node.source) {
      for (const specifier of node.specifiers ?? []) {
        if (exportedName(specifier.exported) === name) {
          return local(exportedName(specifier.local) ?? name);
        }
      }
      const declared = [
        ...(node.declaration?.id ? [node.declaration.id.name] : []),
        ...(node.declaration?.declarations ?? []).map((declarator: AstNode) => declarator.id?.name),
      ];
      if (declared.includes(name)) return "server";
    } else if (node.type === "ExportDefaultDeclaration" && name === "default") {
      return node.declaration?.type === "Identifier" ? local(node.declaration.name) : "server";
    }
  }
  for (const source of stars) {
    const traced = follow(source, name);
    if (traced) return traced;
  }
  return undefined;
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
  const entry = resolveFarmPackageDefaultEntry(importer, specifier);
  return !entry || traceFarmExport(entry, name) !== "server";
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
  const extension = path.extname(file).slice(1);
  const lang = extension === "ts" || extension === "mts" || extension === "cts" ? "ts" : "tsx";
  try {
    return parseAst(code, { lang: lang as "tsx" }) as unknown as AstNode;
  } catch {
    return null;
  }
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

function walkToClientOnly(file: string, seen: Set<string>): string[] | null {
  if (seen.has(file) || clientOnlyFreeFiles.has(file)) return null;
  seen.add(file);
  const program = readModule(file);
  // `"use client"` is the boundary: what it imports is client code.
  if (!program || isClientModule(program)) return null;
  for (const source of staticImportSources(program)) {
    if (source === CLIENT_ONLY_PACKAGE) return [file];
    const child = source.startsWith(".")
      ? resolveRelative(file, source)
      : resolveServerEntry(file, source);
    const chain = child && walkToClientOnly(child, seen);
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
  const program = parseCode(code, file);
  if (!program) return null;
  for (const specifier of staticImportSources(program)) {
    const entry = resolveServerEntry(file, specifier);
    if (!entry) continue;
    const seen = new Set<string>();
    const chain = walkToClientOnly(entry, seen);
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

interface PackageScan {
  /** The bare specifiers its script files import. */
  imports: Set<string>;
  /** Whether a script file imports a stylesheet, which Node cannot load. */
  stylesheets: boolean;
}

const packageScans = new Map<string, PackageScan>();

/** The script files under `directory`, read once, skipping nested packages. */
function scanPackage(directory: string): PackageScan {
  const cached = packageScans.get(directory);
  if (cached) return cached;
  const scan: PackageScan = { imports: new Set(), stylesheets: false };
  const pending = [directory];
  let scanned = 0;
  while (pending.length > 0 && scanned < MAX_SCANNED_FILES) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
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
  return scan;
}

/**
 * The name of the package `specifier` names, from `importer`, when Node cannot load it the way a
 * bundler does, so a server graph has to bundle it instead of importing it natively; otherwise
 * null. That is a package whose own script files import stylesheets (react-tweet's CSS modules),
 * or one that ships an ES module build only through `module` beside a CommonJS `main`
 * (react-wrap-balancer), whose default export Node would read as the whole CommonJS exports object.
 */
export function findFarmServerBundledPackage(importer: string, specifier: string): string | null {
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
      return parsed.name;
    }
  } catch {
    return null;
  }
  return scanPackage(directory).stylesheets ? parsed.name : null;
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
  if (!entry) return null;
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
