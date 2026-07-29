import type { Plugin } from "vite";
import type { FarmEnvironment } from "./environment";

type EnvironmentFunctionKind = "createServerOnlyFn" | "createClientOnlyFn" | "createIsomorphicFn";

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface EnvironmentCall {
  node: AstNode;
  kind: EnvironmentFunctionKind;
}

interface Replacement {
  start: number;
  end: number;
  code: string;
}

export interface TransformEnvironmentFunctionsOptions {
  code: string;
  id: string;
  environment: FarmEnvironment;
  parse: (code: string) => AstNode;
}

export interface TransformEnvironmentFunctionsResult {
  code: string;
}

const ENVIRONMENT_IMPORTS = new Set([
  "@farm.js/core",
  "@farm.js/core/environment",
  "@farm.js/core/server",
]);
const ENVIRONMENT_FUNCTIONS = new Set<EnvironmentFunctionKind>([
  "createServerOnlyFn",
  "createClientOnlyFn",
  "createIsomorphicFn",
]);
const MODULE_EXTENSION_RE = /\.[cm]?[jt]sx?$/;

export function transformEnvironmentFunctions(
  options: TransformEnvironmentFunctionsOptions,
): TransformEnvironmentFunctionsResult | null {
  if (!isTransformableModule(options.id) || !containsEnvironmentFunction(options.code)) {
    return null;
  }

  let output = options.code;
  let transformed = false;

  for (let pass = 0; pass < 20; pass++) {
    const ast = options.parse(output);
    const bindings = findEnvironmentFunctionBindings(ast);
    if (bindings.named.size === 0 && bindings.namespaces.size === 0) break;

    const calls = findEnvironmentCalls(ast, bindings);
    if (calls.length === 0) break;

    const innermostCalls = calls.filter(
      (call) =>
        !calls.some(
          (candidate) =>
            candidate !== call &&
            candidate.node.start > call.node.start &&
            candidate.node.end < call.node.end,
        ),
    );
    const replacements = innermostCalls.map((call) =>
      createReplacement(output, options.id, options.environment, call),
    );

    output = applyReplacements(output, replacements);
    transformed = true;
  }

  if (!transformed) return null;

  const remainingAst = options.parse(output);
  const remainingBindings = findEnvironmentFunctionBindings(remainingAst);
  if (findEnvironmentCalls(remainingAst, remainingBindings).length > 0) {
    throw transformError(options.id, "environment functions are nested too deeply");
  }

  return { code: output };
}

export function farmEnvironmentFunctionsPlugin(): Plugin {
  return {
    name: "farm:environment-functions",
    enforce: "post",

    transform(code, id, transformOptions) {
      const result = transformEnvironmentFunctions({
        code,
        id,
        environment: resolveBuildEnvironment(
          this as unknown as { environment?: { name?: string } },
          transformOptions?.ssr,
        ),
        parse: (source) => this.parse(source) as unknown as AstNode,
      });

      return result ? { code: result.code, map: null } : null;
    },
  };
}

function resolveBuildEnvironment(
  context: { environment?: { name?: string } },
  ssr: boolean | undefined,
): FarmEnvironment {
  if (context.environment?.name === "client") return "client";
  if (context.environment?.name === "rsc" || context.environment?.name === "ssr") {
    return "server";
  }
  return ssr ? "server" : "client";
}

function findEnvironmentFunctionBindings(ast: AstNode) {
  const named = new Map<string, EnvironmentFunctionKind>();
  const namespaces = new Set<string>();
  const body = Array.isArray(ast.body) ? ast.body : [];

  for (const statement of body) {
    if (!isAstNode(statement) || statement.type !== "ImportDeclaration") continue;
    const source = isAstNode(statement.source) ? statement.source.value : undefined;
    if (typeof source !== "string" || !ENVIRONMENT_IMPORTS.has(source)) continue;

    const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers : [];
    for (const specifier of specifiers) {
      if (!isAstNode(specifier) || !isAstNode(specifier.local)) continue;
      const localName = specifier.local.name;
      if (typeof localName !== "string") continue;

      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaces.add(localName);
        continue;
      }

      if (specifier.type !== "ImportSpecifier" || !isAstNode(specifier.imported)) continue;
      const importedName = specifier.imported.name ?? specifier.imported.value;
      if (isEnvironmentFunctionKind(importedName)) {
        named.set(localName, importedName);
      }
    }
  }

  return { named, namespaces };
}

function findEnvironmentCalls(
  ast: AstNode,
  bindings: ReturnType<typeof findEnvironmentFunctionBindings>,
): EnvironmentCall[] {
  const calls: EnvironmentCall[] = [];

  walkAst(ast, (node, ancestors) => {
    if (node.type !== "CallExpression" || !isAstNode(node.callee)) return;

    if (node.callee.type === "Identifier" && typeof node.callee.name === "string") {
      const kind = bindings.named.get(node.callee.name);
      if (kind && !isNameShadowed(node.callee.name, ancestors)) calls.push({ node, kind });
      return;
    }

    if (
      node.callee.type !== "MemberExpression" ||
      node.callee.computed === true ||
      !isAstNode(node.callee.object) ||
      !isAstNode(node.callee.property) ||
      node.callee.object.type !== "Identifier" ||
      node.callee.property.type !== "Identifier" ||
      typeof node.callee.object.name !== "string" ||
      typeof node.callee.property.name !== "string" ||
      !bindings.namespaces.has(node.callee.object.name) ||
      isNameShadowed(node.callee.object.name, ancestors) ||
      !isEnvironmentFunctionKind(node.callee.property.name)
    ) {
      return;
    }

    calls.push({ node, kind: node.callee.property.name });
  });

  return calls;
}

function createReplacement(
  code: string,
  id: string,
  environment: FarmEnvironment,
  call: EnvironmentCall,
): Replacement {
  const args = Array.isArray(call.node.arguments) ? call.node.arguments : [];
  if (args.length !== 1 || !isAstNode(args[0]) || args[0].type === "SpreadElement") {
    throw transformError(id, `${call.kind}() requires exactly one static argument`);
  }

  let replacement: string;
  if (call.kind === "createIsomorphicFn") {
    replacement = selectIsomorphicImplementation(code, id, environment, args[0]);
  } else {
    const expected = call.kind === "createServerOnlyFn" ? "server" : "client";
    replacement =
      environment === expected
        ? readNode(code, args[0])
        : `(0, ${readNode(code, call.node.callee as AstNode)})(undefined, ${JSON.stringify(environment)})`;
  }

  return {
    start: call.node.start,
    end: call.node.end,
    code: `(${replacement})`,
  };
}

function selectIsomorphicImplementation(
  code: string,
  id: string,
  environment: FarmEnvironment,
  optionsNode: AstNode,
): string {
  if (optionsNode.type !== "ObjectExpression") {
    throw transformError(id, "createIsomorphicFn() requires an inline options object");
  }

  const properties = Array.isArray(optionsNode.properties) ? optionsNode.properties : [];
  if (properties.some((property) => isAstNode(property) && property.type === "SpreadElement")) {
    throw transformError(id, "createIsomorphicFn() does not support spread properties");
  }

  let selectedProperty: AstNode | undefined;
  for (const property of properties) {
    if (!isAstNode(property) || property.type !== "Property" || property.computed === true) {
      continue;
    }
    const key = readPropertyName(property.key);
    if (key === environment) selectedProperty = property;
  }

  if (!selectedProperty || !isAstNode(selectedProperty.value)) {
    throw transformError(id, `createIsomorphicFn() requires a ${environment} implementation`);
  }
  if (selectedProperty.kind !== undefined && selectedProperty.kind !== "init") {
    throw transformError(id, "createIsomorphicFn() does not support getters or setters");
  }

  return selectedProperty.method === true
    ? renderObjectMethod(code, id, selectedProperty.value)
    : readNode(code, selectedProperty.value);
}

function renderObjectMethod(code: string, id: string, functionNode: AstNode): string {
  if (!isAstNode(functionNode.body) || !Array.isArray(functionNode.params)) {
    throw transformError(id, "createIsomorphicFn() received an unsupported method");
  }

  const params = functionNode.params.map((param) => {
    if (!isAstNode(param)) {
      throw transformError(id, "createIsomorphicFn() received an unsupported parameter");
    }
    return readNode(code, param);
  });
  const asyncPrefix = functionNode.async === true ? "async " : "";
  const generatorMarker = functionNode.generator === true ? "*" : "";
  return `${asyncPrefix}function${generatorMarker}(${params.join(", ")}) ${readNode(code, functionNode.body)}`;
}

function applyReplacements(code: string, replacements: Replacement[]): string {
  let output = code;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.code + output.slice(replacement.end);
  }
  return output;
}

function walkAst(
  node: AstNode,
  visit: (node: AstNode, ancestors: readonly AstNode[]) => void,
  ancestors: readonly AstNode[] = [],
) {
  visit(node, ancestors);
  const childAncestors = [...ancestors, node];

  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (isAstNode(value)) {
      walkAst(value, visit, childAncestors);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) walkAst(item, visit, childAncestors);
      }
    }
  }
}

function isNameShadowed(name: string, ancestors: readonly AstNode[]): boolean {
  for (const [index, ancestor] of ancestors.entries()) {
    if (isFunctionNode(ancestor)) {
      const params = Array.isArray(ancestor.params) ? ancestor.params : [];
      if (params.some((param) => patternContainsName(param, name))) return true;
      if (patternContainsName(ancestor.id, name)) return true;
      if (
        isAstNode(ancestor.body) &&
        ancestors.slice(index + 1).includes(ancestor.body) &&
        functionBodyDeclaresVarName(ancestor.body, name)
      ) {
        return true;
      }
    }

    if (ancestor.type === "CatchClause" && patternContainsName(ancestor.param, name)) {
      return true;
    }

    if (
      (ancestor.type === "BlockStatement" || ancestor.type === "StaticBlock") &&
      blockDeclaresName(ancestor, name)
    ) {
      return true;
    }

    if (loopDeclaresName(ancestor, name)) return true;

    if (
      ancestor.type === "SwitchStatement" &&
      ancestors.slice(index + 1).some((candidate) => candidate.type === "SwitchCase") &&
      switchDeclaresName(ancestor, name)
    ) {
      return true;
    }

    if (
      ancestor.type === "ClassExpression" &&
      patternContainsName(ancestor.id, name) &&
      ancestors.slice(index + 1).some((candidate) => candidate.type === "ClassBody")
    ) {
      return true;
    }
  }

  return false;
}

function functionBodyDeclaresVarName(body: AstNode, name: string): boolean {
  if (body.type === "VariableDeclaration" && body.kind === "var") {
    const declarations = Array.isArray(body.declarations) ? body.declarations : [];
    if (
      declarations.some(
        (declaration) => isAstNode(declaration) && patternContainsName(declaration.id, name),
      )
    ) {
      return true;
    }
  }

  for (const [key, value] of Object.entries(body)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (isAstNode(value)) {
      if (isNestedVarScope(value)) continue;
      if (functionBodyDeclaresVarName(value, name)) return true;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (!isAstNode(item) || isNestedVarScope(item)) continue;
        if (functionBodyDeclaresVarName(item, name)) return true;
      }
    }
  }

  return false;
}

function isNestedVarScope(node: AstNode): boolean {
  return (
    isFunctionNode(node) || node.type === "ClassDeclaration" || node.type === "ClassExpression"
  );
}

function loopDeclaresName(node: AstNode, name: string): boolean {
  const declaration =
    node.type === "ForStatement"
      ? node.init
      : node.type === "ForInStatement" || node.type === "ForOfStatement"
        ? node.left
        : undefined;
  if (!isAstNode(declaration) || declaration.type !== "VariableDeclaration") return false;

  const declarations = Array.isArray(declaration.declarations) ? declaration.declarations : [];
  return declarations.some((item) => isAstNode(item) && patternContainsName(item.id, name));
}

function switchDeclaresName(node: AstNode, name: string): boolean {
  const cases = Array.isArray(node.cases) ? node.cases : [];
  return cases.some((switchCase) => {
    if (!isAstNode(switchCase) || !Array.isArray(switchCase.consequent)) return false;
    return switchCase.consequent.some((statement) => {
      if (!isAstNode(statement)) return false;
      if (
        (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") &&
        patternContainsName(statement.id, name)
      ) {
        return true;
      }
      if (statement.type !== "VariableDeclaration" || statement.kind === "var") return false;
      const declarations = Array.isArray(statement.declarations) ? statement.declarations : [];
      return declarations.some(
        (declaration) => isAstNode(declaration) && patternContainsName(declaration.id, name),
      );
    });
  });
}

function blockDeclaresName(block: AstNode, name: string): boolean {
  const statements = Array.isArray(block.body) ? block.body : [];
  for (const statement of statements) {
    if (!isAstNode(statement)) continue;
    if (
      (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") &&
      patternContainsName(statement.id, name)
    ) {
      return true;
    }
    if (statement.type !== "VariableDeclaration" || !Array.isArray(statement.declarations)) {
      continue;
    }
    if (
      statement.declarations.some(
        (declaration) => isAstNode(declaration) && patternContainsName(declaration.id, name),
      )
    ) {
      return true;
    }
  }
  return false;
}

function patternContainsName(value: unknown, name: string): boolean {
  if (!isAstNode(value)) return false;
  if (value.type === "Identifier") return value.name === name;

  if (value.type === "RestElement") return patternContainsName(value.argument, name);
  if (value.type === "AssignmentPattern") return patternContainsName(value.left, name);
  if (value.type === "Property") return patternContainsName(value.value, name);

  const elements = Array.isArray(value.elements)
    ? value.elements
    : Array.isArray(value.properties)
      ? value.properties
      : [];
  return elements.some((element) => patternContainsName(element, name));
}

function isFunctionNode(node: AstNode): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function readPropertyName(value: unknown): string | undefined {
  if (!isAstNode(value)) return undefined;
  if (value.type === "Identifier" && typeof value.name === "string") return value.name;
  if (value.type === "Literal" && typeof value.value === "string") return value.value;
  return undefined;
}

function readNode(code: string, node: AstNode): string {
  return code.slice(node.start, node.end);
}

function isAstNode(value: unknown): value is AstNode {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as AstNode).type === "string" &&
    typeof (value as AstNode).start === "number" &&
    typeof (value as AstNode).end === "number"
  );
}

function isEnvironmentFunctionKind(value: unknown): value is EnvironmentFunctionKind {
  return typeof value === "string" && ENVIRONMENT_FUNCTIONS.has(value as EnvironmentFunctionKind);
}

function containsEnvironmentFunction(code: string): boolean {
  return Array.from(ENVIRONMENT_FUNCTIONS).some((name) => code.includes(name));
}

function isTransformableModule(id: string): boolean {
  const cleanId = id.split("?", 1)[0];
  return MODULE_EXTENSION_RE.test(cleanId) && !/\.d\.[cm]?ts$/.test(cleanId);
}

function transformError(id: string, message: string): Error {
  return new Error(`[Farm environment functions] ${message} in ${id.split("?", 1)[0]}`);
}
