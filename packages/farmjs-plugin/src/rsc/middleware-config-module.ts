import path from "node:path";

// The RSC server needs live middleware functions, but importing the complete
// application config would also execute and bundle build-only plugins. This
// static slice keeps the explicit middleware expression and only the
// top-level bindings reachable from it. Ambiguous config shapes fail during
// configuration instead of producing a partial runtime config.

type AstNode = {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
};

type Binding = {
  names: string[];
  order: number;
  render: () => string;
  references: AstNode | null;
};

type ExtractionResult =
  | { kind: "module"; code: string }
  | { kind: "absent" }
  | { kind: "unsupported"; reason: string };

function isNode(value: unknown): value is AstNode {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as AstNode).type === "string" &&
    typeof (value as AstNode).start === "number" &&
    typeof (value as AstNode).end === "number",
  );
}

function bindingNames(pattern: AstNode | null | undefined, names: string[] = []): string[] {
  if (!pattern) return names;
  if (pattern.type === "Identifier") {
    names.push(pattern.name as string);
    return names;
  }
  if (pattern.type === "RestElement") {
    return bindingNames(pattern.argument as AstNode, names);
  }
  if (pattern.type === "AssignmentPattern") {
    return bindingNames(pattern.left as AstNode, names);
  }
  if (pattern.type === "ArrayPattern") {
    for (const element of (pattern.elements as Array<AstNode | null>) ?? []) {
      bindingNames(element, names);
    }
    return names;
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of (pattern.properties as AstNode[]) ?? []) {
      bindingNames(
        property.type === "RestElement"
          ? (property.argument as AstNode)
          : (property.value as AstNode),
        names,
      );
    }
  }
  return names;
}

function isReferenceIdentifier(node: AstNode, parent: AstNode | null, key: string): boolean {
  if (!parent) return true;
  if (
    (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
    key === "property" &&
    parent.computed !== true
  ) {
    return false;
  }
  if (
    (parent.type === "Property" ||
      parent.type === "PropertyDefinition" ||
      parent.type === "MethodDefinition") &&
    key === "key" &&
    parent.computed !== true
  ) {
    return parent.shorthand === true;
  }
  if (parent.type === "VariableDeclarator") return key !== "id";
  if (
    parent.type === "FunctionDeclaration" ||
    parent.type === "FunctionExpression" ||
    parent.type === "ArrowFunctionExpression"
  ) {
    return key !== "id" && key !== "params";
  }
  if (parent.type === "ClassDeclaration" || parent.type === "ClassExpression") {
    return key !== "id";
  }
  if (parent.type === "CatchClause") return key !== "param";
  if (parent.type === "RestElement") return false;
  if (parent.type === "AssignmentPattern") return key !== "left";
  return ![
    "ArrayPattern",
    "BreakStatement",
    "ContinueStatement",
    "ExportSpecifier",
    "ImportDefaultSpecifier",
    "ImportNamespaceSpecifier",
    "ImportSpecifier",
    "LabeledStatement",
  ].includes(parent.type);
}

function scopeBindings(node: AstNode): Set<string> {
  const names = new Set<string>();
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    if (isNode(node.id)) bindingNames(node.id).forEach((name) => names.add(name));
    for (const parameter of (node.params as AstNode[]) ?? []) {
      bindingNames(parameter).forEach((name) => names.add(name));
    }
  } else if (node.type === "CatchClause" && isNode(node.param)) {
    bindingNames(node.param).forEach((name) => names.add(name));
  } else if (node.type === "BlockStatement") {
    for (const statement of (node.body as AstNode[]) ?? []) {
      const declaration =
        statement.type === "ExportNamedDeclaration" && isNode(statement.declaration)
          ? statement.declaration
          : statement;
      if (declaration.type === "VariableDeclaration" && declaration.kind !== "var") {
        for (const declarator of (declaration.declarations as AstNode[]) ?? []) {
          bindingNames(declarator.id as AstNode).forEach((name) => names.add(name));
        }
      } else if (
        (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
        isNode(declaration.id)
      ) {
        names.add(declaration.id.name as string);
      }
    }
  }
  return names;
}

function referencedTopLevelNames(node: AstNode, candidates: ReadonlySet<string>): Set<string> {
  const references = new Set<string>();

  const visit = (
    value: unknown,
    parent: AstNode | null,
    key: string,
    scopes: ReadonlyArray<ReadonlySet<string>>,
  ): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child, parent, key, scopes);
      return;
    }
    if (!isNode(value)) return;

    const nodeScopes = [
      ...scopes,
      ...([
        "ArrowFunctionExpression",
        "BlockStatement",
        "CatchClause",
        "FunctionDeclaration",
        "FunctionExpression",
      ].includes(value.type)
        ? [scopeBindings(value)]
        : []),
    ];

    if (value.type === "Identifier") {
      const name = value.name as string;
      const shadowed = nodeScopes.some((scope) => scope.has(name));
      if (candidates.has(name) && !shadowed && isReferenceIdentifier(value, parent, key)) {
        references.add(name);
      }
      return;
    }

    for (const [childKey, child] of Object.entries(value)) {
      if (childKey === "start" || childKey === "end" || childKey === "loc") continue;
      visit(child, value, childKey, nodeScopes);
    }
  };

  visit(node, null, "", []);
  return references;
}

function importBindingCode(statement: AstNode, specifier: AstNode, _source: string): string {
  const moduleSource = JSON.stringify((statement.source as AstNode).value);
  const local = (specifier.local as AstNode).name as string;
  if (specifier.type === "ImportDefaultSpecifier") {
    return `import ${local} from ${moduleSource};`;
  }
  if (specifier.type === "ImportNamespaceSpecifier") {
    return `import * as ${local} from ${moduleSource};`;
  }
  const imported = specifier.imported as AstNode;
  const importedName =
    imported.type === "Identifier" ? (imported.name as string) : JSON.stringify(imported.value);
  return `import { ${importedName}${importedName === local ? "" : ` as ${local}`} } from ${moduleSource};`;
}

function propertyName(property: AstNode): string | null {
  if (property.computed === true) return null;
  const key = property.key as AstNode;
  if (key.type === "Identifier") return key.name as string;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

function resolveConfigObject(
  node: AstNode,
  variableInitializers: ReadonlyMap<string, AstNode>,
  configHelpers: ReadonlySet<string>,
  seen = new Set<string>(),
): AstNode | null {
  if (node.type === "ObjectExpression") return node;
  if (node.type === "CallExpression") {
    const callee = node.callee as AstNode;
    const args = (node.arguments as AstNode[]) ?? [];
    if (
      callee.type === "Identifier" &&
      configHelpers.has(callee.name as string) &&
      args.length === 1
    ) {
      return resolveConfigObject(args[0], variableInitializers, configHelpers, seen);
    }
    return null;
  }
  if (node.type === "Identifier") {
    const name = node.name as string;
    if (seen.has(name)) return null;
    const initializer = variableInitializers.get(name);
    if (!initializer) return null;
    seen.add(name);
    return resolveConfigObject(initializer, variableInitializers, configHelpers, seen);
  }
  return null;
}

export function extractRscMiddlewareConfigModule(
  source: string,
  program: AstNode,
): ExtractionResult {
  const body = (program.body as AstNode[]) ?? [];
  const bindings = new Map<string, Binding>();
  const variableInitializers = new Map<string, AstNode>();
  const configHelpers = new Set(["defineConfig", "defineFarmConfig"]);
  let defaultExport: AstNode | null = null;
  let order = 0;

  for (const statement of body) {
    if (statement.type === "ImportDeclaration") {
      const moduleName = (statement.source as AstNode).value;
      for (const specifier of (statement.specifiers as AstNode[]) ?? []) {
        const local = (specifier.local as AstNode).name as string;
        if (moduleName === "@farm.js/core" || moduleName === "@farm.js/core/config") {
          const imported = specifier.imported as AstNode | undefined;
          const importedName = imported?.type === "Identifier" ? imported.name : undefined;
          if (importedName === "defineConfig" || importedName === "defineFarmConfig") {
            configHelpers.add(local);
          }
        }
        bindings.set(local, {
          names: [local],
          order: order++,
          render: () => importBindingCode(statement, specifier, source),
          references: null,
        });
      }
      continue;
    }

    if (statement.type === "ExportDefaultDeclaration") {
      defaultExport = statement.declaration as AstNode;
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      for (const specifier of (statement.specifiers as AstNode[]) ?? []) {
        const exported = specifier.exported as AstNode;
        if (
          (exported.type === "Identifier" && exported.name === "default") ||
          (exported.type === "Literal" && exported.value === "default")
        ) {
          defaultExport = specifier.local as AstNode;
        }
      }
    }

    const declaration =
      statement.type === "ExportNamedDeclaration" && isNode(statement.declaration)
        ? statement.declaration
        : statement;
    if (declaration.type === "VariableDeclaration") {
      for (const declarator of (declaration.declarations as AstNode[]) ?? []) {
        const names = bindingNames(declarator.id as AstNode);
        const initializer = isNode(declarator.init) ? declarator.init : null;
        if (names.length === 1 && initializer) variableInitializers.set(names[0], initializer);
        const binding: Binding = {
          names,
          order: order++,
          render: () =>
            `${declaration.kind as string} ${source.slice(declarator.start, declarator.end)};`,
          references: declarator,
        };
        for (const name of names) bindings.set(name, binding);
      }
      continue;
    }
    if (
      (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
      isNode(declaration.id)
    ) {
      const name = declaration.id.name as string;
      bindings.set(name, {
        names: [name],
        order: order++,
        render: () => source.slice(declaration.start, declaration.end),
        references: declaration,
      });
    }
  }

  if (!defaultExport) {
    return { kind: "unsupported", reason: "the config has no default export" };
  }
  const configObject = resolveConfigObject(defaultExport, variableInitializers, configHelpers);
  if (!configObject) {
    return {
      kind: "unsupported",
      reason: "the default export is not a statically traceable defineConfig object",
    };
  }

  const properties = (configObject.properties as AstNode[]) ?? [];
  let middlewareProperty: AstNode | null = null;
  let middlewareIndex = -1;
  for (const [index, property] of properties.entries()) {
    if (property.type === "Property" && propertyName(property) === "middleware") {
      middlewareProperty = property;
      middlewareIndex = index;
    }
  }
  if (!middlewareProperty) {
    if (properties.some((property) => property.type === "SpreadElement")) {
      return {
        kind: "unsupported",
        reason: "middleware may be supplied through a config spread",
      };
    }
    return { kind: "absent" };
  }
  if (properties.slice(middlewareIndex + 1).some((property) => property.type === "SpreadElement")) {
    return {
      kind: "unsupported",
      reason: "a config spread after middleware may override it",
    };
  }

  const middlewareValue = middlewareProperty.value as AstNode;
  const candidateNames = new Set(bindings.keys());
  const selectedBindings = new Set<Binding>();
  const pending = [...referencedTopLevelNames(middlewareValue, candidateNames)];
  while (pending.length > 0) {
    const name = pending.pop()!;
    const binding = bindings.get(name);
    if (!binding || selectedBindings.has(binding)) continue;
    selectedBindings.add(binding);
    if (binding.references) {
      for (const reference of referencedTopLevelNames(binding.references, candidateNames)) {
        pending.push(reference);
      }
    }
  }

  const declarations = [...selectedBindings]
    .sort((a, b) => a.order - b.order)
    .map((binding) => binding.render());
  const middlewareSource = source.slice(middlewareValue.start, middlewareValue.end);
  return {
    kind: "module",
    code: `${declarations.join("\n")}${declarations.length ? "\n" : ""}export default { middleware: ${middlewareSource} };\n`,
  };
}

function esbuildLoader(file: string): "js" | "jsx" | "ts" | "tsx" {
  switch (path.extname(file)) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "ts";
    case ".tsx":
      return "tsx";
    case ".jsx":
      return "jsx";
    default:
      return "js";
  }
}

export async function loadRscMiddlewareConfigModule(configPath: string): Promise<ExtractionResult> {
  const [{ readFile }, { parseAst, transformWithEsbuild }] = await Promise.all([
    import("node:fs/promises"),
    import("vite"),
  ]);
  const source = await readFile(configPath, "utf8");
  const transformed = await transformWithEsbuild(source, configPath, {
    format: "esm",
    jsx: "automatic",
    loader: esbuildLoader(configPath),
  });
  return extractRscMiddlewareConfigModule(
    transformed.code,
    parseAst(transformed.code) as unknown as AstNode,
  );
}
