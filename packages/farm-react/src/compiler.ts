import { transformAsync, traverse, types as t, type NodePath, type PluginObj } from "@babel/core";
import type { NormalizedReactCompilerOptions } from "./index";

export interface CompilerDiagnostic {
  component: string;
  reason: string;
  selected: boolean;
}

export interface CompileReactModuleResult {
  code: string;
  map: unknown;
  compiled: readonly string[];
  diagnostics: readonly CompilerDiagnostic[];
}

interface StateBinding {
  valueName: string;
  setterName: string;
  index: number;
  initialValue?: t.Expression;
}

interface PendingBinding {
  kind: "text" | "attribute";
  path: number[];
  dependencies: number[];
  name?: string;
  value: t.Expression;
}

interface Candidate {
  name: string;
  path: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>;
  statementPath: NodePath;
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function directiveValues(node: { directives?: readonly t.Directive[] | null }): string[] {
  return (node.directives || []).map((directive) => directive.value.value);
}

function isUseStateCall(
  expression: t.Node | null | undefined,
  useStateNames: ReadonlySet<string>,
  reactNames: ReadonlySet<string>,
): expression is t.CallExpression {
  if (!t.isCallExpression(expression)) return false;
  if (t.isIdentifier(expression.callee)) return useStateNames.has(expression.callee.name);
  return (
    t.isMemberExpression(expression.callee) &&
    !expression.callee.computed &&
    t.isIdentifier(expression.callee.object) &&
    reactNames.has(expression.callee.object.name) &&
    t.isIdentifier(expression.callee.property, { name: "useState" })
  );
}

function cloneExpression<T extends t.Expression>(expression: T): T {
  return t.cloneNode(expression, true) as T;
}

function expressionFile(expression: t.Expression): t.File {
  return t.file(t.program([t.expressionStatement(expression)]));
}

function collectStateDependencies(
  expression: t.Expression,
  statesByValue: ReadonlyMap<string, StateBinding>,
): number[] {
  const dependencies = new Set<number>();
  const file = expressionFile(cloneExpression(expression));
  traverse(file, {
    ReferencedIdentifier(path) {
      const state = statesByValue.get(path.node.name);
      if (state && !path.scope.hasBinding(path.node.name)) dependencies.add(state.index);
    },
  });
  return [...dependencies].sort((left, right) => left - right);
}

function referencesIdentifier(expression: t.Expression, name: string): boolean {
  let referenced = false;
  traverse(expressionFile(cloneExpression(expression)), {
    ReferencedIdentifier(path) {
      if (path.node.name === name && !path.scope.hasBinding(name)) {
        referenced = true;
      }
    },
  });
  return referenced;
}

function findContainingEvent(path: NodePath): NodePath<t.JSXAttribute> | null {
  const attribute = path.findParent((parent) => parent.isJSXAttribute());
  if (!attribute?.isJSXAttribute() || !t.isJSXIdentifier(attribute.node.name)) return null;
  return /^on[A-Z]/.test(attribute.node.name.name) ? attribute : null;
}

function validateSetterUsage(
  root: t.JSXElement,
  statesBySetter: ReadonlyMap<string, StateBinding>,
): string | undefined {
  const file = expressionFile(t.cloneNode(root, true));
  let reason: string | undefined;
  traverse(file, {
    ReferencedIdentifier(path) {
      if (reason) return;
      const state = statesBySetter.get(path.node.name);
      if (!state || path.scope.hasBinding(path.node.name)) return;
      const parent = path.parentPath;
      if (
        !parent.isCallExpression() ||
        parent.node.callee !== path.node ||
        !findContainingEvent(parent)
      ) {
        reason = `${state.setterName} must be called inside a JSX event handler`;
      }
    },
  });
  return reason;
}

function rewriteStateAccess(
  expression: t.Expression,
  stateParameter: t.Identifier,
  statesByValue: ReadonlyMap<string, StateBinding>,
  statesBySetter: ReadonlyMap<string, StateBinding>,
): t.Expression {
  const file = expressionFile(cloneExpression(expression));
  traverse(file, {
    CallExpression(path) {
      const callee = path.get("callee");
      if (!callee.isIdentifier() || callee.scope.hasBinding(callee.node.name)) return;
      const state = statesBySetter.get(callee.node.name);
      if (!state) return;
      callee.replaceWith(
        t.memberExpression(
          t.memberExpression(t.cloneNode(stateParameter), t.numericLiteral(state.index), true),
          t.identifier("set"),
        ),
      );
    },
    ReferencedIdentifier(path) {
      const state = statesByValue.get(path.node.name);
      if (!state || path.scope.hasBinding(path.node.name)) return;
      path.replaceWith(
        t.callExpression(
          t.memberExpression(
            t.memberExpression(t.cloneNode(stateParameter), t.numericLiteral(state.index), true),
            t.identifier("get"),
          ),
          [],
        ),
      );
    },
  });
  return (file.program.body[0] as t.ExpressionStatement).expression;
}

function cleanJsxText(value: string): string {
  const lines = value.replace(/\r/g, "").split("\n");
  let result = "";
  for (let index = 0; index < lines.length; index += 1) {
    const lastNonEmptyLine = lines.slice(index + 1).every((line) => line.trim().length === 0);
    let line = lines[index].replace(/\t/g, " ").replace(/ +/g, " ");
    if (index > 0) line = line.replace(/^ /, "");
    if (!lastNonEmptyLine) line = line.replace(/ $/, "");
    if (line) result += line + (!lastNonEmptyLine ? " " : "");
  }
  return result;
}

function isTextExpression(expression: t.Expression): boolean {
  let supported = true;
  traverse(expressionFile(cloneExpression(expression)), {
    CallExpression(path) {
      supported = false;
      path.stop();
    },
    OptionalCallExpression(path) {
      supported = false;
      path.stop();
    },
    JSXElement(path) {
      supported = false;
      path.stop();
    },
    JSXFragment(path) {
      supported = false;
      path.stop();
    },
    ObjectExpression(path) {
      supported = false;
      path.stop();
    },
    Function(path) {
      supported = false;
      path.stop();
    },
  });
  return supported;
}

function jsxAttributeName(attribute: t.JSXAttribute): string | undefined {
  return t.isJSXIdentifier(attribute.name) ? attribute.name.name : undefined;
}

function analyzeHostTree(
  root: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
): { bindings?: PendingBinding[]; reason?: string } {
  const bindings: PendingBinding[] = [];

  const visit = (element: t.JSXElement, path: number[]): string | undefined => {
    const tag = element.openingElement.name;
    if (!t.isJSXIdentifier(tag) || !/^[a-z]/.test(tag.name)) {
      return "compiled trees currently support host elements only";
    }

    for (const attribute of element.openingElement.attributes) {
      if (t.isJSXSpreadAttribute(attribute)) return "JSX attribute spreads are not supported yet";
      const name = jsxAttributeName(attribute);
      if (!name) return "namespaced JSX attributes are not supported yet";
      if (name === "ref" || name === "dangerouslySetInnerHTML") {
        return `${name} requires React ownership`;
      }
      if (
        !t.isJSXExpressionContainer(attribute.value) ||
        t.isJSXEmptyExpression(attribute.value.expression)
      ) {
        continue;
      }

      const expression = attribute.value.expression;
      const dependencies = collectStateDependencies(expression, statesByValue);
      if (dependencies.length === 0 || /^on[A-Z]/.test(name)) continue;
      if (name === "style" || name === "children" || name === "key") {
        return `stateful ${name} bindings are not supported yet`;
      }
      bindings.push({
        kind: "attribute",
        path: [...path],
        dependencies,
        name,
        value: cloneExpression(expression),
      });
    }

    const nestedElements = element.children.filter((child): child is t.JSXElement =>
      t.isJSXElement(child),
    );
    const expressionChildren = element.children.filter((child): child is t.JSXExpressionContainer =>
      t.isJSXExpressionContainer(child),
    );
    for (const child of expressionChildren) {
      if (t.isJSXEmptyExpression(child.expression)) continue;
      if (!isTextExpression(child.expression)) {
        return "dynamic child structures require React reconciliation";
      }
    }

    if (nestedElements.length === 0) {
      const dependencies = new Set<number>();
      const parts: t.Expression[] = [];
      for (const child of element.children) {
        if (t.isJSXText(child)) {
          const text = cleanJsxText(child.value);
          if (text) parts.push(t.stringLiteral(text));
        } else if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
          collectStateDependencies(child.expression, statesByValue).forEach((dependency) =>
            dependencies.add(dependency),
          );
          parts.push(cloneExpression(child.expression));
        }
      }
      if (dependencies.size > 0) {
        bindings.push({
          kind: "text",
          path: [...path],
          dependencies: [...dependencies].sort((left, right) => left - right),
          value: t.arrayExpression(parts),
        });
      }
    } else {
      for (const child of expressionChildren) {
        if (
          !t.isJSXEmptyExpression(child.expression) &&
          collectStateDependencies(child.expression, statesByValue).length > 0
        ) {
          return "mixed element and stateful text children are not supported yet";
        }
      }
      let elementIndex = 0;
      for (const child of element.children) {
        if (!t.isJSXElement(child)) continue;
        const reason = visit(child, [...path, elementIndex]);
        if (reason) return reason;
        elementIndex += 1;
      }
    }

    return undefined;
  };

  const reason = visit(root, []);
  return reason ? { reason } : { bindings };
}

function lazyInitialValue(expression?: t.Expression): t.Expression {
  const value = t.identifier("_initial");
  const initializer = expression ? cloneExpression(expression) : t.identifier("undefined");
  return t.callExpression(
    t.arrowFunctionExpression(
      [],
      t.blockStatement([
        t.variableDeclaration("const", [t.variableDeclarator(value, initializer)]),
        t.returnStatement(
          t.conditionalExpression(
            t.binaryExpression(
              "===",
              t.unaryExpression("typeof", t.cloneNode(value)),
              t.stringLiteral("function"),
            ),
            t.callExpression(t.cloneNode(value), []),
            t.cloneNode(value),
          ),
        ),
      ]),
    ),
    [],
  );
}

function clonePropsParameter(
  path: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
): t.Identifier {
  const parameter = path.node.params[0];
  return parameter && t.isIdentifier(parameter)
    ? (t.cloneNode(parameter, true) as t.Identifier)
    : t.identifier("_props");
}

function bindingObject(
  binding: PendingBinding,
  componentPath: Candidate["path"],
  stateParameter: t.Identifier,
  statesByValue: ReadonlyMap<string, StateBinding>,
  statesBySetter: ReadonlyMap<string, StateBinding>,
): t.ObjectExpression {
  const properties: t.ObjectProperty[] = [
    t.objectProperty(t.identifier("kind"), t.stringLiteral(binding.kind)),
    t.objectProperty(
      t.identifier("path"),
      t.arrayExpression(binding.path.map((part) => t.numericLiteral(part))),
    ),
    t.objectProperty(
      t.identifier("dependencies"),
      t.arrayExpression(binding.dependencies.map((part) => t.numericLiteral(part))),
    ),
  ];
  if (binding.name)
    properties.push(t.objectProperty(t.identifier("name"), t.stringLiteral(binding.name)));
  properties.push(
    t.objectProperty(
      t.identifier("read"),
      t.arrowFunctionExpression(
        [clonePropsParameter(componentPath), t.cloneNode(stateParameter)],
        rewriteStateAccess(binding.value, stateParameter, statesByValue, statesBySetter),
      ),
    ),
  );
  return t.objectExpression(properties);
}

function wrapperElement(definitionIdentifier: t.Identifier, props?: t.Identifier): t.JSXElement {
  const name = t.jsxIdentifier(definitionIdentifier.name);
  const attributes = props ? [t.jsxSpreadAttribute(t.cloneNode(props))] : [];
  return t.jsxElement(t.jsxOpeningElement(name, attributes, true), null, [], true);
}

function compileCandidate(
  candidate: Candidate,
  createComponentIdentifier: t.Identifier,
  useStateNames: ReadonlySet<string>,
  reactNames: ReadonlySet<string>,
): string | undefined {
  const { path, name, statementPath } = candidate;
  if (path.node.async || path.node.generator)
    return "async and generator components are not supported";
  if (path.node.typeParameters) return "generic components are not supported yet";
  if (
    path.node.params.length > 1 ||
    (path.node.params[0] && !t.isIdentifier(path.node.params[0]))
  ) {
    return "components must use zero parameters or one props identifier";
  }
  if (!t.isBlockStatement(path.node.body)) return "components must use a block body";

  const states: StateBinding[] = [];
  let returned: t.ReturnStatement | undefined;
  for (const statement of path.node.body.body) {
    if (t.isReturnStatement(statement)) {
      if (returned) return "components must have one unconditional return";
      returned = statement;
      continue;
    }
    if (!t.isVariableDeclaration(statement) || statement.declarations.length !== 1) {
      return "only top-level useState declarations and one return are supported in Group 1";
    }
    const declaration = statement.declarations[0];
    if (
      statement.kind !== "const" ||
      !t.isArrayPattern(declaration.id) ||
      declaration.id.elements.length !== 2 ||
      !t.isIdentifier(declaration.id.elements[0]) ||
      !t.isIdentifier(declaration.id.elements[1]) ||
      !isUseStateCall(declaration.init, useStateNames, reactNames) ||
      declaration.init.arguments.length > 1 ||
      (declaration.init.arguments[0] && !t.isExpression(declaration.init.arguments[0]))
    ) {
      return "only const [value, setValue] = useState(initial) declarations are supported";
    }
    states.push({
      valueName: declaration.id.elements[0].name,
      setterName: declaration.id.elements[1].name,
      index: states.length,
      initialValue: declaration.init.arguments[0] as t.Expression | undefined,
    });
  }

  if (states.length === 0) return "no local useState binding was found";
  if (!returned?.argument || !t.isJSXElement(returned.argument)) {
    return "the component must return one host JSX element";
  }

  const statesByValue = new Map(states.map((state) => [state.valueName, state]));
  const statesBySetter = new Map(states.map((state) => [state.setterName, state]));
  for (const state of states) {
    if (
      state.initialValue &&
      (collectStateDependencies(state.initialValue, statesByValue).length > 0 ||
        [...statesBySetter].some(([setterName]) =>
          referencesIdentifier(state.initialValue!, setterName),
        ))
    ) {
      return "useState initializers cannot reference another local state binding";
    }
  }
  const setterReason = validateSetterUsage(returned.argument, statesBySetter);
  if (setterReason) return setterReason;
  const analysis = analyzeHostTree(returned.argument, statesByValue);
  if (analysis.reason) return analysis.reason;

  const stateParameter = path.scope.generateUidIdentifier("farmState");
  const definitionIdentifier = path.scope.generateUidIdentifier(`${name}Compiled`);
  const propsParameter = clonePropsParameter(path);
  const rewrittenRoot = rewriteStateAccess(
    returned.argument,
    stateParameter,
    statesByValue,
    statesBySetter,
  ) as t.JSXElement;
  const definition = t.callExpression(t.cloneNode(createComponentIdentifier), [
    t.objectExpression([
      t.objectProperty(t.identifier("displayName"), t.stringLiteral(name)),
      t.objectProperty(
        t.identifier("initialize"),
        t.arrowFunctionExpression(
          [t.cloneNode(propsParameter)],
          t.arrayExpression(states.map((state) => lazyInitialValue(state.initialValue))),
        ),
      ),
      t.objectProperty(
        t.identifier("render"),
        t.arrowFunctionExpression(
          [t.cloneNode(propsParameter), t.cloneNode(stateParameter)],
          rewrittenRoot,
        ),
      ),
      t.objectProperty(
        t.identifier("bindings"),
        t.arrayExpression(
          (analysis.bindings || []).map((binding) =>
            bindingObject(binding, path, stateParameter, statesByValue, statesBySetter),
          ),
        ),
      ),
    ]),
  ]);

  const originalProps = path.node.params[0];
  path
    .get("body")
    .replaceWith(
      t.blockStatement([
        t.returnStatement(
          wrapperElement(
            definitionIdentifier,
            originalProps && t.isIdentifier(originalProps) ? originalProps : undefined,
          ),
        ),
      ]),
    );
  statementPath.insertAfter(
    t.variableDeclaration("const", [t.variableDeclarator(definitionIdentifier, definition)]),
  );
  return undefined;
}

function collectCandidates(programPath: NodePath<t.Program>): Candidate[] {
  const candidates: Candidate[] = [];
  programPath.traverse({
    FunctionDeclaration(path) {
      if (!path.node.id || !isComponentName(path.node.id.name)) return;
      const parent = path.parentPath;
      if (
        !parent.isProgram() &&
        !parent.isExportNamedDeclaration() &&
        !parent.isExportDefaultDeclaration()
      ) {
        return;
      }
      candidates.push({
        name: path.node.id.name,
        path,
        statementPath: parent.isProgram() ? path : parent,
      });
    },
    VariableDeclarator(path) {
      if (
        !t.isIdentifier(path.node.id) ||
        !isComponentName(path.node.id.name) ||
        (!t.isFunctionExpression(path.node.init) && !t.isArrowFunctionExpression(path.node.init))
      ) {
        return;
      }
      const declaration = path.parentPath;
      const statement = declaration.parentPath;
      if (!statement) return;
      const topLevel = statement.isProgram()
        ? declaration
        : statement.isExportNamedDeclaration() && statement.parentPath.isProgram()
          ? statement
          : null;
      if (!topLevel) return;
      candidates.push({
        name: path.node.id.name,
        path: path.get("init") as Candidate["path"],
        statementPath: topLevel,
      });
    },
  });
  return candidates;
}

export async function compileReactModule(
  code: string,
  id: string,
  options: NormalizedReactCompilerOptions,
): Promise<CompileReactModuleResult> {
  const compiled: string[] = [];
  const diagnostics: CompilerDiagnostic[] = [];
  const plugin = (): PluginObj => ({
    name: "farm-react-aot",
    visitor: {
      Program(programPath) {
        const moduleDirectives = new Set(directiveValues(programPath.node));
        const useStateNames = new Set<string>();
        const reactNames = new Set<string>();
        for (const statement of programPath.node.body) {
          if (!t.isImportDeclaration(statement) || statement.source.value !== "react") continue;
          for (const specifier of statement.specifiers) {
            if (t.isImportDefaultSpecifier(specifier) || t.isImportNamespaceSpecifier(specifier)) {
              reactNames.add(specifier.local.name);
            } else if (
              t.isImportSpecifier(specifier) &&
              t.isIdentifier(specifier.imported, { name: "useState" })
            ) {
              useStateNames.add(specifier.local.name);
            }
          }
        }

        const candidates = collectCandidates(programPath);
        const createComponentIdentifier =
          programPath.scope.generateUidIdentifier("createCompiledComponent");
        for (const candidate of candidates) {
          const functionDirectives = new Set(
            t.isBlockStatement(candidate.path.node.body)
              ? directiveValues(candidate.path.node.body)
              : [],
          );
          const explicitlySelected =
            moduleDirectives.has(options.directive) || functionDirectives.has(options.directive);
          if (functionDirectives.has("use no compiler")) continue;
          if (options.mode === "annotation" && !explicitlySelected) continue;

          const reason = compileCandidate(
            candidate,
            createComponentIdentifier,
            useStateNames,
            reactNames,
          );
          if (reason) {
            diagnostics.push({
              component: candidate.name,
              reason,
              selected: explicitlySelected,
            });
          } else {
            compiled.push(candidate.name);
          }
        }

        if (compiled.length > 0) {
          programPath.unshiftContainer(
            "body",
            t.importDeclaration(
              [
                t.importSpecifier(
                  createComponentIdentifier,
                  t.identifier("createCompiledComponent"),
                ),
              ],
              t.stringLiteral("@farm.js/react/compiler-runtime"),
            ),
          );
        }
      },
    },
  });

  const result = await transformAsync(code, {
    filename: id,
    sourceType: "module",
    ast: false,
    code: true,
    sourceMaps: true,
    sourceFileName: id,
    configFile: false,
    babelrc: false,
    parserOpts: {
      plugins: ["jsx", "typescript"],
    },
    generatorOpts: {
      comments: true,
      compact: false,
    },
    plugins: [plugin],
  });

  return {
    code: result?.code || code,
    map: result?.map || null,
    compiled,
    diagnostics,
  };
}
