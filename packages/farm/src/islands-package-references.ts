/**
 * Package client components in islands mode. A server component that renders a `"use client"`
 * export of a package (a provider, a Radix part, a toaster) gets a client reference in React Server
 * Components. Islands only hydrate modules of the app, so Farm writes one for each such export: a
 * module under `.farm/client-references/` that re-exports it with `"use client"`. Server modules
 * import that module instead of the package, so the export renders as an island like any local
 * client component: its server children travel as slots, and client components inside them read
 * its context.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseAst } from "rolldown/parseAst";
import {
  isFarmPackageClientExport,
  listFarmModuleExports,
  listFarmPackageExports,
} from "./islands-react-server-exports";

type AstNode = Record<string, any>;

/** A server module's import of a package that is a client boundary. */
export interface FarmPackageClientImport {
  start: number;
  end: number;
  specifier: string;
  /** `import Name from` */
  defaultLocal?: string;
  /** `import { imported as local } from`, or `export { imported as local } from` when `reexport`. */
  named: Array<{ imported: string; local: string }>;
  /** An `export { … } from` declaration: `named` and `kept` are re-exports. */
  reexport?: true;
  /**
   * Bindings the package defines outside any `"use client"` module (`dehydrate`, `QueryClient`),
   * which stay plain imports, as RSC imports them.
   */
  kept: Array<{ imported: string; local: string }>;
  /**
   * `import * as local from`, and the members the module reads from it. `values` are the members
   * that are not client components (`createDialogScope`): it gets them from the package itself,
   * as only components render as islands.
   */
  namespace?: { local: string; members: string[]; values?: string[] };
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The name an import or export specifier binds: an identifier, or a string literal. */
const moduleName = (node: AstNode | undefined): string | null => {
  const name = node?.type === "Identifier" ? node.name : node?.value;
  return typeof name === "string" ? name : null;
};

function parse(code: string, file: string): AstNode | null {
  const extension = path.extname(file).slice(1);
  const lang = extension === "ts" || extension === "mts" || extension === "cts" ? "ts" : "tsx";
  try {
    return parseAst(code, { lang: lang as "tsx" }) as unknown as AstNode;
  } catch {
    return null;
  }
}

function walk(
  node: unknown,
  visit: (node: AstNode, parent: AstNode | null) => void,
  parent: AstNode | null = null,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent);
    return;
  }
  const current = node as AstNode;
  if (typeof current.type !== "string") return;
  visit(current, parent);
  for (const [key, value] of Object.entries(current)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (value && typeof value === "object") walk(value, visit, current);
  }
}

/**
 * The members a module reads from a namespace import, or null when it uses the namespace as a
 * value (passes it around), which a set of re-exports cannot stand for.
 */
function namespaceMembers(program: AstNode, local: string, declaration: AstNode): string[] | null {
  const members = new Set<string>();
  let opaque = false;
  walk(program, (node, parent) => {
    if (opaque || node === declaration) return;
    const name = node.type === "Identifier" || node.type === "JSXIdentifier" ? node.name : null;
    if (name !== local) return;
    if (parent?.type === "ImportNamespaceSpecifier") return;
    const member =
      (parent?.type === "MemberExpression" || parent?.type === "JSXMemberExpression") &&
      parent.object === node
        ? parent.property
        : null;
    const property =
      member &&
      !parent!.computed &&
      (member.type === "Identifier" || member.type === "JSXIdentifier")
        ? (member.name as string)
        : null;
    if (property) members.add(property);
    else opaque = true;
  });
  return opaque ? null : [...members];
}

/** The imports in `code` of packages `isClientPackage` names. Type-only imports are skipped. */
export function findFarmPackageClientImports(
  code: string,
  file: string,
  isClientPackage: (specifier: string) => boolean,
): FarmPackageClientImport[] {
  if (!code.includes("import") && !code.includes("export")) return [];
  const program = parse(code, file);
  if (!program) return [];
  const found: FarmPackageClientImport[] = [];
  for (const node of program.body ?? []) {
    const reexport = node.type === "ExportNamedDeclaration" && node.source != null;
    if (node.type !== "ImportDeclaration" && !reexport) continue;
    if (node.importKind === "type" || node.exportKind === "type") continue;
    const specifier = node.source?.value;
    if (typeof specifier !== "string" || specifier.startsWith(".") || specifier.startsWith("/"))
      continue;
    const specifiers: AstNode[] = (node.specifiers ?? []).filter(
      (entry: AstNode) => entry.importKind !== "type" && entry.exportKind !== "type",
    );
    if (specifiers.length === 0 || !isClientPackage(specifier)) continue;
    const entry: FarmPackageClientImport = {
      start: node.start,
      end: node.end,
      specifier,
      named: [],
      kept: [],
      ...(reexport ? { reexport: true as const } : {}),
    };
    const client = (name: string) => isFarmPackageClientExport(file, specifier, name);
    let supported = true;
    for (const binding of specifiers) {
      if (binding.type === "ExportSpecifier") {
        const imported = moduleName(binding.local);
        const exported = moduleName(binding.exported);
        if (!imported || !exported || !IDENTIFIER.test(imported) || !IDENTIFIER.test(exported))
          supported = false;
        else if (client(imported)) entry.named.push({ imported, local: exported });
        else entry.kept.push({ imported, local: exported });
      } else if (binding.type === "ImportDefaultSpecifier") {
        if (client("default")) entry.defaultLocal = binding.local.name;
        else entry.kept.push({ imported: "default", local: binding.local.name });
      } else if (binding.type === "ImportNamespaceSpecifier") {
        const read = namespaceMembers(program, binding.local.name, node);
        // A namespace the module passes around as a value stands for every export.
        const members = read ?? listFarmPackageExports(file, specifier);
        if (!members || members.some((member) => !IDENTIFIER.test(member))) {
          supported = false;
          continue;
        }
        const reference = (name: string) =>
          client(name) && (read !== null || name === "default" || /^[A-Z]/.test(name));
        const values = members.filter((name) => !reference(name));
        entry.namespace = {
          local: binding.local.name,
          members: members.filter(reference),
          ...(values.length > 0 ? { values } : {}),
        };
      } else {
        const imported = moduleName(binding.imported);
        if (!imported || !IDENTIFIER.test(imported)) supported = false;
        else if (client(imported)) entry.named.push({ imported, local: binding.local.name });
        else entry.kept.push({ imported, local: binding.local.name });
      }
    }
    if (supported) found.push(entry);
  }
  return found;
}

/** The export names an import reads from its package. */
export function farmPackageClientImportExports(entry: FarmPackageClientImport): string[] {
  return [
    ...(entry.defaultLocal ? ["default"] : []),
    ...entry.named.map((binding) => binding.imported),
    ...(entry.namespace?.members ?? []),
  ];
}

/**
 * The line that marks a generated client reference module. Every export of such a module is a
 * client component, whatever its name (`motion.div` is a `div` export).
 */
export const FARM_CLIENT_REFERENCE_PRAGMA = "// @farm-client-reference";

/** The module path segment of generated client references. */
export const FARM_CLIENT_REFERENCE_DIRECTORY = "/.farm/client-references/";

/**
 * The prefix of an import a client reference resolves from another directory than its own:
 * `farm:resolve-from:<directory>:<specifier>`, the directory URI-encoded and relative to the
 * reference. `farm:server-only-entries` resolves it, as the importer of the package would.
 */
export const FARM_RESOLVE_FROM_PREFIX = "farm:resolve-from:";

/**
 * The specifier and stand-in importer (a file in the directory it names) of a
 * `farm:resolve-from:` import in `importer`, or null for any other import.
 */
export function parseFarmResolveFrom(
  id: string,
  importer: string,
): { specifier: string; importer: string } | null {
  if (!id.startsWith(FARM_RESOLVE_FROM_PREFIX)) return null;
  const rest = id.slice(FARM_RESOLVE_FROM_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  const directory = path.resolve(
    path.dirname(importer),
    decodeURIComponent(rest.slice(0, separator)),
  );
  return {
    specifier: rest.slice(separator + 1),
    importer: path.join(directory, "__farm_client_reference__.js"),
  };
}

/** Where the client reference for `specifier`'s `exportName` lives. */
export function farmPackageClientReferencePath(
  root: string,
  specifier: string,
  exportName: string,
  scope?: string,
): string {
  const directory = specifier.replace(/^@/, "").replace(/[^A-Za-z0-9._-]/g, "+");
  return path.join(
    root,
    ".farm",
    "client-references",
    directory,
    ...(scope ? [scope] : []),
    `${exportName}.tsx`,
  );
}

/** The package a bare specifier names: `@scope/name` or `name`. */
function specifierPackage(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/**
 * The directory whose `node_modules` holds `packageName` for code in `directory`, and the package's
 * real path, as Node resolves it; null when no `node_modules` above holds it.
 */
function packageLookup(
  directory: string,
  packageName: string,
): { from: string; real: string } | null {
  for (let current = directory; ; current = path.dirname(current)) {
    if (path.basename(current) !== "node_modules") {
      const candidate = path.join(current, "node_modules", packageName);
      try {
        return { from: current, real: fs.realpathSync(candidate) };
      } catch {
        // Not installed here.
      }
    }
    if (path.dirname(current) === current) return null;
  }
}

/**
 * Where a client reference written for `importer` resolves `specifier` from: null when the app root
 * resolves it to the same package as the importer, as in a single app; otherwise the directory
 * whose `node_modules` holds the importer's copy, as in a pnpm monorepo, where a workspace package's
 * dependency is not the app's.
 */
function referenceResolveFrom(root: string, specifier: string, importer: string): string | null {
  const packageName = specifierPackage(specifier);
  const own = packageLookup(path.dirname(importer), packageName);
  if (!own) return null;
  const app = packageLookup(path.join(root, ".farm", "client-references"), packageName);
  if (app?.real === own.real) return null;
  // The importer's real directory, so a module reached through a link and through its own path
  // gets one reference.
  try {
    return fs.realpathSync(own.from);
  } catch {
    return own.from;
  }
}

/**
 * Writes the client reference for `specifier`'s `exportName` (unchanged files stay as they are).
 * `importer`, the module that imports it, decides which installed copy of the package the reference
 * imports: the one the importer resolves.
 */
export function ensureFarmPackageClientReference(
  root: string,
  specifier: string,
  exportName: string,
  importer?: string,
): string {
  const resolveFrom = importer ? referenceResolveFrom(root, specifier, importer) : null;
  const scope = resolveFrom
    ? `__from__${createHash("sha256")
        .update(path.relative(root, resolveFrom).split(path.sep).join("/"))
        .digest("hex")
        .slice(0, 8)}`
    : undefined;
  const file = farmPackageClientReferencePath(root, specifier, exportName, scope);
  const target = JSON.stringify(
    resolveFrom
      ? `${FARM_RESOLVE_FROM_PREFIX}${encodeURIComponent(
          path.relative(path.dirname(file), resolveFrom).split(path.sep).join("/"),
        )}:${specifier}`
      : specifier,
  );
  const source = [
    `// Generated by Farm: ${specifier}'s ${exportName} export, as a client reference for server components.`,
    FARM_CLIENT_REFERENCE_PRAGMA,
    '"use client";',
    // An import, not `export { name } from`: a server graph applies CommonJS interop to imports
    // (react-wrap-balancer's `main` is CommonJS), not to re-exports.
    exportName === "default"
      ? `import __farm_reference__ from ${target};`
      : `import { ${exportName} as __farm_reference__ } from ${target};`,
    `export { __farm_reference__ as ${exportName} };`,
    "",
  ].join("\n");
  let current: string | null = null;
  try {
    current = fs.readFileSync(file, "utf8");
  } catch {
    // Not written yet.
  }
  if (current !== source) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return file;
}

function writeIfChanged(file: string, source: string): void {
  let current: string | null = null;
  try {
    current = fs.readFileSync(file, "utf8");
  } catch {
    // Not written yet.
  }
  if (current !== source) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
}

/** The package directory (nearest `package.json` with a name) that holds `file`. */
function owningPackage(file: string): { directory: string; name: string } | null {
  for (let current = path.dirname(file); ; current = path.dirname(current)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(current, "package.json"), "utf8"));
      if (typeof manifest.name === "string") return { directory: current, name: manifest.name };
    } catch {
      // No manifest here.
    }
    if (path.dirname(current) === current) return null;
  }
}

/**
 * Writes the client reference for a `"use client"` module inside a package, which the package's
 * `react-server` build imports by relative path (react-tweet's video player), and returns its path;
 * null when the module's exports cannot be read. The reference imports the file itself, as the
 * package's `exports` do not name it. Its path carries a hash of the package directory, so two
 * installed versions of one package get two references.
 */
export function ensureFarmInternalClientReference(root: string, clientFile: string): string | null {
  const owner = owningPackage(clientFile);
  const names = listFarmModuleExports(clientFile);
  if (!owner || !names || names.length === 0) return null;
  const directory = owner.name.replace(/^@/, "").replace(/[^A-Za-z0-9._-]/g, "+");
  const hash = createHash("sha256").update(owner.directory).digest("hex").slice(0, 8);
  const relative = path
    .relative(owner.directory, clientFile)
    .split(path.sep)
    .join("+")
    .replace(/[^A-Za-z0-9._+-]/g, "_");
  const file = path.join(
    root,
    ".farm",
    "client-references",
    directory,
    `__internal__${hash}`,
    `${relative}.tsx`,
  );
  const target = JSON.stringify(clientFile);
  const lines = [
    `// Generated by Farm: ${owner.name}'s ${path.relative(owner.directory, clientFile).split(path.sep).join("/")}, as a client reference for server components.`,
    FARM_CLIENT_REFERENCE_PRAGMA,
    '"use client";',
  ];
  const exported: string[] = [];
  names.forEach((name, index) => {
    const local = `__farm_reference_${index}__`;
    lines.push(
      name === "default"
        ? `import ${local} from ${target};`
        : `import { ${name} as ${local} } from ${target};`,
    );
    exported.push(`${local} as ${name}`);
  });
  lines.push(`export { ${exported.join(", ")} };`, "");
  writeIfChanged(file, lines.join("\n"));
  return file;
}

/**
 * A server module with its package client imports pointed at their client references (written
 * here), or null when it has none.
 */
export function rewriteFarmPackageClientImports(options: {
  code: string;
  file: string;
  root: string;
  isClientPackage(specifier: string): boolean;
}): string | null {
  const imports = findFarmPackageClientImports(options.code, options.file, options.isClientPackage);
  if (imports.length === 0) return null;
  const reference = (specifier: string, exportName: string) =>
    JSON.stringify(
      ensureFarmPackageClientReference(options.root, specifier, exportName, options.file),
    );
  let output = options.code;
  let next = 0;
  let changed = false;
  for (const entry of [...imports].sort((left, right) => right.start - left.start)) {
    // An import of server exports only stays as it is.
    if (farmPackageClientImportExports(entry).length === 0) continue;
    changed = true;
    const keyword = entry.reexport ? "export" : "import";
    const lines: string[] = [];
    if (entry.kept.length > 0) {
      const bindings = entry.kept.map((binding) => `${binding.imported} as ${binding.local}`);
      lines.push(`${keyword} { ${bindings.join(", ")} } from ${JSON.stringify(entry.specifier)};`);
    }
    if (entry.defaultLocal) {
      lines.push(`import ${entry.defaultLocal} from ${reference(entry.specifier, "default")};`);
    }
    for (const binding of entry.named) {
      lines.push(
        `${keyword} { ${binding.imported} as ${binding.local} } from ${reference(entry.specifier, binding.imported)};`,
      );
    }
    if (entry.namespace) {
      const fields: string[] = [];
      for (const member of entry.namespace.members) {
        const local = `__farm_package_reference_${next++}__`;
        lines.push(`import { ${member} as ${local} } from ${reference(entry.specifier, member)};`);
        fields.push(`${member}: ${local}`);
      }
      if (entry.namespace.values?.length) {
        const local = `__farm_package_values_${next++}__`;
        lines.push(`import * as ${local} from ${JSON.stringify(entry.specifier)};`);
        for (const value of entry.namespace.values) fields.push(`${value}: ${local}.${value}`);
      }
      lines.push(`const ${entry.namespace.local} = Object.freeze({ ${fields.join(", ")} });`);
    }
    output = output.slice(0, entry.start) + lines.join("\n") + output.slice(entry.end);
  }
  return changed ? output : null;
}
