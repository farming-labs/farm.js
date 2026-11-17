/**
 * Islands mode (RFC 0007): a client navigation leaves out the layouts the browser keeps, but the
 * server still renders them, because a layout can be a guard (`redirect()`, `notFound()`, an auth
 * check) and the browser chooses which layouts it says it keeps. A layout whose code cannot throw
 * or read per-request state cannot decide a request, so rendering it again only produces markup
 * nobody receives. This module proves that over the layout's module graph, and fails closed: any
 * module, import or construct it does not recognize keeps the layout rendering.
 */
import fs from "node:fs";
import path from "node:path";
import { parseAst } from "rolldown/parseAst";
import { resolveImportedModule, resolveModuleSourcePath } from "./utils/client-component";
import {
  getFarmSourceStamp,
  memoizeInFarmSourceSnapshot,
  noteFarmSourceRead,
  traceFarmSourceReads,
} from "./utils/source-snapshot";

type AstNode = Record<string, any>;

const SCRIPT_SOURCE = /\.[cm]?[jt]sx?$/;
const ASSET_SOURCE =
  /\.(?:css|scss|sass|less|styl|stylus|pcss|postcss|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/;

/**
 * Packages a layout may import, with the value bindings it may take from each (`*` for any).
 * They do no I/O and do not read the request. Everything else, an auth SDK, a database client, an
 * integration package or an unknown module, keeps the layout rendering.
 */
const PURE_PACKAGE_IMPORTS: ReadonlyMap<string, ReadonlySet<string> | "*"> = new Map<
  string,
  ReadonlySet<string> | "*"
>([
  ["react", "*"],
  ["react/jsx-runtime", "*"],
  ["react/jsx-dev-runtime", "*"],
  ["@farm.js/core/client", new Set(["Link"])],
]);

/** Globals whose value differs between requests or reaches outside the render. */
const IMPURE_GLOBALS = new Set([
  "process",
  "globalThis",
  "global",
  "window",
  "self",
  "Date",
  "crypto",
  "fetch",
  "require",
  "eval",
  "Function",
  "performance",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "AsyncLocalStorage",
]);

/** Top-level statements that only declare: evaluating them changes nothing between requests. */
const DECLARATION_STATEMENTS = new Set([
  "ImportDeclaration",
  "FunctionDeclaration",
  "VariableDeclaration",
  "ClassDeclaration",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSDeclareFunction",
  "EmptyStatement",
]);

function parse(code: string, file: string): AstNode | null {
  const extension = path.extname(file).slice(1);
  const lang =
    extension === "ts" || extension === "mts" || extension === "cts"
      ? "ts"
      : extension === "js" || extension === "mjs" || extension === "cjs" || extension === "jsx"
        ? "jsx"
        : "tsx";
  return memoizeInFarmSourceSnapshot(`ast:${lang}`, code, () => {
    try {
      return parseAst(code, { lang: lang as "tsx" }) as unknown as AstNode;
    } catch {
      return null;
    }
  });
}

interface ModuleImport {
  source: string;
  /** The value bindings taken (`*` for a namespace or a re-export of everything). */
  names: string[];
}

/**
 * Why `code` could decide a request on its own, or null when nothing in it can. Also returns the
 * imports to follow.
 */
export function findFarmRequestDecidingConstruct(
  code: string,
  file: string,
): { reason: string | null; imports: ModuleImport[] } {
  const program = parse(code, file);
  if (!program) return { reason: "the module does not parse", imports: [] };
  const imports: ModuleImport[] = [];
  let reason: string | null = null;

  for (const statement of program.body as AstNode[]) {
    if (statement.type === "ImportDeclaration") {
      if (statement.importKind === "type") continue;
      const names: string[] = [];
      for (const specifier of statement.specifiers ?? []) {
        if (specifier.importKind === "type") continue;
        if (specifier.type === "ImportSpecifier") {
          names.push(specifier.imported.name ?? specifier.imported.value);
        } else if (specifier.type === "ImportDefaultSpecifier") names.push("default");
        else names.push("*");
      }
      // `import "x"` runs the module for its effects, a stylesheet among them.
      if ((statement.specifiers ?? []).length === 0 || names.length > 0) {
        imports.push({ source: statement.source.value, names });
      }
      continue;
    }
    if (statement.type === "ExportAllDeclaration") {
      if (statement.exportKind !== "type")
        imports.push({ source: statement.source.value, names: ["*"] });
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      if (statement.source && statement.exportKind !== "type") {
        imports.push({
          source: statement.source.value,
          names: (statement.specifiers ?? [])
            .filter((specifier: AstNode) => specifier.exportKind !== "type")
            .map((specifier: AstNode) => specifier.local.name ?? specifier.local.value),
        });
      }
      continue;
    }
    if (statement.type === "ExportDefaultDeclaration") continue;
    if (statement.type === "ExpressionStatement" && typeof statement.directive === "string") {
      continue;
    }
    if (!DECLARATION_STATEMENTS.has(statement.type)) {
      reason ??= `a top-level ${statement.type}`;
    }
  }

  const visit = (node: unknown, parent: AstNode | null, key: string): void => {
    if (reason || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent, key);
      return;
    }
    const current = node as AstNode;
    if (typeof current.type !== "string") return;
    switch (current.type) {
      case "ThrowStatement":
        reason = "a throw statement";
        return;
      case "AwaitExpression":
        reason = "an await expression";
        return;
      case "YieldExpression":
        reason = "a generator";
        return;
      case "ImportExpression":
        reason = "a dynamic import()";
        return;
      case "ForOfStatement":
        if (current.await) {
          reason = "a for await loop";
          return;
        }
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (current.async || current.generator) {
          reason = current.async ? "an async function" : "a generator";
          return;
        }
        break;
      case "MetaProperty":
        reason = "import.meta";
        return;
      case "CallExpression":
        if (current.callee?.type === "Identifier" && current.callee.name === "use") {
          reason = "a use() call";
          return;
        }
        if (
          current.callee?.type === "MemberExpression" &&
          !current.callee.computed &&
          current.callee.object?.type === "Identifier" &&
          current.callee.object.name === "Math" &&
          current.callee.property?.name === "random"
        ) {
          reason = "Math.random()";
          return;
        }
        break;
      case "Identifier":
        if (IMPURE_GLOBALS.has(current.name) && isReference(current, parent, key)) {
          reason = `the global ${current.name}`;
          return;
        }
        break;
    }
    for (const [childKey, value] of Object.entries(current)) {
      if (
        childKey === "start" ||
        childKey === "end" ||
        childKey === "loc" ||
        childKey === "range"
      ) {
        continue;
      }
      if (value && typeof value === "object") visit(value, current, childKey);
    }
  };
  // Imports are not references to globals; skip their specifiers.
  for (const statement of program.body as AstNode[]) {
    if (statement.type === "ImportDeclaration") continue;
    visit(statement, program, "body");
    if (reason) break;
  }
  return { reason, imports };
}

/**
 * Whether `node`, an identifier under `parent[key]`, reads a variable (not a property name, an
 * object key, a declaration or a type). A local shadowing a global name also counts, which only
 * keeps a layout rendering.
 */
function isReference(node: AstNode, parent: AstNode | null, key: string): boolean {
  if (!parent) return true;
  if (parent.type === "MemberExpression" && key === "property" && !parent.computed) return false;
  if ((parent.type === "Property" || parent.type === "MethodDefinition") && key === "key") {
    return Boolean(parent.computed);
  }
  if (parent.type === "PropertyDefinition" && key === "key") return Boolean(parent.computed);
  if (parent.type.startsWith("TS")) return false;
  if (parent.type === "JSXAttribute" || parent.type.startsWith("JSX")) return false;
  if (parent.type === "LabeledStatement" || parent.type === "BreakStatement") return false;
  if (parent.type === "ContinueStatement") return false;
  return true;
}

function readSource(file: string): string | null {
  try {
    noteFarmSourceRead(file);
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Why the layout at `modulePath` could decide a request, or null when the build proves it
 * cannot: no module in its graph throws, awaits, reads a request API or per-request global, or
 * imports a package outside {@link PURE_PACKAGE_IMPORTS}.
 */
export function explainFarmKeptLayoutRender(modulePath: string, root: string): string | null {
  const entry = resolveModuleSourcePath(modulePath, root);
  if (!entry) return `${modulePath} does not resolve`;
  const visited = new Set<string>();
  const check = (file: string): string | null => {
    if (visited.has(file)) return null;
    visited.add(file);
    if (ASSET_SOURCE.test(file)) return null;
    if (!SCRIPT_SOURCE.test(file)) return `${path.relative(root, file)} is not a script`;
    const code = readSource(file);
    if (code === null) return `${path.relative(root, file)} cannot be read`;
    const { reason, imports } = memoizeInFarmSourceSnapshot("kept-layout-module", code, () =>
      findFarmRequestDecidingConstruct(code, file),
    );
    if (reason) return `${path.relative(root, file)} has ${reason}`;
    for (const imported of imports) {
      const allowed = PURE_PACKAGE_IMPORTS.get(imported.source);
      if (allowed) {
        if (allowed === "*" || imported.names.every((name) => allowed.has(name))) continue;
        return `${path.relative(root, file)} imports ${imported.names.join(", ")} from ${imported.source}`;
      }
      if (ASSET_SOURCE.test(imported.source.split("?")[0]!)) continue;
      const resolved = resolveImportedModule(file, imported.source, root);
      if (!resolved.path || !resolved.local) {
        return `${path.relative(root, file)} imports ${imported.source}`;
      }
      const nested = check(resolved.path);
      if (nested) return nested;
    }
    return null;
  };
  return check(entry);
}

// Answers by layout, with the size and mtime of every file the answer read: `farm dev` asks on
// each navigation, and an edit to any of those files asks again.
const answers = new Map<string, { skip: boolean; stamps: Array<[string, string]> }>();

/** Whether a kept layout at `modulePath` can skip its guard render (RFC 0007). */
export function canFarmSkipKeptLayoutRender(modulePath: string, root: string): boolean {
  const key = `${root}\0${modulePath}`;
  const known = answers.get(key);
  if (known && known.stamps.every(([file, stamp]) => getFarmSourceStamp(file) === stamp)) {
    return known.skip;
  }
  const { result, files } = traceFarmSourceReads(
    () => explainFarmKeptLayoutRender(modulePath, root) === null,
  );
  answers.set(key, {
    skip: result,
    stamps: files.map((file) => [file, getFarmSourceStamp(file)]),
  });
  return result;
}
