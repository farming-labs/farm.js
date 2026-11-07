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

function readModule(file: string): AstNode | null {
  try {
    const code = fs.readFileSync(file, "utf8");
    const extension = path.extname(file).slice(1);
    const lang = extension === "ts" || extension === "mts" || extension === "cts" ? "ts" : "tsx";
    return parseAst(code, { lang: lang as "tsx" }) as unknown as AstNode;
  } catch {
    return null;
  }
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

/**
 * Whether `name`, as `file` exports it, comes from a `"use client"` module: the export follows
 * re-exports (`export { x } from`, `export * from`) through relative files.
 */
export function isFarmClientExport(file: string, name: string, depth = 0): boolean {
  if (depth > 6) return false;
  const program = readModule(file);
  if (!program) return false;
  if (isClientModule(program)) return true;
  const stars: string[] = [];
  for (const node of program.body ?? []) {
    if (node.type === "ExportNamedDeclaration" && node.source) {
      for (const specifier of node.specifiers ?? []) {
        if (exportedName(specifier.exported) !== name) continue;
        const target = resolveRelative(file, node.source.value);
        return target
          ? isFarmClientExport(target, exportedName(specifier.local) ?? name, depth + 1)
          : false;
      }
    } else if (node.type === "ExportAllDeclaration" && node.source && !node.exported) {
      stars.push(node.source.value);
    } else if (node.type === "ExportNamedDeclaration" && !node.source) {
      const names = [
        ...(node.specifiers ?? []).map((specifier: AstNode) => exportedName(specifier.exported)),
        ...(node.declaration?.id ? [node.declaration.id.name] : []),
        ...(node.declaration?.declarations ?? []).map((declarator: AstNode) => declarator.id?.name),
      ];
      if (names.includes(name)) return false;
    } else if (node.type === "ExportDefaultDeclaration" && name === "default") {
      return false;
    }
  }
  for (const source of stars) {
    const target = resolveRelative(file, source);
    if (target && isFarmClientExport(target, name, depth + 1)) return true;
  }
  return false;
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
 * Whether `specifier`'s `react-server` build, from `importer`, re-exports a `"use client"` module.
 * React Server Components' dev server loads that module straight from the package for the browser,
 * so the same package pre-bundled by Vite would be a second copy (two React contexts).
 */
export function farmReactServerBuildReachesClientModules(
  importer: string,
  specifier: string,
): boolean {
  const target = resolveFarmReactServerExport(importer, specifier);
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
const MAX_SCANNED_FILES = 2000;

/** The bare specifiers the script files under `directory` import, skipping nested packages. */
function packageImportSpecifiers(directory: string): Set<string> {
  const found = new Set<string>();
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
      else if (/\.(?:m?js|jsx)$/.test(entry.name) && scanned++ < MAX_SCANNED_FILES) {
        let code: string;
        try {
          code = fs.readFileSync(file, "utf8");
        } catch {
          continue;
        }
        for (const match of code.matchAll(IMPORT_SPECIFIER)) found.add(match[1]!);
      }
    }
  }
  return found;
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
  const dependencies = [...packageImportSpecifiers(directory)].filter((imported) => {
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
  const parsed = packageNameOf(specifier);
  if (!parsed) return null;
  const directory = findPackageDirectory(importer, parsed.name);
  if (!directory) return null;
  let entry: string | null = null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    const target =
      pickTarget(exportEntry(manifest.exports, parsed.subpath), [
        "browser",
        ...DEFAULT_CONDITIONS,
      ]) ?? (!parsed.subpath ? (manifest.module ?? manifest.main ?? "index.js") : parsed.subpath);
    entry = resolveRelative(
      path.join(directory, "package.json"),
      `./${String(target).replace(/^\.\//, "")}`,
    );
  } catch {
    return null;
  }
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
