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

interface HandlerBinding {
  name: string;
  value: t.ArrowFunctionExpression | t.FunctionExpression;
}

interface LocalBinding {
  kind: "derived" | "handler";
  name: string;
  value: t.Expression;
}

interface PropsPlan {
  definitionParameter: t.Identifier;
  wrapperProps?: t.Expression;
  destructuredNames: ReadonlySet<string>;
}

interface PendingDomBinding {
  kind: "text" | "attribute" | "style";
  path: number[];
  target?: number;
  dependencies: number[];
  name?: string;
  value: t.Expression;
}

interface PendingConditionalBlockBinding {
  kind: "block";
  id: number;
  parent?: number;
  dependencies: number[];
}

type PendingBinding = PendingDomBinding | PendingConditionalBlockBinding;

interface ConditionalBlockPlan {
  kind: "conditional";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.Expression;
}

interface KeyedListPlan {
  kind: "keyed-list";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.Expression;
  syntax: "map" | "list";
}

interface ComponentIslandPlan {
  kind: "component";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.JSXElement;
}

type ComposableBlockPlan = ConditionalBlockPlan | KeyedListPlan | ComponentIslandPlan;

interface Candidate {
  name: string;
  path: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>;
  statementPath: NodePath;
}

const SAFE_GLOBAL_CALLS = new Set(["Boolean", "Number", "String"]);
const SAFE_MATH_CALLS = new Set(["abs", "ceil", "floor", "max", "min", "round", "sign", "trunc"]);

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function isHostElement(element: t.JSXElement): boolean {
  const name = element.openingElement.name;
  return t.isJSXIdentifier(name) && /^[a-z]/.test(name.name);
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

function collectReferencedLocals(expression: t.Expression, names: ReadonlySet<string>): string[] {
  const references = new Set<string>();
  traverse(expressionFile(cloneExpression(expression)), {
    ReferencedIdentifier(path) {
      if (names.has(path.node.name) && !path.scope.hasBinding(path.node.name)) {
        references.add(path.node.name);
      }
    },
  });
  return [...references];
}

function rewriteDerivedAccess<T extends t.Expression>(
  expression: T,
  derivedByName: ReadonlyMap<string, t.Expression>,
): T {
  const file = expressionFile(cloneExpression(expression));
  traverse(file, {
    ReferencedIdentifier(path) {
      if (path.scope.hasBinding(path.node.name)) return;
      const derived = derivedByName.get(path.node.name);
      if (!derived) return;
      path.replaceWith(cloneExpression(derived));
      path.skip();
    },
  });
  return (file.program.body[0] as t.ExpressionStatement).expression as T;
}

function rewriteDestructuredPropAccess<T extends t.Expression>(
  expression: T,
  names: ReadonlySet<string>,
  propsParameter: t.Identifier,
): T {
  if (names.size === 0) return cloneExpression(expression);
  const file = expressionFile(cloneExpression(expression));
  traverse(file, {
    ReferencedIdentifier(path) {
      if (!names.has(path.node.name) || path.scope.hasBinding(path.node.name)) return;
      if (path.parentPath.isJSXOpeningElement() || path.parentPath.isJSXClosingElement()) return;
      path.replaceWith(
        t.memberExpression(t.cloneNode(propsParameter), t.identifier(path.node.name)),
      );
      path.skip();
    },
  });
  return (file.program.body[0] as t.ExpressionStatement).expression as T;
}

function rewriteHandlerAccess(
  root: t.JSXElement,
  handlersByName: ReadonlyMap<string, HandlerBinding>,
): { root?: t.JSXElement; reason?: string } {
  if (handlersByName.size === 0) return { root: t.cloneNode(root, true) };
  const file = expressionFile(t.cloneNode(root, true));
  let reason: string | undefined;
  traverse(file, {
    ReferencedIdentifier(path) {
      if (reason || path.scope.hasBinding(path.node.name)) return;
      const handler = handlersByName.get(path.node.name);
      if (!handler) return;
      const container = path.parentPath;
      const attribute = container.parentPath;
      const eventName = attribute?.isJSXAttribute() && jsxAttributeName(attribute.node);
      if (
        container.isJSXExpressionContainer() &&
        container.node.expression === path.node &&
        eventName &&
        /^on[A-Z]/.test(eventName)
      ) {
        path.replaceWith(t.cloneNode(handler.value, true));
        path.skip();
        return;
      }

      const call =
        container.isCallExpression() && container.node.callee === path.node ? container : null;
      const event = call && findContainingEvent(call);
      const eventExpression =
        event?.node.value &&
        t.isJSXExpressionContainer(event.node.value) &&
        event.node.value.expression;
      const isInsideInlineHandler =
        eventExpression &&
        (t.isArrowFunctionExpression(eventExpression) || t.isFunctionExpression(eventExpression)) &&
        Boolean(call?.findParent((parent) => parent.node === eventExpression));
      if (!call || !event || !isInsideInlineHandler) {
        reason = `event handler ${handler.name} must be passed directly to a JSX event or called inside its inline handler`;
        path.stop();
        return;
      }
      path.replaceWith(t.cloneNode(handler.value, true));
      path.skip();
    },
  });
  return reason
    ? { reason }
    : { root: (file.program.body[0] as t.ExpressionStatement).expression as t.JSXElement };
}

function isSafeCompilerCall(
  expression: t.CallExpression,
  safeGlobals: ReadonlySet<string>,
): boolean {
  if (t.isIdentifier(expression.callee)) {
    return safeGlobals.has(expression.callee.name) && SAFE_GLOBAL_CALLS.has(expression.callee.name);
  }
  return (
    t.isMemberExpression(expression.callee) &&
    !expression.callee.computed &&
    t.isIdentifier(expression.callee.object, { name: "Math" }) &&
    safeGlobals.has("Math") &&
    t.isIdentifier(expression.callee.property) &&
    SAFE_MATH_CALLS.has(expression.callee.property.name)
  );
}

function validateDerivedExpression(
  expression: t.Expression,
  safeGlobals: ReadonlySet<string>,
): string | undefined {
  let unsupported: string | undefined;
  const reject = (reason: string, path: NodePath) => {
    unsupported = reason;
    path.stop();
  };

  traverse(expressionFile(cloneExpression(expression)), {
    ArrayExpression: (path) => reject("array literals", path),
    AssignmentExpression: (path) => reject("assignments", path),
    AwaitExpression: (path) => reject("await expressions", path),
    CallExpression(path) {
      if (!isSafeCompilerCall(path.node, safeGlobals)) reject("function calls", path);
    },
    ClassExpression: (path) => reject("class expressions", path),
    Function: (path) => reject("function expressions", path),
    JSXElement: (path) => reject("JSX", path),
    JSXFragment: (path) => reject("JSX", path),
    NewExpression: (path) => reject("constructor calls", path),
    ObjectExpression: (path) => reject("object literals", path),
    OptionalCallExpression: (path) => reject("function calls", path),
    TaggedTemplateExpression: (path) => reject("tagged templates", path),
    ThisExpression: (path) => reject("this expressions", path),
    UnaryExpression(path) {
      if (path.node.operator === "delete") reject("delete expressions", path);
    },
    UpdateExpression: (path) => reject("update expressions", path),
    YieldExpression: (path) => reject("yield expressions", path),
  });

  return unsupported;
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

function isTextExpression(
  expression: t.Expression,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
): boolean {
  if (collectStateDependencies(expression, statesByValue).length > 0) {
    return validateDerivedExpression(expression, safeGlobals) === undefined;
  }

  let supported = true;
  traverse(expressionFile(cloneExpression(expression)), {
    CallExpression(path) {
      if (!isSafeCompilerCall(path.node, safeGlobals)) {
        supported = false;
        path.stop();
      }
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

interface ConditionalBlockShape {
  test: t.Expression;
  branches: t.JSXElement[];
}

function isEmptyConditionalBranch(expression: t.Expression): boolean {
  return t.isNullLiteral(expression) || t.isBooleanLiteral(expression, { value: false });
}

function conditionalBlockShape(expression: t.Expression): ConditionalBlockShape | null {
  if (
    t.isLogicalExpression(expression, { operator: "&&" }) &&
    t.isExpression(expression.left) &&
    t.isJSXElement(expression.right)
  ) {
    return { test: expression.left, branches: [expression.right] };
  }
  if (!t.isConditionalExpression(expression)) return null;
  const branches = [expression.consequent, expression.alternate];
  if (
    !branches.every((branch) => t.isJSXElement(branch) || isEmptyConditionalBranch(branch)) ||
    !branches.some((branch) => t.isJSXElement(branch))
  ) {
    return null;
  }
  return {
    test: expression.test,
    branches: branches.filter((branch): branch is t.JSXElement => t.isJSXElement(branch)),
  };
}

function isMapCall(expression: t.Expression): expression is t.CallExpression {
  return (
    t.isCallExpression(expression) &&
    t.isMemberExpression(expression.callee) &&
    !expression.callee.computed &&
    t.isExpression(expression.callee.object) &&
    t.isIdentifier(expression.callee.property, { name: "map" })
  );
}

function returnedExpression(
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
): t.Expression | undefined {
  if (t.isExpression(callback.body)) return callback.body;
  if (callback.body.body.length !== 1 || !t.isReturnStatement(callback.body.body[0])) {
    return undefined;
  }
  const value = callback.body.body[0].argument;
  return value && t.isExpression(value) ? value : undefined;
}

function containsDirectHookCall(
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
): boolean {
  let found = false;
  traverse(expressionFile(t.cloneNode(callback, true)), {
    CallExpression(path) {
      const callee = path.node.callee;
      const name = t.isIdentifier(callee)
        ? callee.name
        : t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)
          ? callee.property.name
          : "";
      if (/^use[A-Z0-9]/.test(name)) {
        found = true;
        path.stop();
      }
    },
  });
  return found;
}

function jsxKeyExpression(element: t.JSXElement): t.Expression | undefined {
  for (const attribute of element.openingElement.attributes) {
    if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name, { name: "key" })) {
      continue;
    }
    if (t.isStringLiteral(attribute.value)) return t.stringLiteral(attribute.value.value);
    if (
      t.isJSXExpressionContainer(attribute.value) &&
      !t.isJSXEmptyExpression(attribute.value.expression)
    )
      return attribute.value.expression;
  }
  return undefined;
}

function validateKeyFunction(
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
  keyExpression: t.Expression,
  safeGlobals: ReadonlySet<string>,
): string | undefined {
  if (
    callback.async ||
    callback.generator ||
    callback.params.length < 1 ||
    callback.params.length > 2 ||
    !t.isIdentifier(callback.params[0]) ||
    (callback.params[1] !== undefined && !t.isIdentifier(callback.params[1]))
  ) {
    return "keyed list callbacks must be synchronous and use item and optional index identifiers";
  }
  const item = callback.params[0].name;
  const index = t.isIdentifier(callback.params[1]) ? callback.params[1].name : undefined;
  if (index && referencesIdentifier(keyExpression, index)) {
    return "keyed list keys cannot depend on the array index";
  }
  if (!referencesIdentifier(keyExpression, item)) {
    return "keyed list keys must depend on the mapped item";
  }
  const unsupported = validateDerivedExpression(keyExpression, safeGlobals);
  return unsupported ? `keyed list keys cannot use ${unsupported}` : undefined;
}

function isPublicListElement(element: t.JSXElement, listNames: ReadonlySet<string>): boolean {
  const name = element.openingElement.name;
  return t.isJSXIdentifier(name) && listNames.has(name.name);
}

function meaningfulJsxChildren(element: t.JSXElement): t.JSXElement["children"] {
  return element.children.filter((child) => {
    if (t.isJSXText(child)) return child.value.trim().length > 0;
    return !(t.isJSXExpressionContainer(child) && t.isJSXEmptyExpression(child.expression));
  });
}

function analyzeMapList(
  expression: t.CallExpression,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
): { dependencies?: number[]; reason?: string } {
  const callee = expression.callee as t.MemberExpression;
  const collection = callee.object as t.Expression;
  const collectionUnsupported = validateDerivedExpression(collection, safeGlobals);
  if (collectionUnsupported) {
    return { reason: `keyed list collection cannot use ${collectionUnsupported}` };
  }
  if (
    expression.arguments.length !== 1 ||
    (!t.isArrowFunctionExpression(expression.arguments[0]) &&
      !t.isFunctionExpression(expression.arguments[0]))
  ) {
    return { reason: "keyed list map must use one inline render callback" };
  }
  const callback = expression.arguments[0];
  if (containsDirectHookCall(callback)) {
    return { reason: "Hooks cannot be called directly inside a keyed list callback" };
  }
  const row = returnedExpression(callback);
  if (!row || !t.isJSXElement(row)) {
    return { reason: "keyed list map callbacks must return one React element" };
  }
  const key = jsxKeyExpression(row);
  if (!key) return { reason: "automatically compiled lists require an explicit item key" };
  const keyReason = validateKeyFunction(callback, key, safeGlobals);
  if (keyReason) return { reason: keyReason };
  return { dependencies: collectStateDependencies(expression, statesByValue) };
}

function listAttributeExpression(element: t.JSXElement, name: string): t.Expression | undefined {
  for (const attribute of element.openingElement.attributes) {
    if (
      t.isJSXAttribute(attribute) &&
      t.isJSXIdentifier(attribute.name, { name }) &&
      t.isJSXExpressionContainer(attribute.value) &&
      !t.isJSXEmptyExpression(attribute.value.expression)
    ) {
      return attribute.value.expression;
    }
  }
  return undefined;
}

function analyzePublicList(
  element: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
): { dependencies?: number[]; reason?: string } {
  if (element.openingElement.attributes.some((attribute) => t.isJSXSpreadAttribute(attribute))) {
    return { reason: "compiled List boundaries do not support JSX attribute spreads" };
  }
  const each = listAttributeExpression(element, "each");
  const by = listAttributeExpression(element, "by");
  if (!each || !by) return { reason: "List requires explicit each and by properties" };
  const collectionUnsupported = validateDerivedExpression(each, safeGlobals);
  if (collectionUnsupported) {
    return { reason: `List each cannot use ${collectionUnsupported}` };
  }
  if (!t.isArrowFunctionExpression(by) && !t.isFunctionExpression(by)) {
    return { reason: "compiled List by must use an inline key function" };
  }
  const key = returnedExpression(by);
  if (!key) return { reason: "compiled List by must return one key expression" };
  const keyReason = validateKeyFunction(by, key, safeGlobals);
  if (keyReason) return { reason: keyReason };

  const children = meaningfulJsxChildren(element);
  if (
    children.length !== 1 ||
    !t.isJSXExpressionContainer(children[0]) ||
    t.isJSXEmptyExpression(children[0].expression) ||
    (!t.isArrowFunctionExpression(children[0].expression) &&
      !t.isFunctionExpression(children[0].expression))
  ) {
    return { reason: "compiled List children must use one inline render function" };
  }
  const render = children[0].expression;
  if (!returnedExpression(render)) {
    return { reason: "compiled List children must return one React element" };
  }
  if (containsDirectHookCall(render)) {
    return { reason: "Hooks cannot be called directly inside List children" };
  }
  return { dependencies: collectStateDependencies(element, statesByValue) };
}

function keyedListBoundary(
  blockRuntime: t.Identifier,
  plan: KeyedListPlan,
  source: t.Expression,
): t.JSXElement {
  const name = t.jsxMemberExpression(
    t.jsxIdentifier(blockRuntime.name),
    t.jsxIdentifier("KeyedList"),
  );
  return t.jsxElement(
    t.jsxOpeningElement(
      name,
      [
        t.jsxAttribute(t.jsxIdentifier("id"), t.jsxExpressionContainer(t.numericLiteral(plan.id))),
        t.jsxAttribute(
          t.jsxIdentifier("render"),
          t.jsxExpressionContainer(t.arrowFunctionExpression([], cloneExpression(source))),
        ),
      ],
      true,
    ),
    null,
    [],
    true,
  );
}

function analyzeComponentIslandElement(
  element: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  allowedComponentNames: ReadonlySet<string>,
): { dependencies?: number[]; reason?: string } {
  const name = element.openingElement.name;
  if (!t.isJSXIdentifier(name) || !isComponentName(name.name)) {
    return { reason: "component islands require a direct component identifier" };
  }
  if (!allowedComponentNames.has(name.name)) {
    return {
      reason: `component island ${name.name} must reference a stable module-level component`,
    };
  }
  if (meaningfulJsxChildren(element).length > 0) {
    return { reason: `component island ${name.name} does not support children yet` };
  }

  const dependencies = new Set<number>();
  for (const attribute of element.openingElement.attributes) {
    if (t.isJSXSpreadAttribute(attribute)) {
      return { reason: `component island ${name.name} does not support JSX attribute spreads` };
    }
    const attributeName = jsxAttributeName(attribute);
    if (!attributeName) {
      return { reason: `component island ${name.name} does not support namespaced JSX attributes` };
    }
    if (attributeName === "ref" || attributeName === "key" || attributeName === "children") {
      return { reason: `component island ${name.name} does not support ${attributeName} yet` };
    }
    if (
      !t.isJSXExpressionContainer(attribute.value) ||
      t.isJSXEmptyExpression(attribute.value.expression)
    ) {
      continue;
    }

    const expression = attribute.value.expression;
    const isEventFunction =
      /^on[A-Z]/.test(attributeName) &&
      (t.isArrowFunctionExpression(expression) || t.isFunctionExpression(expression));
    if (!isEventFunction) {
      const unsupported = validateDerivedExpression(expression, safeGlobals);
      if (unsupported) {
        return {
          reason: `component island ${name.name} prop ${attributeName} cannot use ${unsupported}`,
        };
      }
    }
    collectStateDependencies(expression, statesByValue).forEach((dependency) =>
      dependencies.add(dependency),
    );
  }

  return { dependencies: [...dependencies].sort((left, right) => left - right) };
}

function componentIslandBoundary(
  blockRuntime: t.Identifier,
  plan: ComponentIslandPlan,
  source: t.JSXElement,
): t.JSXElement {
  const name = t.jsxMemberExpression(
    t.jsxIdentifier(blockRuntime.name),
    t.jsxIdentifier("Component"),
  );
  return t.jsxElement(
    t.jsxOpeningElement(
      name,
      [
        t.jsxAttribute(t.jsxIdentifier("id"), t.jsxExpressionContainer(t.numericLiteral(plan.id))),
        t.jsxAttribute(
          t.jsxIdentifier("render"),
          t.jsxExpressionContainer(t.arrowFunctionExpression([], t.cloneNode(source, true))),
        ),
      ],
      true,
    ),
    null,
    [],
    true,
  );
}

interface ComposableBlockAnalysis {
  plans?: ComposableBlockPlan[];
  componentElements?: Set<t.JSXElement>;
  conditionalExpressions?: Set<t.Expression>;
  keyedElements?: Set<t.JSXElement>;
  keyedExpressions?: Set<t.Expression>;
  reason?: string;
}

function analyzeComposableBlocks(
  root: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  listNames: ReadonlySet<string>,
  allowedComponentNames: ReadonlySet<string>,
): ComposableBlockAnalysis {
  const plans: ComposableBlockPlan[] = [];
  const componentElements = new Set<t.JSXElement>();
  const conditionalExpressions = new Set<t.Expression>();
  const keyedElements = new Set<t.JSXElement>();
  const keyedExpressions = new Set<t.Expression>();
  let nextId = 0;

  const mergeDependencies = (target: Set<number>, dependencies: Iterable<number>) => {
    for (const dependency of dependencies) target.add(dependency);
  };

  const visitHost = (
    element: t.JSXElement,
    parent: number | undefined,
    insideConditional: boolean,
  ): { dependencies: Set<number>; reason?: string } => {
    const dependencies = new Set<number>();
    if (!isHostElement(element)) {
      return {
        dependencies,
        reason: insideConditional
          ? "conditional blocks currently support host elements only"
          : "compiled trees currently support host elements only",
      };
    }

    if (insideConditional) {
      for (const attribute of element.openingElement.attributes) {
        if (t.isJSXSpreadAttribute(attribute)) {
          return {
            dependencies,
            reason: "conditional blocks do not support JSX attribute spreads",
          };
        }
        const name = jsxAttributeName(attribute);
        if (!name) {
          return {
            dependencies,
            reason: "conditional blocks do not support namespaced JSX attributes",
          };
        }
        if (name === "ref" || name === "dangerouslySetInnerHTML") {
          return {
            dependencies,
            reason: `conditional block ${name} requires React ownership`,
          };
        }
        if (
          !t.isJSXExpressionContainer(attribute.value) ||
          t.isJSXEmptyExpression(attribute.value.expression) ||
          /^on[A-Z]/.test(name)
        ) {
          continue;
        }

        const expression = attribute.value.expression;
        if (name === "style") {
          if (!t.isObjectExpression(expression)) {
            return {
              dependencies,
              reason: "conditional block styles must use one inline object literal",
            };
          }
          for (const property of expression.properties) {
            if (!t.isObjectProperty(property) || property.computed) {
              return {
                dependencies,
                reason:
                  "conditional block styles do not support spreads, methods, or computed properties",
              };
            }
            if (!t.isExpression(property.value)) {
              return {
                dependencies,
                reason: "conditional block style properties must use expression values",
              };
            }
            const unsupported = validateDerivedExpression(property.value, safeGlobals);
            if (unsupported) {
              return {
                dependencies,
                reason: `conditional block style cannot use ${unsupported}`,
              };
            }
            mergeDependencies(
              dependencies,
              collectStateDependencies(property.value, statesByValue),
            );
          }
          continue;
        }

        const unsupported = validateDerivedExpression(expression, safeGlobals);
        if (unsupported) {
          return {
            dependencies,
            reason: `conditional block attribute ${name} cannot use ${unsupported}`,
          };
        }
        mergeDependencies(dependencies, collectStateDependencies(expression, statesByValue));
      }
    }

    for (const child of element.children) {
      if (t.isJSXFragment(child)) {
        if (insideConditional) {
          return {
            dependencies,
            reason: "conditional blocks do not support fragments yet",
          };
        }
        continue;
      }

      if (t.isJSXElement(child)) {
        if (isHostElement(child)) {
          const nested = visitHost(child, parent, insideConditional);
          if (nested.reason) return { dependencies, reason: nested.reason };
          mergeDependencies(dependencies, nested.dependencies);
          continue;
        }

        if (isPublicListElement(child, listNames)) {
          const result = analyzePublicList(child, statesByValue, safeGlobals);
          if (result.reason) return { dependencies, reason: result.reason };
          const plan: KeyedListPlan = {
            kind: "keyed-list",
            id: nextId++,
            parent,
            dependencies: result.dependencies || [],
            source: child,
            syntax: "list",
          };
          plans.push(plan);
          keyedElements.add(child);
          continue;
        }

        const result = analyzeComponentIslandElement(
          child,
          statesByValue,
          safeGlobals,
          allowedComponentNames,
        );
        if (result.reason) return { dependencies, reason: result.reason };
        componentElements.add(child);
        if ((result.dependencies || []).length > 0) {
          plans.push({
            kind: "component",
            id: nextId++,
            parent,
            dependencies: result.dependencies || [],
            source: child,
          });
        }
        continue;
      }

      if (!t.isJSXExpressionContainer(child) || t.isJSXEmptyExpression(child.expression)) {
        continue;
      }

      const expression = child.expression;
      const shape = conditionalBlockShape(expression);
      if (shape) {
        const unsupported = validateDerivedExpression(shape.test, safeGlobals);
        if (unsupported) {
          return {
            dependencies,
            reason: `conditional block test cannot use ${unsupported}`,
          };
        }
        const plan: ConditionalBlockPlan = {
          kind: "conditional",
          id: nextId++,
          parent,
          dependencies: collectStateDependencies(shape.test, statesByValue),
          source: expression,
        };
        plans.push(plan);
        conditionalExpressions.add(expression);
        const ownedDependencies = new Set(plan.dependencies);
        for (const branch of shape.branches) {
          const nested = visitHost(branch, plan.id, true);
          if (nested.reason) return { dependencies, reason: nested.reason };
          mergeDependencies(ownedDependencies, nested.dependencies);
        }
        plan.dependencies = [...ownedDependencies].sort((left, right) => left - right);
        continue;
      }

      if (isMapCall(expression)) {
        const result = analyzeMapList(expression, statesByValue, safeGlobals);
        if (result.reason) return { dependencies, reason: result.reason };
        plans.push({
          kind: "keyed-list",
          id: nextId++,
          parent,
          dependencies: result.dependencies || [],
          source: expression,
          syntax: "map",
        });
        keyedExpressions.add(expression);
        continue;
      }

      if (insideConditional) {
        if (!isTextExpression(expression, statesByValue, safeGlobals)) {
          return {
            dependencies,
            reason: "conditional block children must keep one supported block or static host tree",
          };
        }
        mergeDependencies(dependencies, collectStateDependencies(expression, statesByValue));
      }
    }

    return { dependencies };
  };

  const result = visitHost(root, undefined, false);
  if (result.reason) return { reason: result.reason };
  return {
    plans,
    componentElements,
    conditionalExpressions,
    keyedElements,
    keyedExpressions,
  };
}

function conditionalBlockBoundary(
  blockRuntime: t.Identifier,
  plan: ConditionalBlockPlan,
  source: t.Expression,
): t.JSXElement {
  const name = t.jsxMemberExpression(
    t.jsxIdentifier(blockRuntime.name),
    t.jsxIdentifier("Conditional"),
  );
  return t.jsxElement(
    t.jsxOpeningElement(
      name,
      [
        t.jsxAttribute(t.jsxIdentifier("id"), t.jsxExpressionContainer(t.numericLiteral(plan.id))),
        t.jsxAttribute(
          t.jsxIdentifier("render"),
          t.jsxExpressionContainer(t.arrowFunctionExpression([], cloneExpression(source))),
        ),
      ],
      true,
    ),
    null,
    [],
    true,
  );
}

function lowerComposableBlocks(
  root: t.JSXElement,
  plans: readonly ComposableBlockPlan[],
  blockRuntime: t.Identifier,
  listNames: ReadonlySet<string>,
): t.JSXElement {
  const planBySource = new Map<t.Node, ComposableBlockPlan>(
    plans.map((plan) => [plan.source, plan]),
  );

  const visit = (element: t.JSXElement): void => {
    element.children = element.children.map((child) => {
      if (t.isJSXElement(child)) {
        const plan = planBySource.get(child);
        if (plan?.kind === "component") {
          return componentIslandBoundary(blockRuntime, plan, child);
        }
        if (plan?.kind === "keyed-list" && isPublicListElement(child, listNames)) {
          return keyedListBoundary(blockRuntime, plan, child);
        }
        if (isHostElement(child)) visit(child);
        return child;
      }
      if (!t.isJSXExpressionContainer(child) || t.isJSXEmptyExpression(child.expression)) {
        return child;
      }

      const plan = planBySource.get(child.expression);
      if (plan?.kind === "conditional") {
        const shape = conditionalBlockShape(child.expression);
        for (const branch of shape?.branches || []) visit(branch);
        return conditionalBlockBoundary(blockRuntime, plan, child.expression);
      }
      if (plan?.kind === "keyed-list") {
        return keyedListBoundary(blockRuntime, plan, child.expression);
      }
      return child;
    });
  };

  visit(root);
  return root;
}

function assignStableBindingTargets(bindings: readonly PendingBinding[]): void {
  const targetByPath = new Map<string, number>();
  for (const binding of bindings) {
    if (binding.kind === "block") continue;
    const key = binding.path.join(".");
    let target = targetByPath.get(key);
    if (target === undefined) {
      target = targetByPath.size;
      targetByPath.set(key, target);
    }
    binding.target = target;
  }
}

function lowerStableBindingTargets(
  root: t.JSXElement,
  bindings: readonly PendingBinding[],
  blockRuntime: t.Identifier,
): t.JSXElement {
  const targetByPath = new Map<string, number>();
  for (const binding of bindings) {
    if (binding.kind !== "block" && binding.target !== undefined) {
      targetByPath.set(binding.path.join("."), binding.target);
    }
  }

  const visit = (element: t.JSXElement, path: number[]): void => {
    const target = targetByPath.get(path.join("."));
    if (target !== undefined && path.length > 0) {
      element.openingElement.attributes.push(
        t.jsxAttribute(
          t.jsxIdentifier("ref"),
          t.jsxExpressionContainer(
            t.callExpression(
              t.memberExpression(t.cloneNode(blockRuntime), t.identifier("target")),
              [t.numericLiteral(target)],
            ),
          ),
        ),
      );
    }

    let elementIndex = 0;
    for (const child of element.children) {
      if (!t.isJSXElement(child) || !isHostElement(child)) continue;
      visit(child, [...path, elementIndex]);
      elementIndex += 1;
    }
  };

  visit(root, []);
  return root;
}

function analyzeHostTree(
  root: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  conditionalExpressions: ReadonlySet<t.Expression>,
  keyedExpressions: ReadonlySet<t.Expression>,
  keyedElements: ReadonlySet<t.JSXElement>,
  componentElements: ReadonlySet<t.JSXElement>,
): { bindings?: PendingBinding[]; reason?: string } {
  const bindings: PendingBinding[] = [];

  const analyzeStyle = (expression: t.Expression, path: number[]): string | undefined => {
    if (!t.isObjectExpression(expression)) {
      return "stateful style bindings must use one inline object literal";
    }
    for (const property of expression.properties) {
      if (!t.isObjectProperty(property) || property.computed) {
        return "stateful style bindings do not support spreads, methods, or computed properties";
      }
      const name = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : undefined;
      if (!name || (name.includes("-") && !name.startsWith("--"))) {
        return "stateful style property names must use camelCase or a CSS custom property";
      }
      if (!t.isExpression(property.value)) {
        return `stateful style property ${name} must use an expression value`;
      }
      const dependencies = collectStateDependencies(property.value, statesByValue);
      if (dependencies.length === 0) continue;
      const unsupported = validateDerivedExpression(property.value, safeGlobals);
      if (unsupported) return `stateful style property ${name} cannot use ${unsupported}`;
      bindings.push({
        kind: "style",
        path: [...path],
        dependencies,
        name,
        value: cloneExpression(property.value),
      });
    }
    return undefined;
  };

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
      if (name === "style") {
        const reason = analyzeStyle(expression, path);
        if (reason) return reason;
        continue;
      }
      if (name === "children" || name === "key") {
        return `stateful ${name} bindings are not supported yet`;
      }
      const unsupported = validateDerivedExpression(expression, safeGlobals);
      if (unsupported) return `stateful ${name} binding cannot use ${unsupported}`;
      bindings.push({
        kind: "attribute",
        path: [...path],
        dependencies,
        name,
        value: cloneExpression(expression),
      });
    }

    const nestedElements = element.children.filter(
      (child): child is t.JSXElement =>
        t.isJSXElement(child) && isHostElement(child) && !keyedElements.has(child),
    );
    const expressionChildren = element.children.filter((child): child is t.JSXExpressionContainer =>
      t.isJSXExpressionContainer(child),
    );
    for (const child of expressionChildren) {
      if (t.isJSXEmptyExpression(child.expression)) continue;
      if (conditionalExpressions.has(child.expression)) continue;
      if (keyedExpressions.has(child.expression)) continue;
      if (!isTextExpression(child.expression, statesByValue, safeGlobals)) {
        return "dynamic child structures require React reconciliation";
      }
    }

    const hasKeyedElement = element.children.some(
      (child) => t.isJSXElement(child) && keyedElements.has(child),
    );
    const hasComponentElement = element.children.some(
      (child) => t.isJSXElement(child) && componentElements.has(child),
    );
    const hasDynamicBlocks =
      hasKeyedElement ||
      hasComponentElement ||
      expressionChildren.some(
        (child) =>
          !t.isJSXEmptyExpression(child.expression) &&
          (conditionalExpressions.has(child.expression) || keyedExpressions.has(child.expression)),
      );
    if (nestedElements.length === 0 && !hasDynamicBlocks) {
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
          !conditionalExpressions.has(child.expression) &&
          !keyedExpressions.has(child.expression) &&
          collectStateDependencies(child.expression, statesByValue).length > 0
        ) {
          return "mixed element and stateful text children are not supported yet";
        }
      }
      let elementIndex = 0;
      for (const child of element.children) {
        if (!t.isJSXElement(child) || !isHostElement(child) || keyedElements.has(child)) continue;
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

function analyzePropsParameter(
  path: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
): PropsPlan | string {
  const parameter = path.node.params[0];
  if (!parameter) {
    return {
      definitionParameter: path.scope.generateUidIdentifier("props"),
      destructuredNames: new Set(),
    };
  }
  if (t.isIdentifier(parameter)) {
    return {
      definitionParameter: t.cloneNode(parameter, true) as t.Identifier,
      wrapperProps: t.cloneNode(parameter, true) as t.Identifier,
      destructuredNames: new Set(),
    };
  }
  if (!t.isObjectPattern(parameter)) {
    return "components must use zero parameters, one props identifier, or flat object props destructuring";
  }

  const localNames = new Set<string>();
  for (const property of parameter.properties) {
    if (t.isRestElement(property)) {
      return "rest properties in component props destructuring are not supported yet";
    }
    if (property.computed) {
      return "computed component props destructuring is not supported yet";
    }
    let local: t.Identifier | undefined;
    if (t.isIdentifier(property.value)) {
      local = property.value;
    } else if (t.isAssignmentPattern(property.value) && t.isIdentifier(property.value.left)) {
      local = property.value.left;
    }
    if (!local) {
      return "nested component props destructuring is not supported yet";
    }
    if (localNames.has(local.name)) {
      return "component props destructuring local names must be unique";
    }
    localNames.add(local.name);
  }

  const definitionParameter = path.scope.generateUidIdentifier("props");
  return {
    definitionParameter,
    wrapperProps: t.objectExpression(
      [...localNames].map((name) =>
        t.objectProperty(t.identifier(name), t.identifier(name), false, true),
      ),
    ),
    destructuredNames: localNames,
  };
}

function bindingObject(
  binding: PendingBinding,
  propsParameter: t.Identifier,
  stateParameter: t.Identifier,
  statesByValue: ReadonlyMap<string, StateBinding>,
  statesBySetter: ReadonlyMap<string, StateBinding>,
): t.ObjectExpression {
  const properties: t.ObjectProperty[] = [
    t.objectProperty(t.identifier("kind"), t.stringLiteral(binding.kind)),
    t.objectProperty(
      t.identifier("dependencies"),
      t.arrayExpression(binding.dependencies.map((part) => t.numericLiteral(part))),
    ),
  ];
  if (binding.kind === "block") {
    properties.push(t.objectProperty(t.identifier("id"), t.numericLiteral(binding.id)));
    if (binding.parent !== undefined) {
      properties.push(t.objectProperty(t.identifier("parent"), t.numericLiteral(binding.parent)));
    }
    return t.objectExpression(properties);
  }
  properties.splice(
    1,
    0,
    t.objectProperty(
      t.identifier("path"),
      t.arrayExpression(binding.path.map((part) => t.numericLiteral(part))),
    ),
  );
  if (binding.target !== undefined) {
    properties.splice(
      2,
      0,
      t.objectProperty(t.identifier("target"), t.numericLiteral(binding.target)),
    );
  }
  if (binding.name)
    properties.push(t.objectProperty(t.identifier("name"), t.stringLiteral(binding.name)));
  properties.push(
    t.objectProperty(
      t.identifier("read"),
      t.arrowFunctionExpression(
        [t.cloneNode(propsParameter), t.cloneNode(stateParameter)],
        rewriteStateAccess(binding.value, stateParameter, statesByValue, statesBySetter),
      ),
    ),
  );
  return t.objectExpression(properties);
}

function wrapperElement(definitionIdentifier: t.Identifier, props?: t.Expression): t.JSXElement {
  const name = t.jsxIdentifier(definitionIdentifier.name);
  const attributes = props ? [t.jsxSpreadAttribute(t.cloneNode(props))] : [];
  return t.jsxElement(t.jsxOpeningElement(name, attributes, true), null, [], true);
}

function compileCandidate(
  candidate: Candidate,
  createComponentIdentifier: t.Identifier,
  useStateNames: ReadonlySet<string>,
  reactNames: ReadonlySet<string>,
  listNames: ReadonlySet<string>,
  moduleId: string,
): string | undefined {
  const { path, name, statementPath } = candidate;
  if (path.node.async || path.node.generator)
    return "async and generator components are not supported";
  if (path.node.typeParameters) return "generic components are not supported yet";
  if (path.node.params.length > 1) return "components must use at most one props parameter";
  const propsPlan = analyzePropsParameter(path);
  if (typeof propsPlan === "string") return propsPlan;
  if (!t.isBlockStatement(path.node.body)) return "components must use a block body";
  const safeGlobals = new Set(
    [...SAFE_GLOBAL_CALLS, "Math"].filter((name) => !path.scope.getBinding(name)),
  );

  const states: StateBinding[] = [];
  const locals: LocalBinding[] = [];
  let returned: t.ReturnStatement | undefined;
  for (const statement of path.node.body.body) {
    if (t.isReturnStatement(statement)) {
      if (returned) return "components must have one unconditional return";
      returned = statement;
      continue;
    }
    if (t.isFunctionDeclaration(statement)) {
      if (!statement.id) return "named event handler declarations must have a name";
      if (statement.async || statement.generator || statement.typeParameters) {
        return `event handler ${statement.id.name} must be synchronous and non-generic`;
      }
      locals.push({
        kind: "handler",
        name: statement.id.name,
        value: t.toExpression(t.cloneNode(statement, true)) as t.FunctionExpression,
      });
      continue;
    }
    if (
      !t.isVariableDeclaration(statement) ||
      statement.kind !== "const" ||
      statement.declarations.length !== 1
    ) {
      return "only top-level useState declarations, pure derived const values, named synchronous handlers, and one return are supported by the current compiler";
    }
    const declaration = statement.declarations[0];
    if (t.isArrayPattern(declaration.id)) {
      if (
        declaration.id.elements.length !== 2 ||
        !t.isIdentifier(declaration.id.elements[0]) ||
        !t.isIdentifier(declaration.id.elements[1]) ||
        !isUseStateCall(declaration.init, useStateNames, reactNames) ||
        declaration.init.arguments.length > 1 ||
        (declaration.init.arguments[0] && !t.isExpression(declaration.init.arguments[0]))
      ) {
        return "only const [value, setValue] = useState(initial) state declarations are supported";
      }
      if (locals.length > 0) {
        return "useState declarations must appear before derived local values and event handlers";
      }
      states.push({
        valueName: declaration.id.elements[0].name,
        setterName: declaration.id.elements[1].name,
        index: states.length,
        initialValue: declaration.init.arguments[0] as t.Expression | undefined,
      });
      continue;
    }
    if (!t.isIdentifier(declaration.id) || !t.isExpression(declaration.init)) {
      return "derived const values and event handlers must use one identifier and one expression";
    }
    if (t.isArrowFunctionExpression(declaration.init) || t.isFunctionExpression(declaration.init)) {
      if (declaration.init.async || declaration.init.generator) {
        return `event handler ${declaration.id.name} must be synchronous`;
      }
      locals.push({ kind: "handler", name: declaration.id.name, value: declaration.init });
    } else {
      locals.push({ kind: "derived", name: declaration.id.name, value: declaration.init });
    }
  }

  if (states.length === 0) return "no local useState binding was found";
  if (!returned?.argument || !t.isJSXElement(returned.argument)) {
    return "the component must return one host JSX element";
  }

  const statesByValue = new Map(states.map((state) => [state.valueName, state]));
  const statesBySetter = new Map(states.map((state) => [state.setterName, state]));
  const localNames = new Set(locals.map((binding) => binding.name));
  if (localNames.size !== locals.length) return "local binding names must be unique";
  for (const state of states) {
    if (
      state.initialValue &&
      (collectStateDependencies(state.initialValue, statesByValue).length > 0 ||
        collectReferencedLocals(state.initialValue, localNames).length > 0 ||
        [...statesBySetter].some(([setterName]) =>
          referencesIdentifier(state.initialValue!, setterName),
        ))
    ) {
      return "useState initializers cannot reference another local binding";
    }
  }
  const derivedByName = new Map<string, t.Expression>();
  const handlersByName = new Map<string, HandlerBinding>();
  for (const binding of locals) {
    const forwardReferences = collectReferencedLocals(binding.value, localNames).filter(
      (reference) => !derivedByName.has(reference),
    );
    if (forwardReferences.length > 0) {
      return `${binding.kind === "handler" ? "event handler" : "derived local"} ${binding.name} can only reference earlier derived local values`;
    }
    const expanded = rewriteDerivedAccess(binding.value, derivedByName);
    if (binding.kind === "handler") {
      handlersByName.set(binding.name, {
        name: binding.name,
        value: expanded as t.ArrowFunctionExpression | t.FunctionExpression,
      });
      continue;
    }
    const unsupported = validateDerivedExpression(expanded, safeGlobals);
    if (unsupported) {
      return `derived local ${binding.name} cannot use ${unsupported}`;
    }
    derivedByName.set(binding.name, expanded);
  }
  const rootWithDerived = rewriteDerivedAccess(returned.argument, derivedByName) as t.JSXElement;
  const handlerRewrite = rewriteHandlerAccess(rootWithDerived, handlersByName);
  if (handlerRewrite.reason) return handlerRewrite.reason;
  if (!handlerRewrite.root) return "event handlers could not be prepared safely";
  const expandedRoot = rewriteDestructuredPropAccess(
    handlerRewrite.root,
    propsPlan.destructuredNames,
    propsPlan.definitionParameter,
  );
  const setterReason = validateSetterUsage(expandedRoot, statesBySetter);
  if (setterReason) return setterReason;
  const referencedComponentNames = new Set<string>();
  traverse(expressionFile(t.cloneNode(expandedRoot, true)), {
    JSXOpeningElement(componentPath) {
      const componentName = componentPath.node.name;
      if (t.isJSXIdentifier(componentName) && isComponentName(componentName.name)) {
        referencedComponentNames.add(componentName.name);
      }
    },
  });
  const allowedComponentNames = new Set(
    [...referencedComponentNames].filter((componentName) => {
      if (listNames.has(componentName)) return false;
      const binding = path.scope.getBinding(componentName);
      return Boolean(
        binding?.constant &&
        binding.scope.path.isProgram() &&
        binding.kind !== "let" &&
        binding.kind !== "var",
      );
    }),
  );
  const blockAnalysis = analyzeComposableBlocks(
    expandedRoot,
    statesByValue,
    safeGlobals,
    listNames,
    allowedComponentNames,
  );
  if (blockAnalysis.reason) return blockAnalysis.reason;
  const blockPlans = blockAnalysis.plans || [];
  const analysis = analyzeHostTree(
    expandedRoot,
    statesByValue,
    safeGlobals,
    blockAnalysis.conditionalExpressions || new Set<t.Expression>(),
    blockAnalysis.keyedExpressions || new Set<t.Expression>(),
    blockAnalysis.keyedElements || new Set<t.JSXElement>(),
    blockAnalysis.componentElements || new Set<t.JSXElement>(),
  );
  if (analysis.reason) return analysis.reason;
  assignStableBindingTargets(analysis.bindings || []);

  const stateParameter = path.scope.generateUidIdentifier("farmState");
  const blockParameter = path.scope.generateUidIdentifier("farmBlocks");
  const definitionIdentifier = path.scope.generateUidIdentifier(`${name}Compiled`);
  const propsParameter = propsPlan.definitionParameter;
  const rootWithTargets = lowerStableBindingTargets(
    expandedRoot,
    analysis.bindings || [],
    blockParameter,
  );
  const rootWithBlocks = lowerComposableBlocks(
    rootWithTargets,
    blockPlans,
    blockParameter,
    listNames,
  );
  const rewrittenRoot = rewriteStateAccess(
    rootWithBlocks,
    stateParameter,
    statesByValue,
    statesBySetter,
  ) as t.JSXElement;
  const definition = t.callExpression(t.cloneNode(createComponentIdentifier), [
    t.objectExpression([
      t.objectProperty(t.identifier("displayName"), t.stringLiteral(name)),
      t.spreadElement(
        t.conditionalExpression(
          t.memberExpression(
            t.metaProperty(t.identifier("import"), t.identifier("meta")),
            t.identifier("hot"),
          ),
          t.objectExpression([
            t.objectProperty(t.identifier("hmrId"), t.stringLiteral(`${moduleId}#${name}`)),
            t.objectProperty(
              t.identifier("stateSignature"),
              t.stringLiteral(String(states.length)),
            ),
          ]),
          t.objectExpression([]),
        ),
      ),
      t.objectProperty(
        t.identifier("initialize"),
        t.arrowFunctionExpression(
          [t.cloneNode(propsParameter)],
          t.arrayExpression(
            states.map((state) =>
              lazyInitialValue(
                state.initialValue
                  ? rewriteDestructuredPropAccess(
                      state.initialValue,
                      propsPlan.destructuredNames,
                      propsParameter,
                    )
                  : undefined,
              ),
            ),
          ),
        ),
      ),
      t.objectProperty(
        t.identifier("render"),
        t.arrowFunctionExpression(
          [t.cloneNode(propsParameter), t.cloneNode(stateParameter), t.cloneNode(blockParameter)],
          rewrittenRoot,
        ),
      ),
      t.objectProperty(
        t.identifier("bindings"),
        t.arrayExpression(
          [
            ...(analysis.bindings || []),
            ...blockPlans.map((block) => ({
              kind: "block" as const,
              id: block.id,
              parent: block.parent,
              dependencies: block.dependencies,
            })),
          ].map((binding) =>
            bindingObject(binding, propsParameter, stateParameter, statesByValue, statesBySetter),
          ),
        ),
      ),
    ]),
  ]);

  path
    .get("body")
    .replaceWith(
      t.blockStatement([
        t.returnStatement(wrapperElement(definitionIdentifier, propsPlan.wrapperProps)),
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
        const listNames = new Set<string>();
        for (const statement of programPath.node.body) {
          if (!t.isImportDeclaration(statement)) continue;
          if (statement.source.value === "@farm.js/react/list") {
            for (const specifier of statement.specifiers) {
              if (
                t.isImportSpecifier(specifier) &&
                t.isIdentifier(specifier.imported, { name: "List" })
              ) {
                listNames.add(specifier.local.name);
              }
            }
            continue;
          }
          if (statement.source.value !== "react") continue;
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
            listNames,
            id,
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
