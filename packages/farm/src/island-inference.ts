import fs from "node:fs";
import path from "node:path";
import { parseAst } from "rolldown/parseAst";
import type { FarmIslandStrategy } from "./island";
import { routeBoundaryCoversDirectory } from "./routing/route-groups";
import {
  collectFarmRenderedClientModules,
  getIslandStrategyExport,
  resolveImportedModule,
} from "./utils/client-component";

/**
 * Islands mode: the hydration an island gets when its module sets no `island` export (RFC 0003,
 * section 11). An island whose client code does nothing until it is clicked renders the same before
 * and after hydration, so it waits for an interaction: the click (or submit) is held and replayed
 * once it hydrates, and a press or focus starts hydrating it early. Anything the analysis cannot
 * prove keeps `"load"`: an effect, a ref, a handler other than a click or submit, a form field,
 * a spread onto an element, a class, a module that runs code as it loads, or an import from a
 * package other than React.
 */
export interface FarmIslandInference {
  /** `"interaction"` when the island can wait; null to keep `"load"`. */
  strategy: "interaction" | null;
  /** The source files the result depends on, the module itself included. */
  files: string[];
  /** Why the island keeps `"load"`, for diagnostics. */
  reason?: string;
  /** A route root only: a client module in it declares its own `island` strategy. */
  declared?: boolean;
}

type Node = { type: string; [key: string]: any };

// Hooks that run code after a render, subscribe to something outside React, or read a value the
// server could not have rendered.
const EFFECT_HOOKS = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useSyncExternalStore",
  "useImperativeHandle",
  "use",
  "useActionState",
  "useOptimistic",
  "useFormStatus",
  "useDeferredValue",
  "useEffectEvent",
]);
// Calls that build elements or refs a static read of the JSX would miss.
const UNREADABLE_CALLS = new Set(["createElement", "cloneElement", "forwardRef", "createRef"]);
const REACT_MODULES = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime"]);
// What the island scheduler holds and replays before hydration.
const HELD_EVENTS = new Set(["onClick", "onSubmit"]);
// Typing into a field before hydration would be lost when React takes the field over.
const FORM_CONTROLS = new Set(["input", "textarea", "select"]);
const ASSET_IMPORT =
  /\.(?:css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|json)(?:\?.*)?$/;
const SOURCE_EXTENSIONS = new Map([
  [".tsx", "tsx"],
  [".ts", "ts"],
  [".jsx", "jsx"],
  [".js", "jsx"],
  [".mjs", "js"],
]);

interface CachedFile {
  mtimeMs: number;
  /** Null when the file passes; otherwise why it does not. */
  reason: string | null;
  imports: string[];
}

const fileCache = new Map<string, CachedFile>();

/** Infers the hydration of the islands `filePath` exports (a `"use client"` module). */
export function inferFarmIslandStrategy(filePath: string, root?: string): FarmIslandInference {
  const files: string[] = [];
  const seen = new Set<string>();
  const queue = [path.resolve(filePath)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    const result = inspectFile(file, root);
    if (result.reason) return { strategy: null, files, reason: result.reason };
    queue.push(...result.imports);
  }
  return { strategy: "interaction", files };
}

/**
 * Islands mode: whether a route that hydrates as one root (a layout around a client provider, or a
 * client page) can wait for an interaction. `owners` are the route modules inside that root, the
 * page and its layouts; every client component they render must be able to wait. Their server
 * output is the root's own, so the slot rule for islands does not apply.
 */
export function inferFarmRouteRootStrategy(owners: string[], root?: string): FarmIslandInference {
  const files: string[] = [];
  const modules: string[] = [];
  for (const owner of owners) {
    const rendered = collectFarmRenderedClientModules(owner, root);
    if (!rendered) {
      return {
        strategy: null,
        files,
        reason: `${path.basename(owner)}: its client components could not be listed`,
      };
    }
    modules.push(...rendered);
  }
  // A module that declares its strategy decides it, as it does for an island.
  for (const module of modules) {
    let source: string | null = null;
    try {
      source = fs.readFileSync(module, "utf8");
    } catch {}
    if (getIslandStrategyExport(source) !== null) return { strategy: null, files, declared: true };
  }
  for (const module of modules) {
    const result = inferFarmIslandStrategy(module, root);
    files.push(...result.files);
    if (!result.strategy) return { strategy: null, files, reason: result.reason };
  }
  return { strategy: "interaction", files };
}

/**
 * The hydration strategy of a route's root: the strategies its page and layouts declare, when they
 * agree. In islands mode, when none declares one, a route that hydrates as one root (its page is a
 * client component, or a layout on it hydrates, such as a client provider) waits for an
 * interaction when every client component inside that root can (RFC 0003, section 11). The client
 * route table, the server's choice of entry and `farm dev` all read this.
 */
export function resolveFarmRouteRootStrategy(
  route: { modulePath: string; pattern: string; directory?: string },
  page: { shouldHydrate: boolean; islandStrategy: FarmIslandStrategy | null },
  layouts: Array<{
    pattern: string;
    modulePath: string;
    shouldHydrate: boolean;
    hasIsolatedClientBoundaries: boolean;
    islandStrategy: FarmIslandStrategy | null;
  }>,
  root: string,
  islandsMode: boolean,
): FarmIslandStrategy {
  const directory = route.directory ?? route.pattern;
  const onRoute = layouts.filter((layout) =>
    routeBoundaryCoversDirectory(layout.pattern, directory),
  );
  const declared = [
    ...(page.islandStrategy ? [page.islandStrategy] : []),
    ...onRoute.flatMap((layout) =>
      (layout.shouldHydrate || layout.hasIsolatedClientBoundaries) && layout.islandStrategy
        ? [layout.islandStrategy]
        : [],
    ),
  ];
  // The plans report "load" for a hydrating module that declares nothing, so whether anything is
  // declared is read from the root's modules below.
  const combined = declared.every((strategy) => strategy === declared[0])
    ? (declared[0] ?? "load")
    : "load";
  const layoutHydrates = onRoute.some((layout) => layout.shouldHydrate);
  if (!islandsMode || (!page.shouldHydrate && !layoutHydrates)) return combined;
  // A hydrating layout's root holds the whole layout chain; a client page's root holds the page.
  const owners = [
    route.modulePath,
    ...(layoutHydrates ? onRoute.map((layout) => layout.modulePath) : []),
  ];
  const inference = inferFarmRouteRootStrategy(owners, root);
  if (inference.declared) return combined;
  return inference.strategy ?? "load";
}

function inspectFile(file: string, root?: string): CachedFile {
  let mtimeMs: number;
  let source: string;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
    const cached = fileCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached;
    source = fs.readFileSync(file, "utf8");
  } catch {
    return { mtimeMs: 0, reason: `${file} could not be read`, imports: [] };
  }
  const result = { mtimeMs, ...inspectSource(source, file, root) };
  fileCache.set(file, result);
  return result;
}

/** @internal Exported for tests: the rules for one module's source. */
export function inspectSource(
  source: string,
  file: string,
  root?: string,
): { reason: string | null; imports: string[] } {
  const lang = SOURCE_EXTENSIONS.get(path.extname(file));
  if (!lang) return { reason: `${path.basename(file)} is not a script module`, imports: [] };
  let program: Node;
  try {
    program = parseAst(source, { lang: lang as "tsx" }) as unknown as Node;
  } catch {
    return { reason: `${path.basename(file)} could not be parsed`, imports: [] };
  }

  const imports: string[] = [];
  const fail = (reason: string) => ({ reason: `${path.basename(file)}: ${reason}`, imports });
  const importSource = (specifier: string): string | null => {
    if (REACT_MODULES.has(specifier) || ASSET_IMPORT.test(specifier)) return null;
    const resolved = resolveImportedModule(file, specifier, root);
    if (!resolved.local || !resolved.path) return `imports ${specifier}`;
    if (resolved.path.includes(`${path.sep}node_modules${path.sep}`)) return `imports ${specifier}`;
    imports.push(resolved.path);
    return null;
  };

  for (const statement of program.body ?? []) {
    const problem = topLevelProblem(statement, importSource);
    if (problem) return fail(problem);
  }
  const problem = findProblem(program);
  return problem ? fail(problem) : { reason: null, imports };
}

function isTypeOnlyImport(node: Node): boolean {
  if (node.importKind === "type" || node.exportKind === "type") return true;
  const specifiers: Node[] = node.specifiers ?? [];
  return specifiers.length > 0 && specifiers.every((specifier) => specifier.importKind === "type");
}

/** What a top-level statement does as the module loads that an island must not delay. */
function topLevelProblem(
  statement: Node,
  importSource: (specifier: string) => string | null,
): string | null {
  switch (statement.type) {
    case "ImportDeclaration":
      return isTypeOnlyImport(statement) ? null : importSource(statement.source.value);
    case "ExportAllDeclaration":
      return statement.exportKind === "type" ? null : importSource(statement.source.value);
    case "ExportNamedDeclaration":
      if (statement.source) {
        return isTypeOnlyImport(statement) ? null : importSource(statement.source.value);
      }
      return statement.declaration ? topLevelProblem(statement.declaration, importSource) : null;
    case "ExportDefaultDeclaration":
      return statement.declaration.type === "FunctionDeclaration" ||
        statement.declaration.type.startsWith("TS")
        ? null
        : pureValueProblem(statement.declaration);
    case "ExpressionStatement":
      // A directive ("use client") is the only expression a module may evaluate.
      return typeof statement.directive === "string" ? null : "runs code as it loads";
    case "VariableDeclaration":
      for (const declarator of statement.declarations ?? []) {
        const problem = declarator.init ? pureValueProblem(declarator.init) : null;
        if (problem) return problem;
      }
      return null;
    case "FunctionDeclaration":
    case "EmptyStatement":
      return null;
    case "ClassDeclaration":
      return "declares a class";
    default:
      return statement.type.startsWith("TS") ? null : `has a top-level ${statement.type}`;
  }
}

/** Whether evaluating `node` at the top level can do anything but build a value. */
function pureValueProblem(node: Node): string | null {
  switch (node.type) {
    case "Literal":
    case "Identifier":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "MemberExpression":
      return null;
    case "TemplateLiteral":
      return firstProblem(node.expressions, pureValueProblem);
    case "ArrayExpression":
      return firstProblem(node.elements.filter(Boolean), pureValueProblem);
    case "ObjectExpression":
      return firstProblem(node.properties, (property: Node) =>
        property.type === "SpreadElement"
          ? pureValueProblem(property.argument)
          : property.computed
            ? "has a computed key"
            : pureValueProblem(property.value),
      );
    case "UnaryExpression":
      return pureValueProblem(node.argument);
    case "BinaryExpression":
    case "LogicalExpression":
      return pureValueProblem(node.left) ?? pureValueProblem(node.right);
    case "ConditionalExpression":
      return (
        pureValueProblem(node.test) ??
        pureValueProblem(node.consequent) ??
        pureValueProblem(node.alternate)
      );
    case "SpreadElement":
      return pureValueProblem(node.argument);
    case "CallExpression": {
      // createContext() and memo() build values; any other call runs code as the module loads.
      const name = calleeName(node.callee);
      if (name === "createContext" || name === "memo" || name === "Object.freeze") {
        return firstProblem(node.arguments, pureValueProblem);
      }
      return "runs code as it loads";
    }
    default:
      return node.type.startsWith("TS") && node.expression
        ? pureValueProblem(node.expression)
        : `evaluates a ${node.type} as it loads`;
  }
}

function firstProblem<T>(items: T[], check: (item: T) => string | null): string | null {
  for (const item of items) {
    const problem = check(item);
    if (problem) return problem;
  }
  return null;
}

function calleeName(callee: Node): string | null {
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.object.type === "Identifier" && callee.object.name === "Object"
      ? `Object.${callee.property.name}`
      : callee.property.name;
  }
  return null;
}

/** A call to one of React's functions: `name()` or `React.name()`, not `document.name()`. */
function reactCallName(callee: Node): string | null {
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "React" &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
}

function jsxName(name: Node): string | null {
  return name.type === "JSXIdentifier" ? name.name : null;
}

function isHashHref(value: Node | null): boolean {
  if (!value) return false;
  if (value.type === "Literal")
    return typeof value.value === "string" && value.value.startsWith("#");
  if (value.type !== "JSXExpressionContainer") return false;
  const expression = value.expression;
  if (expression.type === "Literal") {
    return typeof expression.value === "string" && expression.value.startsWith("#");
  }
  return (
    expression.type === "TemplateLiteral" &&
    String(expression.quasis[0]?.value?.cooked ?? "").startsWith("#")
  );
}

/** What in the module's code an island that waits for a click would get wrong. */
function hostElementProblem(element: Node): string | null {
  const tag = jsxName(element.name);
  // A component (`<Cart.Provider>` too): its own module decides, through its import, and a
  // package's import has already failed.
  if (tag === null) return null;
  if (!/^[a-z]/.test(tag)) return null;
  if (FORM_CONTROLS.has(tag)) return `renders <${tag}>`;
  let href: Node | null | undefined;
  let clicks = false;
  for (const attribute of element.attributes ?? []) {
    if (attribute.type === "JSXSpreadAttribute") return `spreads props onto <${tag}>`;
    const name = attribute.name.type === "JSXIdentifier" ? attribute.name.name : null;
    if (name === null) continue;
    if (name === "ref") return `sets a ref on <${tag}>`;
    if (name === "autoFocus") return `sets autoFocus on <${tag}>`;
    if (name === "contentEditable") return `makes <${tag}> editable`;
    if (tag === "form" && name === "action") return "gives a form an action";
    if (name === "formAction") return `sets formAction on <${tag}>`;
    if (name === "href") href = attribute.value;
    if (/^on[A-Z]/.test(name)) {
      if (!HELD_EVENTS.has(name)) return `handles ${name}`;
      if (name === "onClick") clicks = true;
    }
  }
  // A link the island handles: only a same-page link is held for it before hydration.
  if (tag === "a" && clicks && !isHashHref(href ?? null)) return "handles a click on a link";
  return null;
}

function findProblem(node: Node): string | null {
  switch (node.type) {
    case "CallExpression": {
      const name = reactCallName(node.callee);
      if (name && EFFECT_HOOKS.has(name)) return `calls ${name}`;
      if (name && UNREADABLE_CALLS.has(name)) return `calls ${name}`;
      break;
    }
    case "JSXOpeningElement": {
      const problem = hostElementProblem(node);
      if (problem) return problem;
      break;
    }
    case "ClassDeclaration":
    case "ClassExpression":
      return "declares a class";
    case "ImportExpression":
      return "imports a module at runtime";
  }
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "range" || key === "loc") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === "string") {
          const problem = findProblem(child);
          if (problem) return problem;
        }
      }
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      const problem = findProblem(value);
      if (problem) return problem;
    }
  }
  return null;
}
