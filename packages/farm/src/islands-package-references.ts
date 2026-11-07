/**
 * Package client components in islands mode. A server component that renders a `"use client"`
 * export of a package (a provider, a Radix part, a toaster) gets a client reference in React Server
 * Components. Islands only hydrate modules of the app, so Farm writes one for each such export: a
 * module under `.farm/client-references/` that re-exports it with `"use client"`. Server modules
 * import that module instead of the package, so the export renders as an island like any local
 * client component: its server children travel as slots, and client components inside them read
 * its context.
 */
import fs from "node:fs";
import path from "node:path";
import { parseAst } from "rolldown/parseAst";

type AstNode = Record<string, any>;

/** A server module's import of a package that is a client boundary. */
export interface FarmPackageClientImport {
  start: number;
  end: number;
  specifier: string;
  /** `import Name from` */
  defaultLocal?: string;
  /** `import { imported as local } from` */
  named: Array<{ imported: string; local: string }>;
  /** `import * as local from`, and the members the module reads from it. */
  namespace?: { local: string; members: string[] };
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

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
  if (!code.includes("import")) return [];
  const program = parse(code, file);
  if (!program) return [];
  const found: FarmPackageClientImport[] = [];
  for (const node of program.body ?? []) {
    if (node.type !== "ImportDeclaration" || node.importKind === "type") continue;
    const specifier = node.source?.value;
    if (typeof specifier !== "string" || specifier.startsWith(".") || specifier.startsWith("/"))
      continue;
    const specifiers: AstNode[] = (node.specifiers ?? []).filter(
      (entry: AstNode) => entry.importKind !== "type",
    );
    if (specifiers.length === 0 || !isClientPackage(specifier)) continue;
    const entry: FarmPackageClientImport = {
      start: node.start,
      end: node.end,
      specifier,
      named: [],
    };
    let supported = true;
    for (const binding of specifiers) {
      if (binding.type === "ImportDefaultSpecifier") entry.defaultLocal = binding.local.name;
      else if (binding.type === "ImportNamespaceSpecifier") {
        const members = namespaceMembers(program, binding.local.name, node);
        if (!members || members.some((member) => !IDENTIFIER.test(member))) supported = false;
        else entry.namespace = { local: binding.local.name, members };
      } else {
        const imported =
          binding.imported?.type === "Identifier" ? binding.imported.name : binding.imported?.value;
        if (typeof imported !== "string" || !IDENTIFIER.test(imported)) supported = false;
        else entry.named.push({ imported, local: binding.local.name });
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

/** Where the client reference for `specifier`'s `exportName` lives. */
export function farmPackageClientReferencePath(
  root: string,
  specifier: string,
  exportName: string,
): string {
  const directory = specifier.replace(/^@/, "").replace(/[^A-Za-z0-9._-]/g, "+");
  return path.join(root, ".farm", "client-references", directory, `${exportName}.tsx`);
}

/** Writes the client reference for `specifier`'s `exportName` (unchanged files stay as they are). */
export function ensureFarmPackageClientReference(
  root: string,
  specifier: string,
  exportName: string,
): string {
  const file = farmPackageClientReferencePath(root, specifier, exportName);
  const source = [
    `// Generated by Farm: ${specifier}'s ${exportName} export, as a client reference for server components.`,
    '"use client";',
    `export { ${exportName} } from ${JSON.stringify(specifier)};`,
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
    JSON.stringify(ensureFarmPackageClientReference(options.root, specifier, exportName));
  let output = options.code;
  let next = 0;
  for (const entry of [...imports].sort((left, right) => right.start - left.start)) {
    const lines: string[] = [];
    if (entry.defaultLocal) {
      lines.push(`import ${entry.defaultLocal} from ${reference(entry.specifier, "default")};`);
    }
    for (const binding of entry.named) {
      lines.push(
        `import { ${binding.imported} as ${binding.local} } from ${reference(entry.specifier, binding.imported)};`,
      );
    }
    if (entry.namespace) {
      const fields: string[] = [];
      for (const member of entry.namespace.members) {
        const local = `__farm_package_reference_${next++}__`;
        lines.push(`import { ${member} as ${local} } from ${reference(entry.specifier, member)};`);
        fields.push(`${member}: ${local}`);
      }
      lines.push(`const ${entry.namespace.local} = Object.freeze({ ${fields.join(", ")} });`);
    }
    output = output.slice(0, entry.start) + lines.join("\n") + output.slice(entry.end);
  }
  return output;
}
