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

interface PropBinding {
  localName: string;
  valueName: string;
  index: number;
}

interface PendingDomBinding {
  kind: "text" | "attribute" | "style";
  tracking?: "dynamic";
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

interface PendingKeyedRowBinding {
  kind: "text" | "attribute" | "style";
  path: number[];
  name?: string;
  dependencies?: number[];
  value: t.Expression;
}

interface PendingStaticRangeBinding extends PendingKeyedRowBinding {
  /** Static segment before range N, or the trailing segment at ranges.length. */
  segment: number;
  /** Direct host sibling inside the static segment. */
  sibling: number;
}

interface PendingKeyedRowEvent {
  id: number;
  path: number[];
  name: string;
  value: t.ArrowFunctionExpression | t.FunctionExpression;
}

interface PendingKeyedRowConditional {
  id: number;
  path: number[];
  test: t.Expression;
  logical: boolean;
  truthy?: t.JSXElement;
  falsy?: t.JSXElement;
  truthyBindings: PendingKeyedRowBinding[];
  falsyBindings: PendingKeyedRowBinding[];
}

interface HostConditionalPlan {
  kind: "host-conditional";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.JSXElement;
  test: t.Expression;
  logical: boolean;
  truthy?: t.JSXElement;
  falsy?: t.JSXElement;
  truthyBindings: PendingKeyedRowBinding[];
  falsyBindings: PendingKeyedRowBinding[];
  descriptorBlocks?: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>;
  nestedPlans?: HostDescriptorBlockPlan[];
}

interface ConditionalRangePlan {
  before: number;
  source: t.Expression;
  test: t.Expression;
  logical: boolean;
  truthy?: t.JSXElement;
  falsy?: t.JSXElement;
  truthyBindings: PendingKeyedRowBinding[];
  falsyBindings: PendingKeyedRowBinding[];
}

interface ConditionalRangesPlan {
  kind: "conditional-ranges";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.JSXElement;
  ranges: ConditionalRangePlan[];
  trailing: number;
  staticBindings: PendingStaticRangeBinding[];
  descriptorBlocks?: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>;
}

interface KeyedRowsPlan {
  kind: "keyed-rows";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.JSXElement;
  collection: t.Expression;
  structureDependencies: number[];
  keyCallback: t.ArrowFunctionExpression | t.FunctionExpression;
  renderCallback: t.ArrowFunctionExpression | t.FunctionExpression;
  row: t.JSXElement;
  bindings: PendingKeyedRowBinding[];
  events: PendingKeyedRowEvent[];
  conditionals: PendingKeyedRowConditional[];
  descriptorBlocks?: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>;
  syntax: "map" | "list";
}

const DELEGATABLE_KEYED_ROW_EVENTS = new Set([
  "onBeforeInput",
  "onBlur",
  "onChange",
  "onClick",
  "onCompositionEnd",
  "onCompositionStart",
  "onCompositionUpdate",
  "onContextMenu",
  "onCopy",
  "onCut",
  "onDoubleClick",
  "onDrag",
  "onDragEnd",
  "onDragEnter",
  "onDragExit",
  "onDragLeave",
  "onDragOver",
  "onDragStart",
  "onDrop",
  "onFocus",
  "onInput",
  "onKeyDown",
  "onKeyPress",
  "onKeyUp",
  "onMouseDown",
  "onMouseMove",
  "onMouseOut",
  "onMouseOver",
  "onMouseUp",
  "onPaste",
  "onPointerCancel",
  "onPointerDown",
  "onPointerMove",
  "onPointerOut",
  "onPointerOver",
  "onPointerUp",
  "onReset",
  "onSubmit",
  "onTouchCancel",
  "onTouchEnd",
  "onTouchMove",
  "onTouchStart",
  "onWheel",
]);

function canDelegateKeyedRowEvents(plan: KeyedRowsPlan): boolean {
  if (plan.events.length === 0 || plan.conditionals.length > 0) return false;
  if (
    plan.source.openingElement.attributes.some(
      (attribute) =>
        t.isJSXAttribute(attribute) &&
        t.isJSXIdentifier(attribute.name) &&
        /^on[A-Z]/.test(attribute.name.name),
    )
  ) {
    return false;
  }
  return plan.events.every((event) =>
    DELEGATABLE_KEYED_ROW_EVENTS.has(event.name.replace(/Capture$/, "")),
  );
}

interface KeyedRangePlan {
  before: number;
  source: t.Expression | t.JSXElement;
  collection: t.Expression;
  keyCallback: t.ArrowFunctionExpression | t.FunctionExpression;
  renderCallback: t.ArrowFunctionExpression | t.FunctionExpression;
  row: t.JSXElement;
  bindings: PendingKeyedRowBinding[];
  syntax: "map" | "list";
}

interface KeyedRangesPlan {
  kind: "keyed-ranges";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.JSXElement;
  ranges: KeyedRangePlan[];
  trailing: number;
  staticBindings: PendingStaticRangeBinding[];
}

type MixedRangePlan =
  | ({ rangeKind: "conditional" } & ConditionalRangePlan)
  | ({ rangeKind: "keyed" } & KeyedRangePlan);

interface MixedRangesPlan {
  kind: "mixed-ranges";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.JSXElement;
  ranges: MixedRangePlan[];
  trailing: number;
  staticBindings: PendingStaticRangeBinding[];
  descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>;
}

interface NestedHostConditionalRangesPlan {
  kind: "nested-host-conditional-ranges";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.JSXElement;
  ranges: ConditionalRangePlan[];
  trailing: number;
  staticBindings: PendingStaticRangeBinding[];
}

interface NestedHostKeyedRangesPlan {
  kind: "nested-host-keyed-ranges";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.JSXElement;
  ranges: KeyedRangePlan[];
  trailing: number;
  staticBindings: PendingStaticRangeBinding[];
}

interface NestedHostMixedRangesPlan {
  kind: "nested-host-mixed-ranges";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.JSXElement;
  ranges: MixedRangePlan[];
  trailing: number;
  staticBindings: PendingStaticRangeBinding[];
}

type HostDescriptorBlockPlan =
  | NestedHostConditionalRangesPlan
  | NestedHostKeyedRangesPlan
  | NestedHostMixedRangesPlan;

interface ComponentIslandPlan {
  kind: "component";
  id: number;
  parent?: number;
  dependencies: number[];
  source: t.JSXElement;
}

type ComposableBlockPlan =
  | ConditionalBlockPlan
  | HostConditionalPlan
  | ConditionalRangesPlan
  | KeyedListPlan
  | KeyedRowsPlan
  | KeyedRangesPlan
  | MixedRangesPlan
  | NestedHostConditionalRangesPlan
  | NestedHostKeyedRangesPlan
  | NestedHostMixedRangesPlan
  | ComponentIslandPlan;

type CompilerRuntimeFeatureName =
  | "conditional"
  | "host-conditional"
  | "conditional-ranges"
  | "keyed-list"
  | "keyed-rows"
  | "keyed-rows-conditional"
  | "keyed-rows-host"
  | "keyed-rows-complete"
  | "keyed-ranges"
  | "mixed-ranges"
  | "component";

const COMPILER_RUNTIME_FEATURE_EXPORTS: Record<CompilerRuntimeFeatureName, string> = {
  conditional: "conditionalRuntimeFeature",
  "host-conditional": "hostConditionalRuntimeFeature",
  "conditional-ranges": "conditionalRangesRuntimeFeature",
  "keyed-list": "keyedListRuntimeFeature",
  "keyed-rows": "keyedRowsRuntimeFeature",
  "keyed-rows-conditional": "keyedRowsConditionalRuntimeFeature",
  "keyed-rows-host": "keyedRowsHostRuntimeFeature",
  "keyed-rows-complete": "keyedRowsCompleteRuntimeFeature",
  "keyed-ranges": "keyedRangesRuntimeFeature",
  "mixed-ranges": "mixedRangesRuntimeFeature",
  component: "componentRuntimeFeature",
};

function runtimeFeaturesForPlans(
  plans: readonly ComposableBlockPlan[],
): CompilerRuntimeFeatureName[] {
  const features = new Set<CompilerRuntimeFeatureName>();
  let keyedRowsHaveConditionals = false;
  let keyedRowsHaveHostBlocks = false;
  for (const plan of plans) {
    if (plan.kind === "keyed-rows") {
      keyedRowsHaveConditionals ||= plan.conditionals.length > 0;
      keyedRowsHaveHostBlocks ||= Boolean(plan.descriptorBlocks?.size);
      continue;
    }
    if (plan.kind in COMPILER_RUNTIME_FEATURE_EXPORTS) {
      features.add(plan.kind as CompilerRuntimeFeatureName);
    }
  }
  if (plans.some((plan) => plan.kind === "keyed-rows")) {
    features.add(
      keyedRowsHaveConditionals && keyedRowsHaveHostBlocks
        ? "keyed-rows-complete"
        : keyedRowsHaveConditionals
          ? "keyed-rows-conditional"
          : keyedRowsHaveHostBlocks
            ? "keyed-rows-host"
            : "keyed-rows",
    );
  }
  return [...features].sort();
}

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

function collectDestructuredPropNames(
  expression: t.Expression,
  names: ReadonlySet<string>,
  propsParameter: t.Identifier,
): Set<string> {
  const referenced = new Set<string>();
  if (names.size === 0) return referenced;
  traverse(expressionFile(cloneExpression(expression)), {
    MemberExpression(path) {
      const { object, property, computed } = path.node;
      if (
        computed ||
        !t.isIdentifier(object, { name: propsParameter.name }) ||
        !t.isIdentifier(property) ||
        !names.has(property.name)
      ) {
        return;
      }
      referenced.add(property.name);
    },
  });
  return referenced;
}

function rewriteTrackedPropAccess<T extends t.Expression>(
  expression: T,
  propsParameter: t.Identifier,
  bindingsByName: ReadonlyMap<string, PropBinding>,
): T {
  if (bindingsByName.size === 0) return cloneExpression(expression);
  const file = expressionFile(cloneExpression(expression));
  traverse(file, {
    MemberExpression(path) {
      const { object, property, computed } = path.node;
      if (
        computed ||
        !t.isIdentifier(object, { name: propsParameter.name }) ||
        !t.isIdentifier(property)
      ) {
        return;
      }
      const binding = bindingsByName.get(property.name);
      if (!binding) return;
      path.replaceWith(t.identifier(binding.valueName));
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

function jsxAttribute(element: t.JSXElement, name: string): t.JSXAttribute | undefined {
  return element.openingElement.attributes.find(
    (attribute): attribute is t.JSXAttribute =>
      t.isJSXAttribute(attribute) && jsxAttributeName(attribute) === name,
  );
}

function staticJsxAttributeString(attribute: t.JSXAttribute | undefined): string | undefined {
  if (!attribute?.value) return attribute ? "" : undefined;
  if (t.isStringLiteral(attribute.value)) return attribute.value.value;
  if (
    t.isJSXExpressionContainer(attribute.value) &&
    t.isStringLiteral(attribute.value.expression)
  ) {
    return attribute.value.expression.value;
  }
  return undefined;
}

function controlledSelectHasDynamicOptions(element: t.JSXElement): boolean {
  let dynamic = false;
  t.traverseFast(element, (node) => {
    if (dynamic || !t.isJSXElement(node)) return;
    const tag = node.openingElement.name;
    if (!t.isJSXIdentifier(tag) || (tag.name !== "option" && tag.name !== "optgroup")) return;
    dynamic = node.openingElement.attributes.some(
      (attribute) =>
        t.isJSXSpreadAttribute(attribute) ||
        (t.isJSXAttribute(attribute) &&
          t.isJSXExpressionContainer(attribute.value) &&
          !t.isJSXEmptyExpression(attribute.value.expression)),
    );
  });
  return dynamic;
}

interface ConditionalBlockShape {
  test: t.Expression;
  logical: boolean;
  truthy?: t.JSXElement;
  falsy?: t.JSXElement;
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
    return {
      test: expression.left,
      logical: true,
      truthy: expression.right,
      branches: [expression.right],
    };
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
    logical: false,
    truthy: t.isJSXElement(expression.consequent) ? expression.consequent : undefined,
    falsy: t.isJSXElement(expression.alternate) ? expression.alternate : undefined,
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

const SAFE_COLLECTION_PIPELINE_METHODS = new Set(["filter", "slice", "toReversed", "toSorted"]);

function collectionPipelineMethod(expression: t.Expression): string | undefined {
  if (
    !t.isCallExpression(expression) ||
    !t.isMemberExpression(expression.callee) ||
    expression.callee.computed ||
    !t.isExpression(expression.callee.object) ||
    !t.isIdentifier(expression.callee.property)
  ) {
    return undefined;
  }
  return SAFE_COLLECTION_PIPELINE_METHODS.has(expression.callee.property.name)
    ? expression.callee.property.name
    : undefined;
}

function validateCollectionCallback(
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
  method: "filter" | "toSorted",
  safeGlobals: ReadonlySet<string>,
): string | undefined {
  const expectedParameters = method === "filter" ? "one item and an optional index" : "two items";
  const validParameterCount =
    method === "filter"
      ? callback.params.length >= 1 && callback.params.length <= 2
      : callback.params.length === 2;
  if (
    callback.async ||
    callback.generator ||
    !validParameterCount ||
    callback.params.some((parameter) => !t.isIdentifier(parameter))
  ) {
    return `${method} callbacks must be synchronous and use ${expectedParameters}`;
  }
  if (containsDirectHookCall(callback)) {
    return `Hooks cannot be called inside a ${method} callback`;
  }
  const value = returnedExpression(callback);
  if (!value) return `${method} callbacks must return one expression`;
  const unsupported = validateDerivedExpression(value, safeGlobals);
  return unsupported ? `${method} callbacks cannot use ${unsupported}` : undefined;
}

function validateCollectionPipeline(
  expression: t.Expression,
  safeGlobals: ReadonlySet<string>,
): string | undefined {
  const method = collectionPipelineMethod(expression);
  if (!method || !t.isCallExpression(expression)) {
    return validateDerivedExpression(expression, safeGlobals);
  }

  const source = (expression.callee as t.MemberExpression).object as t.Expression;
  const sourceUnsupported = collectionPipelineMethod(source)
    ? validateCollectionPipeline(source, safeGlobals)
    : validateDerivedExpression(source, safeGlobals);
  if (sourceUnsupported) return sourceUnsupported;

  if (method === "filter") {
    if (
      expression.arguments.length !== 1 ||
      (!t.isArrowFunctionExpression(expression.arguments[0]) &&
        !t.isFunctionExpression(expression.arguments[0]))
    ) {
      return "filter requires one inline callback";
    }
    return validateCollectionCallback(expression.arguments[0], "filter", safeGlobals);
  }

  if (method === "toSorted") {
    if (expression.arguments.length === 0) return undefined;
    if (
      expression.arguments.length !== 1 ||
      (!t.isArrowFunctionExpression(expression.arguments[0]) &&
        !t.isFunctionExpression(expression.arguments[0]))
    ) {
      return "toSorted requires an optional inline comparator";
    }
    return validateCollectionCallback(expression.arguments[0], "toSorted", safeGlobals);
  }

  const maximumArguments = method === "slice" ? 2 : 0;
  if (expression.arguments.length > maximumArguments) {
    return `${method} accepts at most ${maximumArguments} compiler-safe arguments`;
  }
  for (const argument of expression.arguments) {
    if (!t.isExpression(argument)) return `${method} does not support spread arguments`;
    const unsupported = validateDerivedExpression(argument, safeGlobals);
    if (unsupported) return `${method} arguments cannot use ${unsupported}`;
  }
  return undefined;
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
  const collectionUnsupported = validateCollectionPipeline(collection, safeGlobals);
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
  const collectionUnsupported = validateCollectionPipeline(each, safeGlobals);
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

interface KeyedRowsShape {
  collection: t.Expression;
  structureDependencies: number[];
  keyCallback: t.ArrowFunctionExpression | t.FunctionExpression;
  renderCallback: t.ArrowFunctionExpression | t.FunctionExpression;
  row: t.JSXElement;
  dependencies: number[];
  bindings: PendingKeyedRowBinding[];
  events: PendingKeyedRowEvent[];
  conditionals: PendingKeyedRowConditional[];
  rowReason?: string;
  syntax: "map" | "list";
}

function validateKeyedRowEventHandler(
  handler: t.ArrowFunctionExpression | t.FunctionExpression,
): string | undefined {
  let reason: string | undefined;
  traverse(expressionFile(t.cloneNode(handler, true)), {
    MetaProperty(path) {
      reason = "meta properties";
      path.stop();
    },
    ReferencedIdentifier(path) {
      if (path.node.name !== "arguments") return;
      reason = "arguments access";
      path.stop();
    },
    Super(path) {
      reason = "super access";
      path.stop();
    },
    ThisExpression(path) {
      reason = "this access";
      path.stop();
    },
  });
  return reason;
}

function stabilizeDeferredEventCurrentTarget(
  handler: t.ArrowFunctionExpression | t.FunctionExpression,
  compilerSetters: ReadonlySet<string>,
): t.ArrowFunctionExpression | t.FunctionExpression {
  const cloned = t.cloneNode(handler, true);
  const eventParameter = cloned.params[0];
  if (!t.isIdentifier(eventParameter) || compilerSetters.size === 0) return cloned;
  const file = expressionFile(cloned);
  const expression = (file.program.body[0] as t.ExpressionStatement).expression;
  if (!t.isArrowFunctionExpression(expression) && !t.isFunctionExpression(expression)) {
    return cloned;
  }
  const rootBindingIdentifier = expression.params[0];
  const snapshots: Array<{ identifier: t.Identifier; value: t.Expression }> = [];
  const snapshotsByProperty = new Map<string, t.Identifier>();
  const replaceCurrentTarget = (
    path: NodePath<t.MemberExpression | t.OptionalMemberExpression>,
  ) => {
    const property = path.node.property;
    const isCurrentTarget = path.node.computed
      ? t.isStringLiteral(property, { value: "currentTarget" })
      : t.isIdentifier(property, { name: "currentTarget" });
    if (!isCurrentTarget || !t.isIdentifier(path.node.object, { name: eventParameter.name }))
      return;
    const binding = path.scope.getBinding(eventParameter.name);
    if (!binding || binding.identifier !== rootBindingIdentifier) return;
    const setterCall = path.findParent(
      (parent) =>
        parent.isCallExpression() &&
        t.isIdentifier(parent.node.callee) &&
        compilerSetters.has(parent.node.callee.name),
    );
    if (!setterCall) return;
    const deferredFunction = path.findParent(
      (parent) => parent.isFunction() && parent.node !== expression,
    );
    if (!deferredFunction || !deferredFunction.findParent((parent) => parent === setterCall))
      return;

    const parent = path.parentPath;
    const propertyRead =
      (parent?.isMemberExpression() || parent?.isOptionalMemberExpression()) &&
      parent.node.object === path.node
        ? parent
        : path;
    const snapshotProperty =
      propertyRead === path
        ? "element"
        : propertyRead.node.computed
          ? t.isStringLiteral(propertyRead.node.property)
            ? propertyRead.node.property.value
            : `computed${snapshots.length}`
          : t.isIdentifier(propertyRead.node.property)
            ? propertyRead.node.property.name
            : `property${snapshots.length}`;
    let snapshot = snapshotsByProperty.get(snapshotProperty);
    if (!snapshot) {
      const suffix = snapshotProperty
        .replace(/[^A-Za-z0-9_$]/g, " ")
        .replace(/(?:^|\s+)([A-Za-z0-9_$])/g, (_match, character: string) =>
          character.toUpperCase(),
        )
        .replace(/\s/g, "");
      snapshot = uniqueLocalIdentifier(`_farmCurrentTarget${suffix}`, [
        expression,
        ...snapshots.map((entry) => entry.identifier),
      ]);
      snapshotsByProperty.set(snapshotProperty, snapshot);
      snapshots.push({
        identifier: snapshot,
        value: t.cloneNode(propertyRead.node, true) as t.Expression,
      });
    }
    propertyRead.replaceWith(t.cloneNode(snapshot));
    propertyRead.skip();
  };
  traverse(file, {
    MemberExpression: replaceCurrentTarget,
    OptionalMemberExpression: replaceCurrentTarget,
  });
  if (snapshots.length === 0) return expression;

  const declarations = snapshots.map(({ identifier, value }) =>
    t.variableDeclaration("const", [t.variableDeclarator(t.cloneNode(identifier), value)]),
  );
  if (t.isBlockStatement(expression.body)) {
    expression.body.body.unshift(...declarations);
  } else {
    expression.body = t.blockStatement([...declarations, t.returnStatement(expression.body)]);
  }
  return expression;
}

function stabilizeDeferredEventCurrentTargets(
  root: t.JSXElement,
  compilerSetters: ReadonlySet<string>,
): t.JSXElement {
  const file = expressionFile(t.cloneNode(root, true));
  traverse(file, {
    JSXAttribute(path) {
      if (!t.isJSXIdentifier(path.node.name) || !/^on[A-Z]/.test(path.node.name.name)) return;
      const value = path.node.value;
      if (
        !t.isJSXExpressionContainer(value) ||
        (!t.isArrowFunctionExpression(value.expression) &&
          !t.isFunctionExpression(value.expression))
      ) {
        return;
      }
      value.expression = stabilizeDeferredEventCurrentTarget(value.expression, compilerSetters);
    },
  });
  const expression = (file.program.body[0] as t.ExpressionStatement).expression;
  return t.isJSXElement(expression) ? expression : t.cloneNode(root, true);
}

function analyzeKeyedRowTree(
  row: t.JSXElement,
  renderCallback: t.ArrowFunctionExpression | t.FunctionExpression,
  safeGlobals: ReadonlySet<string>,
  compilerSetters: ReadonlySet<string>,
): {
  bindings?: PendingKeyedRowBinding[];
  events?: PendingKeyedRowEvent[];
  conditionals?: PendingKeyedRowConditional[];
  reason?: string;
} {
  if (
    renderCallback.async ||
    renderCallback.generator ||
    renderCallback.params.length < 1 ||
    renderCallback.params.length > 2 ||
    !t.isIdentifier(renderCallback.params[0]) ||
    (renderCallback.params[1] !== undefined && !t.isIdentifier(renderCallback.params[1]))
  ) {
    return { reason: "compiled keyed rows require item and optional index identifiers" };
  }

  const bindings: PendingKeyedRowBinding[] = [];
  const events: PendingKeyedRowEvent[] = [];
  const conditionals: PendingKeyedRowConditional[] = [];
  const visit = (element: t.JSXElement, path: number[]): string | undefined => {
    const tag = element.openingElement.name;
    if (!t.isJSXIdentifier(tag) || !/^[a-z]/.test(tag.name)) {
      return "compiled keyed rows support host elements only";
    }
    if (tag.name === "svg") return "compiled keyed rows do not support SVG yet";
    const attributeNames = new Set(
      element.openingElement.attributes
        .filter((attribute): attribute is t.JSXAttribute => t.isJSXAttribute(attribute))
        .map(jsxAttributeName)
        .filter((name): name is string => name !== undefined),
    );
    const controlled = attributeNames.has("value") || attributeNames.has("checked");
    if (attributeNames.has("contentEditable")) {
      return "content-editable keyed rows require React ownership";
    }
    if (tag.name === "input" && controlled) {
      const type = jsxAttribute(element, "type");
      const staticType = staticJsxAttributeString(type);
      if (type && staticType === undefined) {
        return "controlled keyed row inputs require a static type";
      }
      if (attributeNames.has("value") && staticType?.toLowerCase() === "file") {
        return "file inputs require React ownership";
      }
    }
    if (tag.name === "textarea" && controlled && meaningfulJsxChildren(element).length > 0) {
      return "controlled keyed row textareas cannot also use children";
    }
    if (tag.name === "select" && controlled && controlledSelectHasDynamicOptions(element)) {
      return "controlled keyed row selects require static options";
    }

    for (const attribute of element.openingElement.attributes) {
      if (t.isJSXSpreadAttribute(attribute)) {
        return "compiled keyed rows do not support JSX attribute spreads";
      }
      const name = jsxAttributeName(attribute);
      if (!name) return "compiled keyed rows do not support namespaced JSX attributes";
      if (name === "ref" || name === "dangerouslySetInnerHTML") {
        return `compiled keyed row ${name} requires React ownership`;
      }
      if (name === "key") continue;
      if (/^on[A-Z]/.test(name)) {
        if (
          !t.isJSXExpressionContainer(attribute.value) ||
          (!t.isArrowFunctionExpression(attribute.value.expression) &&
            !t.isFunctionExpression(attribute.value.expression))
        ) {
          return "interactive compiled keyed rows require inline synchronous event handlers";
        }
        const handler = attribute.value.expression;
        if (handler.async || handler.generator) {
          return "interactive compiled keyed row handlers must be synchronous";
        }
        if (containsDirectHookCall(handler)) {
          return "Hooks cannot be called inside compiled keyed row handlers";
        }
        const unsupported = validateKeyedRowEventHandler(handler);
        if (unsupported) {
          return `interactive compiled keyed row handlers cannot use ${unsupported}`;
        }
        events.push({
          id: events.length,
          path: [...path],
          name,
          value: stabilizeDeferredEventCurrentTarget(handler, compilerSetters),
        });
        continue;
      }
      if (
        !t.isJSXExpressionContainer(attribute.value) ||
        t.isJSXEmptyExpression(attribute.value.expression)
      ) {
        continue;
      }

      const expression = attribute.value.expression;
      if (name === "style") {
        if (!t.isObjectExpression(expression)) {
          return "compiled keyed row styles must use one inline object literal";
        }
        for (const property of expression.properties) {
          if (
            !t.isObjectProperty(property) ||
            property.computed ||
            !t.isExpression(property.value)
          ) {
            return "compiled keyed row styles do not support spreads, methods, or computed properties";
          }
          const propertyName = t.isIdentifier(property.key)
            ? property.key.name
            : t.isStringLiteral(property.key)
              ? property.key.value
              : undefined;
          if (!propertyName || (propertyName.includes("-") && !propertyName.startsWith("--"))) {
            return "compiled keyed row style names must use camelCase or a CSS custom property";
          }
          const unsupported = validateDerivedExpression(property.value, safeGlobals);
          if (unsupported) {
            return `compiled keyed row style ${propertyName} cannot use ${unsupported}`;
          }
          bindings.push({
            kind: "style",
            path: [...path],
            name: propertyName,
            value: cloneExpression(property.value),
          });
        }
        continue;
      }

      if (name === "children") return "compiled keyed row children props are not supported yet";
      const unsupported = validateDerivedExpression(expression, safeGlobals);
      if (unsupported) return `compiled keyed row ${name} cannot use ${unsupported}`;
      bindings.push({
        kind: "attribute",
        path: [...path],
        name,
        value: cloneExpression(expression),
      });
    }

    const meaningfulChildren = meaningfulJsxChildren(element);
    const conditionalChild = meaningfulChildren.find(
      (child): child is t.JSXExpressionContainer =>
        t.isJSXExpressionContainer(child) &&
        !t.isJSXEmptyExpression(child.expression) &&
        conditionalBlockShape(child.expression) !== null,
    );
    if (conditionalChild && !t.isJSXEmptyExpression(conditionalChild.expression)) {
      if (meaningfulChildren.length !== 1) {
        return "compiled keyed row conditionals must be the only child of a host container";
      }
      const shape = conditionalBlockShape(conditionalChild.expression);
      if (!shape) return "compiled keyed row conditional shape is not supported";
      const testUnsupported = validateDerivedExpression(shape.test, safeGlobals);
      if (testUnsupported) {
        return `compiled keyed row conditional test cannot use ${testUnsupported}`;
      }
      const truthyAnalysis = shape.truthy
        ? analyzeHostConditionalTree(shape.truthy, safeGlobals)
        : { bindings: [] as PendingKeyedRowBinding[] };
      const falsyAnalysis = shape.falsy
        ? analyzeHostConditionalTree(shape.falsy, safeGlobals)
        : { bindings: [] as PendingKeyedRowBinding[] };
      if (truthyAnalysis.reason || falsyAnalysis.reason) {
        return (
          truthyAnalysis.reason ||
          falsyAnalysis.reason ||
          "compiled keyed row conditional branch is not supported"
        );
      }
      conditionals.push({
        id: conditionals.length,
        path: [...path],
        test: cloneExpression(shape.test),
        logical: shape.logical,
        truthy: shape.truthy ? t.cloneNode(shape.truthy, true) : undefined,
        falsy: shape.falsy ? t.cloneNode(shape.falsy, true) : undefined,
        truthyBindings: truthyAnalysis.bindings || [],
        falsyBindings: falsyAnalysis.bindings || [],
      });
      return undefined;
    }

    const nestedElements = element.children.filter((child): child is t.JSXElement =>
      t.isJSXElement(child),
    );
    if (element.children.some((child) => t.isJSXFragment(child))) {
      return "compiled keyed rows do not support fragments yet";
    }
    const expressions = element.children.filter(
      (child): child is t.JSXExpressionContainer =>
        t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression),
    );
    for (const child of expressions) {
      const unsupported = validateDerivedExpression(child.expression as t.Expression, safeGlobals);
      if (unsupported) return `compiled keyed row text cannot use ${unsupported}`;
    }
    if (nestedElements.length > 0 && expressions.length > 0) {
      return "compiled keyed rows do not support dynamic text beside nested elements yet";
    }
    if (nestedElements.length === 0 && expressions.length > 0) {
      const parts: t.Expression[] = [];
      for (const child of element.children) {
        if (t.isJSXText(child)) {
          const text = cleanJsxText(child.value);
          if (text) parts.push(t.stringLiteral(text));
        } else if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
          parts.push(cloneExpression(child.expression));
        }
      }
      bindings.push({ kind: "text", path: [...path], value: t.arrayExpression(parts) });
    }

    let elementIndex = 0;
    for (const child of element.children) {
      if (!t.isJSXElement(child)) continue;
      const reason = visit(child, [...path, elementIndex]);
      if (reason) return reason;
      elementIndex += 1;
    }
    return undefined;
  };

  const reason = visit(row, []);
  return reason ? { reason } : { bindings, events, conditionals };
}

interface KeyedRowChildShape extends KeyedRowsShape {
  source: t.Expression | t.JSXElement;
}

function analyzeKeyedRowChild(
  child: t.JSXElement["children"][number],
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  listNames: ReadonlySet<string>,
  acceptUnsupportedRow = false,
): KeyedRowChildShape | undefined {
  let collection: t.Expression;
  let keyCallback: t.ArrowFunctionExpression | t.FunctionExpression;
  let renderCallback: t.ArrowFunctionExpression | t.FunctionExpression;
  let row: t.JSXElement;
  let dependencies: number[];
  let syntax: "map" | "list";
  let source: t.Expression | t.JSXElement;

  if (
    t.isJSXExpressionContainer(child) &&
    !t.isJSXEmptyExpression(child.expression) &&
    isMapCall(child.expression)
  ) {
    const result = analyzeMapList(child.expression, statesByValue, safeGlobals);
    if (result.reason) return undefined;
    const callback = child.expression.arguments[0];
    if (!t.isArrowFunctionExpression(callback) && !t.isFunctionExpression(callback))
      return undefined;
    const returned = returnedExpression(callback);
    if (!returned || !t.isJSXElement(returned)) return undefined;
    const key = jsxKeyExpression(returned);
    if (!key) return undefined;
    collection = (child.expression.callee as t.MemberExpression).object as t.Expression;
    keyCallback = t.arrowFunctionExpression(
      callback.params.map((parameter) => t.cloneNode(parameter, true)) as t.Identifier[],
      cloneExpression(key),
    );
    renderCallback = callback;
    row = returned;
    dependencies = result.dependencies || [];
    syntax = "map";
    source = child.expression;
  } else if (t.isJSXElement(child) && isPublicListElement(child, listNames)) {
    const result = analyzePublicList(child, statesByValue, safeGlobals);
    if (result.reason) return undefined;
    const each = listAttributeExpression(child, "each");
    const by = listAttributeExpression(child, "by");
    const renderChild = meaningfulJsxChildren(child)[0];
    if (
      !each ||
      (!t.isArrowFunctionExpression(by) && !t.isFunctionExpression(by)) ||
      !t.isJSXExpressionContainer(renderChild) ||
      t.isJSXEmptyExpression(renderChild.expression) ||
      (!t.isArrowFunctionExpression(renderChild.expression) &&
        !t.isFunctionExpression(renderChild.expression))
    ) {
      return undefined;
    }
    const returned = returnedExpression(renderChild.expression);
    if (!returned || !t.isJSXElement(returned)) return undefined;
    collection = each;
    keyCallback = by;
    renderCallback = renderChild.expression;
    row = returned;
    dependencies = result.dependencies || [];
    syntax = "list";
    source = child;
  } else {
    return undefined;
  }

  const rowAnalysis = analyzeKeyedRowTree(
    row,
    renderCallback,
    safeGlobals,
    new Set([...statesByValue.values()].map((state) => state.setterName)),
  );
  if (rowAnalysis.reason && !acceptUnsupportedRow) return undefined;
  const keyExpression = returnedExpression(keyCallback);
  const structureDependencies = new Set(collectStateDependencies(collection, statesByValue));
  if (keyExpression) {
    for (const dependency of collectStateDependencies(keyExpression, statesByValue)) {
      structureDependencies.add(dependency);
    }
  }
  return {
    source,
    collection,
    structureDependencies: [...structureDependencies].sort((left, right) => left - right),
    keyCallback,
    renderCallback,
    row,
    dependencies,
    bindings: (rowAnalysis.bindings || []).map((binding) => ({
      ...binding,
      dependencies: collectStateDependencies(binding.value, statesByValue),
    })),
    events: rowAnalysis.events || [],
    conditionals: rowAnalysis.conditionals || [],
    rowReason: rowAnalysis.reason,
    syntax,
  };
}

function analyzeKeyedRowsContainer(
  container: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  listNames: ReadonlySet<string>,
): KeyedRowsShape | undefined {
  if (
    container.openingElement.attributes.some(
      (attribute) =>
        t.isJSXSpreadAttribute(attribute) ||
        (t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name) &&
          (attribute.name.name === "ref" || attribute.name.name === "dangerouslySetInnerHTML")),
    )
  ) {
    return undefined;
  }
  for (const attribute of container.openingElement.attributes) {
    if (
      t.isJSXAttribute(attribute) &&
      t.isJSXIdentifier(attribute.name) &&
      t.isJSXExpressionContainer(attribute.value) &&
      !t.isJSXEmptyExpression(attribute.value.expression) &&
      !/^on[A-Z]/.test(attribute.name.name) &&
      collectStateDependencies(attribute.value.expression, statesByValue).length > 0
    ) {
      return undefined;
    }
  }

  const children = meaningfulJsxChildren(container);
  if (children.length !== 1) return undefined;
  return analyzeKeyedRowChild(children[0], statesByValue, safeGlobals, listNames, true);
}

function analyzeKeyedRangesContainer(
  container: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  listNames: ReadonlySet<string>,
  allowSingleRange = false,
):
  | {
      ranges: KeyedRangePlan[];
      trailing: number;
      dependencies: number[];
      staticBindings: PendingStaticRangeBinding[];
    }
  | undefined {
  if (
    container.openingElement.attributes.some(
      (attribute) =>
        t.isJSXSpreadAttribute(attribute) ||
        (t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name) &&
          (attribute.name.name === "ref" || attribute.name.name === "dangerouslySetInnerHTML")),
    )
  ) {
    return undefined;
  }

  const children = meaningfulJsxChildren(container);
  if (children.length < (allowSingleRange ? 1 : 2)) return undefined;
  const ranges: KeyedRangePlan[] = [];
  const dependencies = new Set<number>();
  const staticBindings: PendingStaticRangeBinding[] = [];
  let staticBefore = 0;
  for (const child of children) {
    const range = analyzeKeyedRowChild(child, statesByValue, safeGlobals, listNames);
    if (range) {
      if (range.events.length > 0 || range.conditionals.length > 0) return undefined;
      ranges.push({
        before: staticBefore,
        source: range.source,
        collection: range.collection,
        keyCallback: range.keyCallback,
        renderCallback: range.renderCallback,
        row: range.row,
        bindings: range.bindings,
        syntax: range.syntax,
      });
      for (const dependency of range.dependencies) dependencies.add(dependency);
      staticBefore = 0;
      continue;
    }
    if (!t.isJSXElement(child) || !isHostElement(child)) return undefined;
    const analysis = analyzeHostConditionalTree(child, safeGlobals, true, statesByValue);
    if (analysis.reason) return undefined;
    for (const binding of analysis.bindings || []) {
      staticBindings.push({
        ...binding,
        segment: ranges.length,
        sibling: staticBefore,
      });
      for (const dependency of collectStateDependencies(binding.value, statesByValue)) {
        dependencies.add(dependency);
      }
    }
    staticBefore += 1;
  }
  if (ranges.length === 0) return undefined;
  return {
    ranges,
    trailing: staticBefore,
    dependencies: [...dependencies].sort((left, right) => left - right),
    staticBindings,
  };
}

function analyzeHostConditionalTree(
  branch: t.JSXElement,
  safeGlobals: ReadonlySet<string>,
  allowStaticEvents = false,
  statefulOnly?: ReadonlyMap<string, StateBinding>,
): { bindings?: PendingKeyedRowBinding[]; reason?: string } {
  const bindings: PendingKeyedRowBinding[] = [];
  const needsStaticBinding = (expression: t.Expression): boolean =>
    !statefulOnly || collectStateDependencies(expression, statefulOnly).length > 0;
  const visit = (element: t.JSXElement, path: number[]): string | undefined => {
    const tag = element.openingElement.name;
    if (!t.isJSXIdentifier(tag) || !/^[a-z]/.test(tag.name)) {
      return "compiler-owned conditionals support host elements only";
    }
    if (tag.name === "svg") return "compiler-owned conditionals do not support SVG yet";

    for (const attribute of element.openingElement.attributes) {
      if (t.isJSXSpreadAttribute(attribute)) {
        if (statefulOnly && !needsStaticBinding(attribute.argument)) continue;
        return "compiler-owned conditionals do not support JSX attribute spreads";
      }
      const name = jsxAttributeName(attribute);
      if (!name) return "compiler-owned conditionals do not support namespaced JSX attributes";
      if (name === "ref" || name === "dangerouslySetInnerHTML" || name === "key") {
        if (
          statefulOnly &&
          (!t.isJSXExpressionContainer(attribute.value) ||
            t.isJSXEmptyExpression(attribute.value.expression) ||
            !needsStaticBinding(attribute.value.expression))
        ) {
          continue;
        }
        return `compiler-owned conditional ${name} requires React ownership`;
      }
      if (/^on[A-Z]/.test(name)) {
        if (allowStaticEvents) continue;
        return "compiler-owned conditional events require React ownership";
      }
      if (
        !t.isJSXExpressionContainer(attribute.value) ||
        t.isJSXEmptyExpression(attribute.value.expression)
      ) {
        continue;
      }

      const expression = attribute.value.expression;
      if (!needsStaticBinding(expression)) continue;
      if (name === "style") {
        if (!t.isObjectExpression(expression)) {
          return "compiler-owned conditional styles must use one inline object literal";
        }
        for (const property of expression.properties) {
          if (
            !t.isObjectProperty(property) ||
            property.computed ||
            !t.isExpression(property.value)
          ) {
            return "compiler-owned conditional styles do not support spreads, methods, or computed properties";
          }
          const propertyName = t.isIdentifier(property.key)
            ? property.key.name
            : t.isStringLiteral(property.key)
              ? property.key.value
              : undefined;
          if (!propertyName || (propertyName.includes("-") && !propertyName.startsWith("--"))) {
            return "compiler-owned conditional style names must use camelCase or a CSS custom property";
          }
          if (!needsStaticBinding(property.value)) continue;
          const unsupported = validateDerivedExpression(property.value, safeGlobals);
          if (unsupported) {
            return `compiler-owned conditional style ${propertyName} cannot use ${unsupported}`;
          }
          bindings.push({
            kind: "style",
            path: [...path],
            name: propertyName,
            value: cloneExpression(property.value),
          });
        }
        continue;
      }

      if (name === "children") {
        return "compiler-owned conditional children props are not supported yet";
      }
      const unsupported = validateDerivedExpression(expression, safeGlobals);
      if (unsupported) return `compiler-owned conditional ${name} cannot use ${unsupported}`;
      bindings.push({
        kind: "attribute",
        path: [...path],
        name,
        value: cloneExpression(expression),
      });
    }

    const nestedElements = element.children.filter((child): child is t.JSXElement =>
      t.isJSXElement(child),
    );
    if (element.children.some((child) => t.isJSXFragment(child))) {
      return "compiler-owned conditionals do not support fragments yet";
    }
    const expressions = element.children.filter(
      (child): child is t.JSXExpressionContainer =>
        t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression),
    );
    const boundExpressions = statefulOnly
      ? expressions.filter((child) => needsStaticBinding(child.expression as t.Expression))
      : expressions;
    if (boundExpressions.length > 0) {
      for (const child of expressions) {
        const unsupported = validateDerivedExpression(
          child.expression as t.Expression,
          safeGlobals,
        );
        if (unsupported) return `compiler-owned conditional text cannot use ${unsupported}`;
      }
    }
    if (nestedElements.length > 0 && boundExpressions.length > 0) {
      return "compiler-owned conditionals do not support dynamic text beside nested elements yet";
    }
    if (nestedElements.length === 0 && boundExpressions.length > 0) {
      const parts: t.Expression[] = [];
      for (const child of element.children) {
        if (t.isJSXText(child)) {
          const text = cleanJsxText(child.value);
          if (text) parts.push(t.stringLiteral(text));
        } else if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
          parts.push(cloneExpression(child.expression));
        }
      }
      bindings.push({ kind: "text", path: [...path], value: t.arrayExpression(parts) });
    }

    let elementIndex = 0;
    for (const child of element.children) {
      if (!t.isJSXElement(child)) continue;
      const reason = visit(child, [...path, elementIndex]);
      if (reason) return reason;
      elementIndex += 1;
    }
    return undefined;
  };

  const reason = visit(branch, []);
  return reason ? { reason } : { bindings };
}

interface RecursiveHostTreeAnalysis {
  bindings: PendingKeyedRowBinding[];
  plans: HostDescriptorBlockPlan[];
  blocks: Map<t.JSXElement, HostDescriptorBlockPlan>;
  reason?: string;
}

function analyzeRecursiveHostTree(
  branch: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  listNames: ReadonlySet<string>,
  parent: number,
  allocateId: () => number,
): RecursiveHostTreeAnalysis {
  const bindings: PendingKeyedRowBinding[] = [];
  const plans: HostDescriptorBlockPlan[] = [];
  const blocks = new Map<t.JSXElement, HostDescriptorBlockPlan>();

  const visit = (element: t.JSXElement, path: number[], owner: number): string | undefined => {
    const tag = element.openingElement.name;
    if (!t.isJSXIdentifier(tag) || !/^[a-z]/.test(tag.name)) {
      return "recursive compiler-owned blocks support host elements only";
    }
    if (tag.name === "svg") return "recursive compiler-owned blocks do not support SVG yet";

    for (const attribute of element.openingElement.attributes) {
      if (t.isJSXSpreadAttribute(attribute)) {
        return "recursive compiler-owned blocks do not support JSX attribute spreads";
      }
      const name = jsxAttributeName(attribute);
      if (!name) return "recursive compiler-owned blocks do not support namespaced attributes";
      if (name === "ref" || name === "dangerouslySetInnerHTML" || name === "key") {
        return `recursive compiler-owned block ${name} requires React ownership`;
      }
      if (/^on[A-Z]/.test(name)) {
        return "recursive compiler-owned block events require React ownership";
      }
      if (
        !t.isJSXExpressionContainer(attribute.value) ||
        t.isJSXEmptyExpression(attribute.value.expression)
      ) {
        continue;
      }

      const expression = attribute.value.expression;
      if (name === "style") {
        if (!t.isObjectExpression(expression)) {
          return "recursive compiler-owned styles must use one inline object literal";
        }
        for (const property of expression.properties) {
          if (
            !t.isObjectProperty(property) ||
            property.computed ||
            !t.isExpression(property.value)
          ) {
            return "recursive compiler-owned styles do not support spreads, methods, or computed properties";
          }
          const propertyName = t.isIdentifier(property.key)
            ? property.key.name
            : t.isStringLiteral(property.key)
              ? property.key.value
              : undefined;
          if (!propertyName || (propertyName.includes("-") && !propertyName.startsWith("--"))) {
            return "recursive compiler-owned style names must use camelCase or a CSS custom property";
          }
          const unsupported = validateDerivedExpression(property.value, safeGlobals);
          if (unsupported) {
            return `recursive compiler-owned style ${propertyName} cannot use ${unsupported}`;
          }
          bindings.push({
            kind: "style",
            path: [...path],
            name: propertyName,
            value: cloneExpression(property.value),
          });
        }
        continue;
      }

      if (name === "children") {
        return "recursive compiler-owned children props are not supported yet";
      }
      const unsupported = validateDerivedExpression(expression, safeGlobals);
      if (unsupported) return `recursive compiler-owned ${name} cannot use ${unsupported}`;
      bindings.push({
        kind: "attribute",
        path: [...path],
        name,
        value: cloneExpression(expression),
      });
    }

    const children = meaningfulJsxChildren(element);
    const hasConditionalRange = children.some(
      (child) =>
        t.isJSXExpressionContainer(child) &&
        !t.isJSXEmptyExpression(child.expression) &&
        conditionalBlockShape(child.expression) !== null,
    );
    const hasKeyedRange = children.some(
      (child) =>
        analyzeKeyedRowChild(child, statesByValue, safeGlobals, listNames, true) !== undefined,
    );
    if (hasConditionalRange && hasKeyedRange) {
      const id = allocateId();
      const mixed = analyzeMixedRangesContainer(
        element,
        statesByValue,
        safeGlobals,
        listNames,
        id,
        allocateId,
      );
      if (mixed) {
        plans.push(...mixed.nestedPlans);
        for (const [nestedElement, plan] of mixed.descriptorBlocks) {
          blocks.set(nestedElement, plan);
        }
        const plan: NestedHostMixedRangesPlan = {
          kind: "nested-host-mixed-ranges",
          id,
          parent: owner,
          dependencies: mixed.dependencies,
          source: element,
          ranges: mixed.ranges,
          trailing: mixed.trailing,
          staticBindings: mixed.staticBindings,
        };
        plans.push(plan);
        blocks.set(element, plan);
        return undefined;
      }
    }

    const conditionalChildren = new Map<
      t.Expression,
      NonNullable<ReturnType<typeof conditionalBlockShape>>
    >();
    let conditionalContainer = children.length > 0;
    for (const child of children) {
      if (t.isJSXElement(child) && isHostElement(child)) continue;
      if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
        const shape = conditionalBlockShape(child.expression);
        if (shape && !validateDerivedExpression(shape.test, safeGlobals)) {
          conditionalChildren.set(child.expression, shape);
          continue;
        }
      }
      conditionalContainer = false;
      break;
    }

    if (conditionalContainer && conditionalChildren.size > 0) {
      const id = allocateId();
      const ranges: ConditionalRangePlan[] = [];
      const staticBindings: PendingStaticRangeBinding[] = [];
      const dependencies = new Set<number>();
      let staticBefore = 0;
      for (const child of children) {
        if (t.isJSXElement(child)) {
          const nested = analyzeRecursiveHostTree(
            child,
            statesByValue,
            safeGlobals,
            listNames,
            owner,
            allocateId,
          );
          if (nested.reason) return nested.reason;
          plans.push(...nested.plans);
          for (const [nestedElement, plan] of nested.blocks) blocks.set(nestedElement, plan);
          for (const binding of nested.bindings) {
            staticBindings.push({
              ...binding,
              segment: ranges.length,
              sibling: staticBefore,
            });
            for (const dependency of collectStateDependencies(binding.value, statesByValue)) {
              dependencies.add(dependency);
            }
          }
          staticBefore += 1;
          continue;
        }

        if (!t.isJSXExpressionContainer(child) || t.isJSXEmptyExpression(child.expression)) {
          return "recursive conditional ranges contain an unsupported child";
        }
        const expression = child.expression;
        const shape = conditionalChildren.get(expression)!;
        const truthy = shape.truthy
          ? analyzeRecursiveHostTree(
              shape.truthy,
              statesByValue,
              safeGlobals,
              listNames,
              id,
              allocateId,
            )
          : { bindings: [], plans: [], blocks: new Map<t.JSXElement, HostDescriptorBlockPlan>() };
        const falsy = shape.falsy
          ? analyzeRecursiveHostTree(
              shape.falsy,
              statesByValue,
              safeGlobals,
              listNames,
              id,
              allocateId,
            )
          : { bindings: [], plans: [], blocks: new Map<t.JSXElement, HostDescriptorBlockPlan>() };
        if (truthy.reason) return truthy.reason;
        if (falsy.reason) return falsy.reason;
        plans.push(...truthy.plans, ...falsy.plans);
        for (const [nestedElement, plan] of truthy.blocks) blocks.set(nestedElement, plan);
        for (const [nestedElement, plan] of falsy.blocks) blocks.set(nestedElement, plan);

        for (const dependency of collectStateDependencies(shape.test, statesByValue)) {
          dependencies.add(dependency);
        }
        for (const binding of [...truthy.bindings, ...falsy.bindings]) {
          for (const dependency of collectStateDependencies(binding.value, statesByValue)) {
            dependencies.add(dependency);
          }
        }
        ranges.push({
          before: staticBefore,
          source: expression,
          test: cloneExpression(shape.test),
          logical: shape.logical,
          truthy: shape.truthy,
          falsy: shape.falsy,
          truthyBindings: truthy.bindings,
          falsyBindings: falsy.bindings,
        });
        staticBefore = 0;
      }
      const plan: NestedHostConditionalRangesPlan = {
        kind: "nested-host-conditional-ranges",
        id,
        parent: owner,
        dependencies: [...dependencies].sort((left, right) => left - right),
        source: element,
        ranges,
        trailing: staticBefore,
        staticBindings,
      };
      plans.push(plan);
      blocks.set(element, plan);
      return undefined;
    }

    const keyedRows: Array<{ before: number; range: KeyedRowChildShape }> = [];
    let keyedContainer = children.length > 0;
    let staticBefore = 0;
    const staticChildren: Array<{
      element: t.JSXElement;
      segment: number;
      sibling: number;
    }> = [];
    for (const child of children) {
      const range = analyzeKeyedRowChild(child, statesByValue, safeGlobals, listNames, true);
      if (range) {
        keyedRows.push({ before: staticBefore, range });
        staticBefore = 0;
      } else if (t.isJSXElement(child) && isHostElement(child)) {
        staticChildren.push({
          element: child,
          segment: keyedRows.length,
          sibling: staticBefore,
        });
        staticBefore += 1;
      } else {
        keyedContainer = false;
        break;
      }
    }

    if (keyedContainer && keyedRows.length > 0) {
      const id = allocateId();
      const keyedRanges: KeyedRangePlan[] = [];
      const staticBindings: PendingStaticRangeBinding[] = [];
      const keyedDependencies = new Set<number>();
      for (const { before, range } of keyedRows) {
        if (range.events.length > 0) {
          return "recursive compiler-owned keyed rows cannot contain events";
        }
        const row = t.cloneNode(range.row, true);
        row.openingElement.attributes = row.openingElement.attributes.filter(
          (attribute) => !t.isJSXAttribute(attribute) || jsxAttributeName(attribute) !== "key",
        );
        const rowAnalysis = analyzeRecursiveHostTree(
          row,
          statesByValue,
          safeGlobals,
          listNames,
          id,
          allocateId,
        );
        if (rowAnalysis.reason) return rowAnalysis.reason;
        plans.push(...rowAnalysis.plans);
        for (const [nestedElement, nestedPlan] of rowAnalysis.blocks) {
          blocks.set(nestedElement, nestedPlan);
        }
        keyedRanges.push({
          before,
          source: range.source,
          collection: range.collection,
          keyCallback: range.keyCallback,
          renderCallback: range.renderCallback,
          row,
          bindings: rowAnalysis.bindings,
          syntax: range.syntax,
        });
        for (const dependency of range.dependencies) keyedDependencies.add(dependency);
      }
      for (const { element: child, segment, sibling } of staticChildren) {
        const nested = analyzeRecursiveHostTree(
          child,
          statesByValue,
          safeGlobals,
          listNames,
          owner,
          allocateId,
        );
        if (nested.reason) return nested.reason;
        plans.push(...nested.plans);
        for (const [nestedElement, plan] of nested.blocks) blocks.set(nestedElement, plan);
        for (const binding of nested.bindings) {
          staticBindings.push({ ...binding, segment, sibling });
          for (const dependency of collectStateDependencies(binding.value, statesByValue)) {
            keyedDependencies.add(dependency);
          }
        }
      }
      const plan: NestedHostKeyedRangesPlan = {
        kind: "nested-host-keyed-ranges",
        id,
        parent: owner,
        dependencies: [...keyedDependencies].sort((left, right) => left - right),
        source: element,
        ranges: keyedRanges,
        trailing: staticBefore,
        staticBindings,
      };
      plans.push(plan);
      blocks.set(element, plan);
      return undefined;
    }

    if (element.children.some((child) => t.isJSXFragment(child))) {
      return "recursive compiler-owned blocks do not support fragments yet";
    }
    const nestedElements = element.children.filter((child): child is t.JSXElement =>
      t.isJSXElement(child),
    );
    const expressions = element.children.filter(
      (child): child is t.JSXExpressionContainer =>
        t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression),
    );
    for (const child of expressions) {
      const unsupported = validateDerivedExpression(child.expression as t.Expression, safeGlobals);
      if (unsupported) return `recursive compiler-owned text cannot use ${unsupported}`;
    }
    if (nestedElements.length > 0 && expressions.length > 0) {
      return "recursive compiler-owned blocks do not support dynamic text beside nested elements";
    }
    if (nestedElements.length === 0 && expressions.length > 0) {
      const parts: t.Expression[] = [];
      for (const child of element.children) {
        if (t.isJSXText(child)) {
          const text = cleanJsxText(child.value);
          if (text) parts.push(t.stringLiteral(text));
        } else if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
          parts.push(cloneExpression(child.expression));
        }
      }
      bindings.push({ kind: "text", path: [...path], value: t.arrayExpression(parts) });
    }

    let elementIndex = 0;
    for (const child of element.children) {
      if (!t.isJSXElement(child)) continue;
      const reason = visit(child, [...path, elementIndex], owner);
      if (reason) return reason;
      elementIndex += 1;
    }
    return undefined;
  };

  const reason = visit(branch, [], parent);
  return { bindings, plans, blocks, reason };
}

function analyzeCompilerOwnedKeyedRowHostBlocks(
  shape: KeyedRowsShape,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  listNames: ReadonlySet<string>,
  parent: number,
  allocateId: () => number,
):
  | {
      row: t.JSXElement;
      bindings: PendingKeyedRowBinding[];
      descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>;
      nestedPlans: HostDescriptorBlockPlan[];
    }
  | undefined {
  if (shape.events.length > 0) return undefined;

  const row = t.cloneNode(shape.row, true);
  row.openingElement.attributes = row.openingElement.attributes.filter(
    (attribute) => !t.isJSXAttribute(attribute) || jsxAttributeName(attribute) !== "key",
  );
  const analysis = analyzeRecursiveHostTree(
    row,
    statesByValue,
    safeGlobals,
    listNames,
    parent,
    allocateId,
  );
  if (analysis.reason || analysis.plans.length === 0) {
    return undefined;
  }
  return {
    row,
    bindings: analysis.bindings,
    descriptorBlocks: analysis.blocks,
    nestedPlans: analysis.plans,
  };
}

function analyzeHostConditionalContainer(
  container: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  listNames: ReadonlySet<string>,
  parent: number,
  allocateId: () => number,
): Omit<HostConditionalPlan, "kind" | "id" | "parent" | "source"> | undefined {
  const containerName = container.openingElement.name;
  if (
    !t.isJSXIdentifier(containerName) ||
    !/^[a-z]/.test(containerName.name) ||
    containerName.name === "svg"
  ) {
    return undefined;
  }
  if (
    container.openingElement.attributes.some(
      (attribute) =>
        t.isJSXSpreadAttribute(attribute) ||
        (t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name) &&
          (attribute.name.name === "ref" || attribute.name.name === "dangerouslySetInnerHTML")),
    )
  ) {
    return undefined;
  }
  for (const attribute of container.openingElement.attributes) {
    if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name)) return undefined;
    if (/^on[A-Z]/.test(attribute.name.name) || attribute.name.name === "key") return undefined;
    // React does not revisit the adopted container on compiler-cell or parent-prop updates.
    // Keep every container property static; dynamic work belongs to the owned branch bindings.
    if (
      t.isJSXExpressionContainer(attribute.value) &&
      !t.isJSXEmptyExpression(attribute.value.expression)
    )
      return undefined;
  }

  const children = meaningfulJsxChildren(container);
  if (
    children.length !== 1 ||
    !t.isJSXExpressionContainer(children[0]) ||
    t.isJSXEmptyExpression(children[0].expression)
  ) {
    return undefined;
  }
  const shape = conditionalBlockShape(children[0].expression);
  if (!shape || validateDerivedExpression(shape.test, safeGlobals)) return undefined;

  const truthyAnalysis = shape.truthy
    ? analyzeRecursiveHostTree(
        shape.truthy,
        statesByValue,
        safeGlobals,
        listNames,
        parent,
        allocateId,
      )
    : { bindings: [], plans: [], blocks: new Map<t.JSXElement, HostDescriptorBlockPlan>() };
  const falsyAnalysis = shape.falsy
    ? analyzeRecursiveHostTree(
        shape.falsy,
        statesByValue,
        safeGlobals,
        listNames,
        parent,
        allocateId,
      )
    : { bindings: [], plans: [], blocks: new Map<t.JSXElement, HostDescriptorBlockPlan>() };
  if (truthyAnalysis.reason || falsyAnalysis.reason) return undefined;

  const dependencies = new Set(collectStateDependencies(shape.test, statesByValue));
  for (const binding of [...(truthyAnalysis.bindings || []), ...(falsyAnalysis.bindings || [])]) {
    for (const dependency of collectStateDependencies(binding.value, statesByValue)) {
      dependencies.add(dependency);
    }
  }
  return {
    dependencies: [...dependencies].sort((left, right) => left - right),
    test: cloneExpression(shape.test),
    logical: shape.logical,
    truthy: shape.truthy,
    falsy: shape.falsy,
    truthyBindings: truthyAnalysis.bindings || [],
    falsyBindings: falsyAnalysis.bindings || [],
    descriptorBlocks: new Map([...truthyAnalysis.blocks, ...falsyAnalysis.blocks]),
    nestedPlans: [...truthyAnalysis.plans, ...falsyAnalysis.plans],
  };
}

function analyzeConditionalRangesContainer(
  container: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  allowSingleRange: boolean,
  listNames: ReadonlySet<string>,
  parent: number,
  allocateId: () => number,
):
  | {
      ranges: ConditionalRangePlan[];
      trailing: number;
      dependencies: number[];
      staticBindings: PendingStaticRangeBinding[];
      descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>;
      nestedPlans: HostDescriptorBlockPlan[];
    }
  | undefined {
  const containerName = container.openingElement.name;
  if (
    !t.isJSXIdentifier(containerName) ||
    !/^[a-z]/.test(containerName.name) ||
    containerName.name === "svg" ||
    container.openingElement.attributes.some(
      (attribute) =>
        t.isJSXSpreadAttribute(attribute) ||
        (t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name) &&
          (attribute.name.name === "ref" || attribute.name.name === "dangerouslySetInnerHTML")),
    )
  ) {
    return undefined;
  }

  const children = meaningfulJsxChildren(container);
  if (children.length < (allowSingleRange ? 1 : 2)) return undefined;
  const ranges: ConditionalRangePlan[] = [];
  const dependencies = new Set<number>();
  const descriptorBlocks = new Map<t.JSXElement, HostDescriptorBlockPlan>();
  const nestedPlans: HostDescriptorBlockPlan[] = [];
  const staticBindings: PendingStaticRangeBinding[] = [];
  let staticBefore = 0;

  for (const child of children) {
    if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
      const shape = conditionalBlockShape(child.expression);
      if (shape && !validateDerivedExpression(shape.test, safeGlobals)) {
        const truthyAnalysis = shape.truthy
          ? analyzeRecursiveHostTree(
              shape.truthy,
              statesByValue,
              safeGlobals,
              listNames,
              parent,
              allocateId,
            )
          : { bindings: [], plans: [], blocks: new Map<t.JSXElement, HostDescriptorBlockPlan>() };
        const falsyAnalysis = shape.falsy
          ? analyzeRecursiveHostTree(
              shape.falsy,
              statesByValue,
              safeGlobals,
              listNames,
              parent,
              allocateId,
            )
          : { bindings: [], plans: [], blocks: new Map<t.JSXElement, HostDescriptorBlockPlan>() };
        if (truthyAnalysis.reason || falsyAnalysis.reason) return undefined;
        nestedPlans.push(...truthyAnalysis.plans, ...falsyAnalysis.plans);
        for (const [element, plan] of truthyAnalysis.blocks) descriptorBlocks.set(element, plan);
        for (const [element, plan] of falsyAnalysis.blocks) descriptorBlocks.set(element, plan);

        const rangeDependencies = new Set(collectStateDependencies(shape.test, statesByValue));
        for (const binding of [
          ...(truthyAnalysis.bindings || []),
          ...(falsyAnalysis.bindings || []),
        ]) {
          for (const dependency of collectStateDependencies(binding.value, statesByValue)) {
            rangeDependencies.add(dependency);
          }
        }
        for (const dependency of rangeDependencies) dependencies.add(dependency);
        ranges.push({
          before: staticBefore,
          source: child.expression,
          test: cloneExpression(shape.test),
          logical: shape.logical,
          truthy: shape.truthy,
          falsy: shape.falsy,
          truthyBindings: truthyAnalysis.bindings || [],
          falsyBindings: falsyAnalysis.bindings || [],
        });
        staticBefore = 0;
        continue;
      }
    }

    if (!t.isJSXElement(child) || !isHostElement(child)) return undefined;
    const staticAnalysis = analyzeHostConditionalTree(child, safeGlobals, true, statesByValue);
    if (staticAnalysis.reason) return undefined;
    for (const binding of staticAnalysis.bindings || []) {
      staticBindings.push({
        ...binding,
        segment: ranges.length,
        sibling: staticBefore,
      });
      for (const dependency of collectStateDependencies(binding.value, statesByValue)) {
        dependencies.add(dependency);
      }
    }
    staticBefore += 1;
  }

  if (ranges.length === 0) return undefined;
  return {
    ranges,
    trailing: staticBefore,
    dependencies: [...dependencies].sort((left, right) => left - right),
    staticBindings,
    descriptorBlocks,
    nestedPlans,
  };
}

function analyzeMixedRangesContainer(
  container: t.JSXElement,
  statesByValue: ReadonlyMap<string, StateBinding>,
  safeGlobals: ReadonlySet<string>,
  listNames: ReadonlySet<string>,
  parent: number,
  allocateId: () => number,
):
  | {
      ranges: MixedRangePlan[];
      trailing: number;
      dependencies: number[];
      staticBindings: PendingStaticRangeBinding[];
      descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>;
      nestedPlans: HostDescriptorBlockPlan[];
    }
  | undefined {
  const containerName = container.openingElement.name;
  if (
    !t.isJSXIdentifier(containerName) ||
    !/^[a-z]/.test(containerName.name) ||
    containerName.name === "svg" ||
    container.openingElement.attributes.some(
      (attribute) =>
        t.isJSXSpreadAttribute(attribute) ||
        (t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name) &&
          (attribute.name.name === "ref" || attribute.name.name === "dangerouslySetInnerHTML")),
    )
  ) {
    return undefined;
  }

  const children = meaningfulJsxChildren(container);
  if (children.length < 2) return undefined;
  const ranges: MixedRangePlan[] = [];
  const dependencies = new Set<number>();
  const descriptorBlocks = new Map<t.JSXElement, HostDescriptorBlockPlan>();
  const nestedPlans: HostDescriptorBlockPlan[] = [];
  const staticBindings: PendingStaticRangeBinding[] = [];
  let conditionalCount = 0;
  let keyedCount = 0;
  let staticBefore = 0;

  const mergeAnalysis = (analysis: RecursiveHostTreeAnalysis): boolean => {
    if (analysis.reason) return false;
    nestedPlans.push(...analysis.plans);
    for (const [element, plan] of analysis.blocks) descriptorBlocks.set(element, plan);
    for (const binding of analysis.bindings) {
      for (const dependency of collectStateDependencies(binding.value, statesByValue)) {
        dependencies.add(dependency);
      }
    }
    return true;
  };

  for (const child of children) {
    if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
      const shape = conditionalBlockShape(child.expression);
      if (shape && !validateDerivedExpression(shape.test, safeGlobals)) {
        const truthyAnalysis = shape.truthy
          ? analyzeRecursiveHostTree(
              shape.truthy,
              statesByValue,
              safeGlobals,
              listNames,
              parent,
              allocateId,
            )
          : { bindings: [], plans: [], blocks: new Map<t.JSXElement, HostDescriptorBlockPlan>() };
        const falsyAnalysis = shape.falsy
          ? analyzeRecursiveHostTree(
              shape.falsy,
              statesByValue,
              safeGlobals,
              listNames,
              parent,
              allocateId,
            )
          : { bindings: [], plans: [], blocks: new Map<t.JSXElement, HostDescriptorBlockPlan>() };
        if (!mergeAnalysis(truthyAnalysis) || !mergeAnalysis(falsyAnalysis)) return undefined;
        for (const dependency of collectStateDependencies(shape.test, statesByValue)) {
          dependencies.add(dependency);
        }
        ranges.push({
          rangeKind: "conditional",
          before: staticBefore,
          source: child.expression,
          test: cloneExpression(shape.test),
          logical: shape.logical,
          truthy: shape.truthy,
          falsy: shape.falsy,
          truthyBindings: truthyAnalysis.bindings,
          falsyBindings: falsyAnalysis.bindings,
        });
        conditionalCount += 1;
        staticBefore = 0;
        continue;
      }
    }

    const keyed = analyzeKeyedRowChild(child, statesByValue, safeGlobals, listNames, true);
    if (keyed) {
      if (keyed.events.length > 0) return undefined;
      const row = t.cloneNode(keyed.row, true);
      row.openingElement.attributes = row.openingElement.attributes.filter(
        (attribute) => !t.isJSXAttribute(attribute) || jsxAttributeName(attribute) !== "key",
      );
      const rowAnalysis = analyzeRecursiveHostTree(
        row,
        statesByValue,
        safeGlobals,
        listNames,
        parent,
        allocateId,
      );
      if (!mergeAnalysis(rowAnalysis)) return undefined;
      for (const dependency of keyed.dependencies) dependencies.add(dependency);
      ranges.push({
        rangeKind: "keyed",
        before: staticBefore,
        source: keyed.source,
        collection: keyed.collection,
        keyCallback: keyed.keyCallback,
        renderCallback: keyed.renderCallback,
        row,
        bindings: rowAnalysis.bindings,
        syntax: keyed.syntax,
      });
      keyedCount += 1;
      staticBefore = 0;
      continue;
    }

    if (!t.isJSXElement(child) || !isHostElement(child)) return undefined;
    const staticAnalysis = analyzeRecursiveHostTree(
      child,
      statesByValue,
      safeGlobals,
      listNames,
      parent,
      allocateId,
    );
    if (staticAnalysis.reason) return undefined;
    for (const binding of staticAnalysis.bindings) {
      staticBindings.push({
        ...binding,
        segment: ranges.length,
        sibling: staticBefore,
      });
    }
    if (!mergeAnalysis(staticAnalysis)) return undefined;
    staticBefore += 1;
  }

  if (conditionalCount === 0 || keyedCount === 0) return undefined;
  return {
    ranges,
    trailing: staticBefore,
    dependencies: [...dependencies].sort((left, right) => left - right),
    staticBindings,
    descriptorBlocks,
    nestedPlans,
  };
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

function hostElementDescriptor(
  element: t.JSXElement,
  descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan> = new Map(),
): t.ObjectExpression {
  const tag = element.openingElement.name as t.JSXIdentifier;
  const attributes: t.ObjectExpression[] = [];
  const styles: t.ObjectExpression[] = [];

  for (const attribute of element.openingElement.attributes) {
    if (!t.isJSXAttribute(attribute)) continue;
    const name = jsxAttributeName(attribute);
    if (!name || name === "key" || name === "ref" || /^on[A-Z]/.test(name)) continue;
    if (name === "style") {
      if (
        t.isJSXExpressionContainer(attribute.value) &&
        t.isObjectExpression(attribute.value.expression)
      ) {
        for (const property of attribute.value.expression.properties) {
          if (!t.isObjectProperty(property) || !t.isExpression(property.value)) continue;
          const propertyName = t.isIdentifier(property.key)
            ? property.key.name
            : (property.key as t.StringLiteral).value;
          styles.push(
            t.objectExpression([
              t.objectProperty(t.identifier("name"), t.stringLiteral(propertyName)),
              t.objectProperty(t.identifier("value"), cloneExpression(property.value)),
            ]),
          );
        }
      }
      continue;
    }

    const value = attribute.value
      ? t.isStringLiteral(attribute.value)
        ? t.stringLiteral(attribute.value.value)
        : t.isJSXExpressionContainer(attribute.value) &&
            !t.isJSXEmptyExpression(attribute.value.expression)
          ? cloneExpression(attribute.value.expression)
          : t.identifier("undefined")
      : t.booleanLiteral(true);
    attributes.push(
      t.objectExpression([
        t.objectProperty(t.identifier("name"), t.stringLiteral(name)),
        t.objectProperty(t.identifier("value"), value),
      ]),
    );
  }

  const block = descriptorBlocks.get(element);
  const conditionalBySource = new Map<t.Node, ConditionalRangePlan>();
  const keyedBySource = new Map<t.Node, KeyedRangePlan>();
  if (block?.kind === "nested-host-conditional-ranges") {
    for (const range of block.ranges) conditionalBySource.set(range.source, range);
  } else if (block?.kind === "nested-host-keyed-ranges") {
    for (const range of block.ranges) keyedBySource.set(range.source, range);
  } else if (block?.kind === "nested-host-mixed-ranges") {
    for (const range of block.ranges) {
      if (range.rangeKind === "conditional") conditionalBySource.set(range.source, range);
      else keyedBySource.set(range.source, range);
    }
  }

  const children: t.Expression[] = [];
  for (const child of element.children) {
    if (t.isJSXText(child)) {
      const text = cleanJsxText(child.value);
      if (text) children.push(t.stringLiteral(text));
    } else if (t.isJSXElement(child)) {
      const keyedRange = keyedBySource.get(child);
      if (keyedRange) {
        if (block?.kind !== "nested-host-keyed-ranges") {
          children.push(keyedRangeDescriptorChildren(keyedRange, descriptorBlocks));
        }
      } else {
        children.push(hostElementDescriptor(child, descriptorBlocks));
      }
    } else if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
      const conditionalRange = conditionalBySource.get(child.expression);
      const keyedRange = keyedBySource.get(child.expression);
      if (conditionalRange) {
        children.push(conditionalRangeDescriptorChild(conditionalRange, descriptorBlocks));
      } else if (keyedRange) {
        if (block?.kind !== "nested-host-keyed-ranges") {
          children.push(keyedRangeDescriptorChildren(keyedRange, descriptorBlocks));
        }
      } else {
        children.push(cloneExpression(child.expression));
      }
    }
  }

  const properties: Array<t.ObjectProperty> = [
    t.objectProperty(t.identifier("kind"), t.stringLiteral("element")),
    t.objectProperty(t.identifier("tag"), t.stringLiteral(tag.name)),
    t.objectProperty(t.identifier("attributes"), t.arrayExpression(attributes)),
    t.objectProperty(t.identifier("styles"), t.arrayExpression(styles)),
    t.objectProperty(t.identifier("children"), t.arrayExpression(children)),
  ];
  if (block) {
    properties.push(
      t.objectProperty(t.identifier("block"), nestedHostBlockObject(block, descriptorBlocks)),
    );
  }
  return t.objectExpression(properties);
}

function conditionalRangeDescriptorChild(
  range: ConditionalRangePlan,
  descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>,
): t.Expression {
  const truthy = range.truthy
    ? hostElementDescriptor(range.truthy, descriptorBlocks)
    : t.nullLiteral();
  if (range.logical) {
    return t.logicalExpression("&&", cloneExpression(range.test), truthy);
  }
  return t.conditionalExpression(
    cloneExpression(range.test),
    truthy,
    range.falsy ? hostElementDescriptor(range.falsy, descriptorBlocks) : t.nullLiteral(),
  );
}

function keyedRangeDescriptorChildren(
  range: KeyedRangePlan,
  descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>,
): t.Expression {
  const parameters = range.renderCallback.params.map((parameter) =>
    t.cloneNode(parameter, true),
  ) as t.Identifier[];
  const callback = t.arrowFunctionExpression(
    parameters,
    hostElementDescriptor(range.row, descriptorBlocks),
  );
  const collection = cloneExpression(range.collection);
  if (range.syntax === "map") {
    return t.callExpression(t.memberExpression(collection, t.identifier("map")), [callback]);
  }
  return t.callExpression(
    t.memberExpression(
      t.callExpression(t.memberExpression(t.identifier("Array"), t.identifier("from")), [
        t.logicalExpression("||", collection, t.arrayExpression([])),
      ]),
      t.identifier("map"),
    ),
    [callback],
  );
}

function keyedRowBindingObject(
  binding: PendingKeyedRowBinding,
  parameters: readonly t.Identifier[],
): t.ObjectExpression {
  const properties: t.ObjectProperty[] = [
    t.objectProperty(t.identifier("kind"), t.stringLiteral(binding.kind)),
    t.objectProperty(
      t.identifier("path"),
      t.arrayExpression(binding.path.map((part) => t.numericLiteral(part))),
    ),
    t.objectProperty(
      t.identifier("dependencies"),
      t.arrayExpression(
        (binding.dependencies || []).map((dependency) => t.numericLiteral(dependency)),
      ),
    ),
  ];
  if (binding.name) {
    properties.push(t.objectProperty(t.identifier("name"), t.stringLiteral(binding.name)));
  }
  properties.push(
    t.objectProperty(
      t.identifier("read"),
      t.arrowFunctionExpression(
        parameters.map((parameter) => t.cloneNode(parameter, true)),
        cloneExpression(binding.value),
      ),
    ),
  );
  return t.objectExpression(properties);
}

function staticRangeBindingObject(binding: PendingStaticRangeBinding): t.ObjectExpression {
  const value = keyedRowBindingObject(binding, []);
  value.properties.splice(
    1,
    0,
    t.objectProperty(t.identifier("segment"), t.numericLiteral(binding.segment)),
    t.objectProperty(t.identifier("sibling"), t.numericLiteral(binding.sibling)),
  );
  return value;
}

function uniqueLocalIdentifier(base: string, nodes: readonly t.Node[]): t.Identifier {
  const names = new Set<string>();
  for (const node of nodes) {
    t.traverseFast(node, (child) => {
      if (t.isIdentifier(child)) names.add(child.name);
    });
  }
  let name = base;
  let suffix = 2;
  while (names.has(name)) name = `${base}${suffix++}`;
  return t.identifier(name);
}

function rewriteKeyedRowEventAttributes(
  row: t.JSXElement,
  events: readonly PendingKeyedRowEvent[],
  eventFactory: t.Identifier,
  item: t.Identifier,
  index: t.Expression,
): void {
  const eventByLocation = new Map(
    events.map((event) => [`${event.path.join(".")}:${event.name}`, event] as const),
  );
  const visit = (element: t.JSXElement, path: number[]): void => {
    for (const attribute of element.openingElement.attributes) {
      if (!t.isJSXAttribute(attribute)) continue;
      const name = jsxAttributeName(attribute);
      if (!name || !/^on[A-Z]/.test(name)) continue;
      const event = eventByLocation.get(`${path.join(".")}:${name}`);
      if (!event) continue;
      attribute.value = t.jsxExpressionContainer(
        t.callExpression(t.cloneNode(eventFactory), [
          t.cloneNode(item),
          t.cloneNode(index),
          t.numericLiteral(event.id),
        ]),
      );
    }

    let elementIndex = 0;
    for (const child of element.children) {
      if (!t.isJSXElement(child)) continue;
      visit(child, [...path, elementIndex]);
      elementIndex += 1;
    }
  };
  visit(row, []);
}

function rewriteKeyedRowConditionalExpressions(
  row: t.JSXElement,
  conditionals: readonly PendingKeyedRowConditional[],
  conditionalFactory: t.Identifier,
  item: t.Identifier,
  index: t.Expression,
  renderParameters: readonly t.Identifier[],
): void {
  const conditionalByLocation = new Map(
    conditionals.map((conditional) => [conditional.path.join("."), conditional] as const),
  );
  const visit = (element: t.JSXElement, path: number[]): void => {
    const conditional = conditionalByLocation.get(path.join("."));
    if (conditional) {
      element.children = element.children.map((child) => {
        if (
          !t.isJSXExpressionContainer(child) ||
          t.isJSXEmptyExpression(child.expression) ||
          !conditionalBlockShape(child.expression)
        ) {
          return child;
        }
        return t.jsxExpressionContainer(
          t.callExpression(t.cloneNode(conditionalFactory), [
            t.cloneNode(item),
            t.cloneNode(index),
            t.numericLiteral(conditional.id),
            t.arrowFunctionExpression(
              renderParameters.map((parameter) => t.cloneNode(parameter, true)),
              cloneExpression(child.expression),
            ),
          ]),
        );
      });
      return;
    }

    let elementIndex = 0;
    for (const child of element.children) {
      if (!t.isJSXElement(child)) continue;
      visit(child, [...path, elementIndex]);
      elementIndex += 1;
    }
  };
  visit(row, []);
}

function keyedRowsRenderSource(
  plan: KeyedRowsPlan,
  eventFactory: t.Identifier,
  conditionalFactory: t.Identifier,
): t.JSXElement {
  const source = t.cloneNode(plan.source, true);
  const child = meaningfulJsxChildren(source)[0];
  let callback: t.ArrowFunctionExpression | t.FunctionExpression | undefined;
  if (
    plan.syntax === "map" &&
    t.isJSXExpressionContainer(child) &&
    !t.isJSXEmptyExpression(child.expression) &&
    isMapCall(child.expression)
  ) {
    const candidate = child.expression.arguments[0];
    if (t.isArrowFunctionExpression(candidate) || t.isFunctionExpression(candidate)) {
      callback = candidate;
    }
  } else if (plan.syntax === "list" && t.isJSXElement(child)) {
    const renderChild = meaningfulJsxChildren(child)[0];
    if (
      t.isJSXExpressionContainer(renderChild) &&
      !t.isJSXEmptyExpression(renderChild.expression) &&
      (t.isArrowFunctionExpression(renderChild.expression) ||
        t.isFunctionExpression(renderChild.expression))
    ) {
      callback = renderChild.expression;
    }
  }
  const row = callback && returnedExpression(callback);
  const item = callback?.params[0];
  const index = callback?.params[1];
  if (!callback || !t.isJSXElement(row) || !t.isIdentifier(item)) return source;
  const runtimeIndex = t.isIdentifier(index) ? index : t.numericLiteral(0);
  if (plan.events.length > 0) {
    rewriteKeyedRowEventAttributes(row, plan.events, eventFactory, item, runtimeIndex);
  }
  if (plan.conditionals.length > 0) {
    rewriteKeyedRowConditionalExpressions(
      row,
      plan.conditionals,
      conditionalFactory,
      item,
      runtimeIndex,
      callback.params as t.Identifier[],
    );
  }
  return source;
}

function keyedRowEventObject(
  event: PendingKeyedRowEvent,
  renderParameters: readonly t.Identifier[],
): t.ObjectExpression {
  const nodes = [event.value, ...renderParameters];
  const index = renderParameters[1]
    ? t.cloneNode(renderParameters[1], true)
    : uniqueLocalIdentifier("_farmRowIndex", nodes);
  const syntheticEvent = uniqueLocalIdentifier("_farmEvent", [...nodes, index]);
  const parameters = [t.cloneNode(renderParameters[0], true), index, syntheticEvent];
  return t.objectExpression([
    t.objectProperty(t.identifier("name"), t.stringLiteral(event.name)),
    t.objectProperty(
      t.identifier("path"),
      t.arrayExpression(event.path.map((part) => t.numericLiteral(part))),
    ),
    t.objectProperty(
      t.identifier("invoke"),
      t.arrowFunctionExpression(
        parameters,
        t.callExpression(t.parenthesizedExpression(t.cloneNode(event.value, true)), [
          t.cloneNode(syntheticEvent),
        ]),
      ),
    ),
  ]);
}

function keyedRowConditionalBranchObject(
  bindings: readonly PendingKeyedRowBinding[],
  parameters: readonly t.Identifier[],
): t.ObjectExpression {
  return t.objectExpression([
    t.objectProperty(
      t.identifier("bindings"),
      t.arrayExpression(bindings.map((binding) => keyedRowBindingObject(binding, parameters))),
    ),
  ]);
}

function keyedRowConditionalObject(
  conditional: PendingKeyedRowConditional,
  parameters: readonly t.Identifier[],
): t.ObjectExpression {
  const properties: t.ObjectProperty[] = [
    t.objectProperty(t.identifier("id"), t.numericLiteral(conditional.id)),
    t.objectProperty(
      t.identifier("path"),
      t.arrayExpression(conditional.path.map((part) => t.numericLiteral(part))),
    ),
    t.objectProperty(
      t.identifier("test"),
      t.arrowFunctionExpression(
        parameters.map((parameter) => t.cloneNode(parameter, true)),
        cloneExpression(conditional.test),
      ),
    ),
    t.objectProperty(t.identifier("logical"), t.booleanLiteral(conditional.logical)),
  ];
  if (conditional.truthy) {
    properties.push(
      t.objectProperty(
        t.identifier("truthy"),
        keyedRowConditionalBranchObject(conditional.truthyBindings, parameters),
      ),
    );
  }
  if (conditional.falsy) {
    properties.push(
      t.objectProperty(
        t.identifier("falsy"),
        keyedRowConditionalBranchObject(conditional.falsyBindings, parameters),
      ),
    );
  }
  return t.objectExpression(properties);
}

function keyedRowsBoundary(blockRuntime: t.Identifier, plan: KeyedRowsPlan): t.JSXElement {
  const name = t.jsxMemberExpression(
    t.jsxIdentifier(blockRuntime.name),
    t.jsxIdentifier("KeyedRows"),
  );
  const parameters = plan.renderCallback.params.map((parameter) =>
    t.cloneNode(parameter, true),
  ) as t.Identifier[];
  const eventFactory = uniqueLocalIdentifier("_farmRowEvent", [
    plan.source,
    ...plan.events.map((event) => event.value),
  ]);
  const conditionalFactory = uniqueLocalIdentifier("_farmRowConditional", [
    plan.source,
    ...plan.conditionals.map((conditional) => conditional.test),
  ]);
  const delegatedEvents = canDelegateKeyedRowEvents(plan);
  const renderSource = keyedRowsRenderSource(plan, eventFactory, conditionalFactory);
  const renderFactoryParameters =
    plan.conditionals.length > 0
      ? [t.cloneNode(eventFactory), t.cloneNode(conditionalFactory)]
      : plan.events.length > 0
        ? [t.cloneNode(eventFactory)]
        : [];
  return t.jsxElement(
    t.jsxOpeningElement(
      name,
      [
        t.jsxAttribute(t.jsxIdentifier("id"), t.jsxExpressionContainer(t.numericLiteral(plan.id))),
        t.jsxAttribute(
          t.jsxIdentifier("render"),
          t.jsxExpressionContainer(
            t.arrowFunctionExpression(renderFactoryParameters, renderSource),
          ),
        ),
        t.jsxAttribute(
          t.jsxIdentifier("items"),
          t.jsxExpressionContainer(t.arrowFunctionExpression([], cloneExpression(plan.collection))),
        ),
        t.jsxAttribute(
          t.jsxIdentifier("structureDependencies"),
          t.jsxExpressionContainer(
            t.arrayExpression(
              plan.structureDependencies.map((dependency) => t.numericLiteral(dependency)),
            ),
          ),
        ),
        t.jsxAttribute(
          t.jsxIdentifier("rowKey"),
          t.jsxExpressionContainer(t.cloneNode(plan.keyCallback, true)),
        ),
        t.jsxAttribute(
          t.jsxIdentifier("create"),
          t.jsxExpressionContainer(
            t.arrowFunctionExpression(
              parameters.map((parameter) => t.cloneNode(parameter, true)),
              hostElementDescriptor(plan.row, plan.descriptorBlocks),
            ),
          ),
        ),
        t.jsxAttribute(
          t.jsxIdentifier("bindings"),
          t.jsxExpressionContainer(
            t.arrayExpression(
              plan.bindings.map((binding) => keyedRowBindingObject(binding, parameters)),
            ),
          ),
        ),
        ...(plan.events.length > 0
          ? [
              t.jsxAttribute(
                t.jsxIdentifier("events"),
                t.jsxExpressionContainer(
                  t.arrayExpression(
                    plan.events.map((event) => keyedRowEventObject(event, parameters)),
                  ),
                ),
              ),
              ...(delegatedEvents
                ? [
                    t.jsxAttribute(
                      t.jsxIdentifier("delegateEvents"),
                      t.jsxExpressionContainer(t.booleanLiteral(true)),
                    ),
                  ]
                : []),
            ]
          : []),
        ...(plan.conditionals.length > 0
          ? [
              t.jsxAttribute(
                t.jsxIdentifier("conditionals"),
                t.jsxExpressionContainer(
                  t.arrayExpression(
                    plan.conditionals.map((conditional) =>
                      keyedRowConditionalObject(conditional, parameters),
                    ),
                  ),
                ),
              ),
            ]
          : []),
        ...(plan.descriptorBlocks?.size
          ? [
              t.jsxAttribute(
                t.jsxIdentifier("hostBlocks"),
                t.jsxExpressionContainer(t.booleanLiteral(true)),
              ),
            ]
          : []),
      ],
      true,
    ),
    null,
    [],
    true,
  );
}

function keyedRangeObject(
  range: KeyedRangePlan,
  descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan> = new Map(),
): t.ObjectExpression {
  const parameters = range.renderCallback.params.map((parameter) =>
    t.cloneNode(parameter, true),
  ) as t.Identifier[];
  return t.objectExpression([
    t.objectProperty(t.identifier("before"), t.numericLiteral(range.before)),
    t.objectProperty(
      t.identifier("items"),
      t.arrowFunctionExpression([], cloneExpression(range.collection)),
    ),
    t.objectProperty(t.identifier("rowKey"), t.cloneNode(range.keyCallback, true)),
    t.objectProperty(
      t.identifier("create"),
      t.arrowFunctionExpression(
        parameters.map((parameter) => t.cloneNode(parameter, true)),
        hostElementDescriptor(range.row, descriptorBlocks),
      ),
    ),
    t.objectProperty(
      t.identifier("bindings"),
      t.arrayExpression(
        range.bindings.map((binding) => keyedRowBindingObject(binding, parameters)),
      ),
    ),
  ]);
}

function keyedRangesBoundary(blockRuntime: t.Identifier, plan: KeyedRangesPlan): t.JSXElement {
  const name = t.jsxMemberExpression(
    t.jsxIdentifier(blockRuntime.name),
    t.jsxIdentifier("KeyedRanges"),
  );
  const source = t.cloneNode(plan.source, true);
  let rootRef: t.Expression | undefined;
  source.openingElement.attributes = source.openingElement.attributes.filter((attribute) => {
    if (
      !t.isJSXAttribute(attribute) ||
      jsxAttributeName(attribute) !== "ref" ||
      !t.isJSXExpressionContainer(attribute.value) ||
      t.isJSXEmptyExpression(attribute.value.expression)
    ) {
      return true;
    }
    rootRef = cloneExpression(attribute.value.expression);
    return false;
  });
  return t.jsxElement(
    t.jsxOpeningElement(
      name,
      [
        t.jsxAttribute(t.jsxIdentifier("id"), t.jsxExpressionContainer(t.numericLiteral(plan.id))),
        t.jsxAttribute(
          t.jsxIdentifier("render"),
          t.jsxExpressionContainer(t.arrowFunctionExpression([], source)),
        ),
        ...(rootRef
          ? [t.jsxAttribute(t.jsxIdentifier("rootRef"), t.jsxExpressionContainer(rootRef))]
          : []),
        t.jsxAttribute(
          t.jsxIdentifier("ranges"),
          t.jsxExpressionContainer(
            t.arrayExpression(plan.ranges.map((range) => keyedRangeObject(range))),
          ),
        ),
        t.jsxAttribute(
          t.jsxIdentifier("trailing"),
          t.jsxExpressionContainer(t.numericLiteral(plan.trailing)),
        ),
        t.jsxAttribute(
          t.jsxIdentifier("bindings"),
          t.jsxExpressionContainer(
            t.arrayExpression(plan.staticBindings.map(staticRangeBindingObject)),
          ),
        ),
      ],
      true,
    ),
    null,
    [],
    true,
  );
}

function hostConditionalBranchObject(
  branch: t.JSXElement,
  bindings: readonly PendingKeyedRowBinding[],
  descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan> = new Map(),
): t.ObjectExpression {
  return t.objectExpression([
    t.objectProperty(
      t.identifier("create"),
      t.arrowFunctionExpression([], hostElementDescriptor(branch, descriptorBlocks)),
    ),
    t.objectProperty(
      t.identifier("bindings"),
      t.arrayExpression(bindings.map((binding) => keyedRowBindingObject(binding, []))),
    ),
  ]);
}

function hostConditionalBoundary(
  blockRuntime: t.Identifier,
  plan: HostConditionalPlan,
): t.JSXElement {
  const name = t.jsxMemberExpression(
    t.jsxIdentifier(blockRuntime.name),
    t.jsxIdentifier("HostConditional"),
  );
  const attributes: t.JSXAttribute[] = [
    t.jsxAttribute(t.jsxIdentifier("id"), t.jsxExpressionContainer(t.numericLiteral(plan.id))),
    t.jsxAttribute(
      t.jsxIdentifier("render"),
      t.jsxExpressionContainer(t.arrowFunctionExpression([], t.cloneNode(plan.source, true))),
    ),
    t.jsxAttribute(
      t.jsxIdentifier("test"),
      t.jsxExpressionContainer(t.arrowFunctionExpression([], cloneExpression(plan.test))),
    ),
  ];
  if (plan.logical) attributes.push(t.jsxAttribute(t.jsxIdentifier("logical")));
  if (plan.truthy) {
    attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier("truthy"),
        t.jsxExpressionContainer(
          hostConditionalBranchObject(plan.truthy, plan.truthyBindings, plan.descriptorBlocks),
        ),
      ),
    );
  }
  if (plan.falsy) {
    attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier("falsy"),
        t.jsxExpressionContainer(
          hostConditionalBranchObject(plan.falsy, plan.falsyBindings, plan.descriptorBlocks),
        ),
      ),
    );
  }
  return t.jsxElement(t.jsxOpeningElement(name, attributes, true), null, [], true);
}

function conditionalRangeObject(
  range: ConditionalRangePlan,
  descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan> = new Map(),
): t.ObjectExpression {
  const properties: t.ObjectProperty[] = [
    t.objectProperty(t.identifier("before"), t.numericLiteral(range.before)),
    t.objectProperty(
      t.identifier("test"),
      t.arrowFunctionExpression([], cloneExpression(range.test)),
    ),
  ];
  if (range.logical) {
    properties.push(t.objectProperty(t.identifier("logical"), t.booleanLiteral(true)));
  }
  if (range.truthy) {
    properties.push(
      t.objectProperty(
        t.identifier("truthy"),
        hostConditionalBranchObject(range.truthy, range.truthyBindings, descriptorBlocks),
      ),
    );
  }
  if (range.falsy) {
    properties.push(
      t.objectProperty(
        t.identifier("falsy"),
        hostConditionalBranchObject(range.falsy, range.falsyBindings, descriptorBlocks),
      ),
    );
  }
  return t.objectExpression(properties);
}

function nestedHostBlockObject(
  plan: HostDescriptorBlockPlan,
  descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>,
): t.ObjectExpression {
  const kind =
    plan.kind === "nested-host-conditional-ranges"
      ? "conditional-ranges"
      : plan.kind === "nested-host-keyed-ranges"
        ? "keyed-ranges"
        : "mixed-ranges";
  return t.objectExpression([
    t.objectProperty(t.identifier("kind"), t.stringLiteral(kind)),
    t.objectProperty(t.identifier("id"), t.numericLiteral(plan.id)),
    t.objectProperty(
      t.identifier("ranges"),
      t.arrayExpression(
        plan.kind === "nested-host-conditional-ranges"
          ? plan.ranges.map((range) => conditionalRangeObject(range, descriptorBlocks))
          : plan.kind === "nested-host-keyed-ranges"
            ? plan.ranges.map((range) => keyedRangeObject(range, descriptorBlocks))
            : plan.ranges.map((range) => mixedRangeObject(range, descriptorBlocks)),
      ),
    ),
    t.objectProperty(t.identifier("trailing"), t.numericLiteral(plan.trailing)),
    t.objectProperty(
      t.identifier("bindings"),
      t.arrayExpression(plan.staticBindings.map(staticRangeBindingObject)),
    ),
    ...(plan.kind === "nested-host-keyed-ranges"
      ? [t.objectProperty(t.identifier("staticChildrenOnly"), t.booleanLiteral(true))]
      : []),
  ]);
}

function mixedRangeObject(
  range: MixedRangePlan,
  descriptorBlocks: ReadonlyMap<t.JSXElement, HostDescriptorBlockPlan>,
): t.ObjectExpression {
  const value =
    range.rangeKind === "conditional"
      ? conditionalRangeObject(range, descriptorBlocks)
      : keyedRangeObject(range, descriptorBlocks);
  value.properties.unshift(
    t.objectProperty(t.identifier("kind"), t.stringLiteral(range.rangeKind)),
  );
  return value;
}

function mixedRangesBoundary(blockRuntime: t.Identifier, plan: MixedRangesPlan): t.JSXElement {
  const name = t.jsxMemberExpression(
    t.jsxIdentifier(blockRuntime.name),
    t.jsxIdentifier("MixedRanges"),
  );
  const source = t.cloneNode(plan.source, true);
  const rootRefIndex = source.openingElement.attributes.findIndex(
    (attribute) => t.isJSXAttribute(attribute) && jsxAttributeName(attribute) === "ref",
  );
  const rootRef =
    rootRefIndex >= 0
      ? (source.openingElement.attributes.splice(rootRefIndex, 1)[0] as t.JSXAttribute)
      : undefined;
  const nestedPlan: NestedHostMixedRangesPlan = {
    kind: "nested-host-mixed-ranges",
    id: plan.id,
    parent: plan.parent,
    dependencies: plan.dependencies,
    source: plan.source,
    ranges: plan.ranges,
    trailing: plan.trailing,
    staticBindings: plan.staticBindings,
  };
  const descriptorBlocks = new Map(plan.descriptorBlocks);
  descriptorBlocks.set(plan.source, nestedPlan);
  const attributes: t.JSXAttribute[] = [
    t.jsxAttribute(t.jsxIdentifier("id"), t.jsxExpressionContainer(t.numericLiteral(plan.id))),
    t.jsxAttribute(
      t.jsxIdentifier("render"),
      t.jsxExpressionContainer(t.arrowFunctionExpression([], source)),
    ),
    t.jsxAttribute(
      t.jsxIdentifier("create"),
      t.jsxExpressionContainer(
        t.arrowFunctionExpression([], hostElementDescriptor(plan.source, descriptorBlocks)),
      ),
    ),
  ];
  if (rootRef?.value) {
    attributes.push(t.jsxAttribute(t.jsxIdentifier("rootRef"), t.cloneNode(rootRef.value, true)));
  }
  return t.jsxElement(t.jsxOpeningElement(name, attributes, true), null, [], true);
}

function conditionalRangesBoundary(
  blockRuntime: t.Identifier,
  plan: ConditionalRangesPlan,
): t.JSXElement {
  const name = t.jsxMemberExpression(
    t.jsxIdentifier(blockRuntime.name),
    t.jsxIdentifier("ConditionalRanges"),
  );
  const source = t.cloneNode(plan.source, true);
  const rootRefIndex = source.openingElement.attributes.findIndex(
    (attribute) =>
      t.isJSXAttribute(attribute) &&
      t.isJSXIdentifier(attribute.name) &&
      attribute.name.name === "ref",
  );
  const rootRef =
    rootRefIndex >= 0
      ? (source.openingElement.attributes.splice(rootRefIndex, 1)[0] as t.JSXAttribute)
      : undefined;
  const attributes: t.JSXAttribute[] = [
    t.jsxAttribute(t.jsxIdentifier("id"), t.jsxExpressionContainer(t.numericLiteral(plan.id))),
    t.jsxAttribute(
      t.jsxIdentifier("render"),
      t.jsxExpressionContainer(t.arrowFunctionExpression([], source)),
    ),
    t.jsxAttribute(
      t.jsxIdentifier("ranges"),
      t.jsxExpressionContainer(
        t.arrayExpression(
          plan.ranges.map((range) => conditionalRangeObject(range, plan.descriptorBlocks)),
        ),
      ),
    ),
    t.jsxAttribute(
      t.jsxIdentifier("trailing"),
      t.jsxExpressionContainer(t.numericLiteral(plan.trailing)),
    ),
    t.jsxAttribute(
      t.jsxIdentifier("bindings"),
      t.jsxExpressionContainer(
        t.arrayExpression(plan.staticBindings.map(staticRangeBindingObject)),
      ),
    ),
  ];
  if (rootRef?.value) {
    attributes.push(t.jsxAttribute(t.jsxIdentifier("rootRef"), t.cloneNode(rootRef.value, true)));
  }
  return t.jsxElement(t.jsxOpeningElement(name, attributes, true), null, [], true);
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
  ownedElements?: Set<t.JSXElement>;
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
  const ownedElements = new Set<t.JSXElement>();
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
          const mixedRangeStart = nextId;
          const mixedRangeId = nextId++;
          const mixedRanges = insideConditional
            ? undefined
            : analyzeMixedRangesContainer(
                child,
                statesByValue,
                safeGlobals,
                listNames,
                mixedRangeId,
                () => nextId++,
              );
          if (mixedRanges) {
            plans.push({
              kind: "mixed-ranges",
              id: mixedRangeId,
              parent,
              dependencies: mixedRanges.dependencies,
              source: child,
              ranges: mixedRanges.ranges,
              trailing: mixedRanges.trailing,
              staticBindings: mixedRanges.staticBindings,
              descriptorBlocks: mixedRanges.descriptorBlocks,
            });
            plans.push(...mixedRanges.nestedPlans);
            for (const range of mixedRanges.ranges) {
              if (range.rangeKind === "conditional") {
                conditionalExpressions.add(range.source);
              } else if (t.isJSXElement(range.source)) {
                ownedElements.add(range.source);
              } else {
                keyedExpressions.add(range.source);
              }
            }
            continue;
          }
          nextId = mixedRangeStart;
          const keyedRanges = insideConditional
            ? undefined
            : analyzeKeyedRangesContainer(child, statesByValue, safeGlobals, listNames);
          if (keyedRanges) {
            plans.push({
              kind: "keyed-ranges",
              id: nextId++,
              parent,
              dependencies: keyedRanges.dependencies,
              source: child,
              ranges: keyedRanges.ranges,
              trailing: keyedRanges.trailing,
              staticBindings: keyedRanges.staticBindings,
            });
            for (const range of keyedRanges.ranges) {
              if (t.isJSXElement(range.source)) ownedElements.add(range.source);
              else keyedExpressions.add(range.source);
            }
            continue;
          }
          const conditionalRangeStart = nextId;
          const conditionalRangeId = nextId++;
          const conditionalRanges = insideConditional
            ? undefined
            : analyzeConditionalRangesContainer(
                child,
                statesByValue,
                safeGlobals,
                false,
                listNames,
                conditionalRangeId,
                () => nextId++,
              );
          if (conditionalRanges) {
            plans.push({
              kind: "conditional-ranges",
              id: conditionalRangeId,
              parent,
              dependencies: conditionalRanges.dependencies,
              source: child,
              ranges: conditionalRanges.ranges,
              trailing: conditionalRanges.trailing,
              staticBindings: conditionalRanges.staticBindings,
              descriptorBlocks: conditionalRanges.descriptorBlocks,
            });
            plans.push(...(conditionalRanges.nestedPlans || []));
            for (const range of conditionalRanges.ranges) {
              conditionalExpressions.add(range.source);
            }
            continue;
          }
          nextId = conditionalRangeStart;
          const hostConditionalStart = nextId;
          const hostConditionalId = nextId++;
          const hostConditional = analyzeHostConditionalContainer(
            child,
            statesByValue,
            safeGlobals,
            listNames,
            hostConditionalId,
            () => nextId++,
          );
          if (hostConditional) {
            plans.push({
              kind: "host-conditional",
              id: hostConditionalId,
              parent,
              source: child,
              ...hostConditional,
            });
            plans.push(...(hostConditional.nestedPlans || []));
            ownedElements.add(child);
            continue;
          }
          nextId = hostConditionalStart;
          const keyedRowsStart = nextId;
          const keyedRowsId = nextId++;
          const keyedRows = analyzeKeyedRowsContainer(child, statesByValue, safeGlobals, listNames);
          if (keyedRows) {
            const nestedStart = nextId;
            const hostBlocks = analyzeCompilerOwnedKeyedRowHostBlocks(
              keyedRows,
              statesByValue,
              safeGlobals,
              listNames,
              keyedRowsId,
              () => nextId++,
            );
            if (!hostBlocks) nextId = nestedStart;
            if (keyedRows.rowReason && !hostBlocks) {
              nextId = keyedRowsStart;
              const nested = visitHost(child, parent, insideConditional);
              if (nested.reason) return { dependencies, reason: nested.reason };
              mergeDependencies(dependencies, nested.dependencies);
              continue;
            }
            plans.push({
              kind: "keyed-rows",
              id: keyedRowsId,
              parent,
              dependencies: keyedRows.dependencies,
              source: child,
              collection: keyedRows.collection,
              structureDependencies: keyedRows.structureDependencies,
              keyCallback: keyedRows.keyCallback,
              renderCallback: keyedRows.renderCallback,
              row: hostBlocks?.row || keyedRows.row,
              bindings: hostBlocks?.bindings || keyedRows.bindings,
              events: keyedRows.events,
              conditionals: hostBlocks ? [] : keyedRows.conditionals,
              descriptorBlocks: hostBlocks?.descriptorBlocks,
              syntax: keyedRows.syntax,
            });
            plans.push(...(hostBlocks?.nestedPlans || []));
            ownedElements.add(child);
            continue;
          }
          nextId = keyedRowsStart;
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
          ownedElements.add(child);
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

  const rootMixedRangeStart = nextId;
  const rootMixedRangeId = nextId++;
  const rootMixedRanges = analyzeMixedRangesContainer(
    root,
    statesByValue,
    safeGlobals,
    listNames,
    rootMixedRangeId,
    () => nextId++,
  );
  if (rootMixedRanges) {
    plans.push({
      kind: "mixed-ranges",
      id: rootMixedRangeId,
      dependencies: rootMixedRanges.dependencies,
      source: root,
      ranges: rootMixedRanges.ranges,
      trailing: rootMixedRanges.trailing,
      staticBindings: rootMixedRanges.staticBindings,
      descriptorBlocks: rootMixedRanges.descriptorBlocks,
    });
    plans.push(...rootMixedRanges.nestedPlans);
    for (const range of rootMixedRanges.ranges) {
      if (range.rangeKind === "conditional") {
        conditionalExpressions.add(range.source);
      } else if (t.isJSXElement(range.source)) {
        ownedElements.add(range.source);
      } else {
        keyedExpressions.add(range.source);
      }
    }
    return {
      plans,
      componentElements,
      conditionalExpressions,
      ownedElements,
      keyedExpressions,
    };
  }
  nextId = rootMixedRangeStart;

  const rootRanges = analyzeKeyedRangesContainer(root, statesByValue, safeGlobals, listNames, true);
  if (rootRanges) {
    plans.push({
      kind: "keyed-ranges",
      id: nextId++,
      dependencies: rootRanges.dependencies,
      source: root,
      ranges: rootRanges.ranges,
      trailing: rootRanges.trailing,
      staticBindings: rootRanges.staticBindings,
    });
    for (const range of rootRanges.ranges) {
      if (t.isJSXElement(range.source)) ownedElements.add(range.source);
      else keyedExpressions.add(range.source);
    }
    return {
      plans,
      componentElements,
      conditionalExpressions,
      ownedElements,
      keyedExpressions,
    };
  }

  const rootConditionalRangeStart = nextId;
  const rootConditionalRangeId = nextId++;
  const rootConditionalRanges = analyzeConditionalRangesContainer(
    root,
    statesByValue,
    safeGlobals,
    true,
    listNames,
    rootConditionalRangeId,
    () => nextId++,
  );
  if (rootConditionalRanges) {
    plans.push({
      kind: "conditional-ranges",
      id: rootConditionalRangeId,
      dependencies: rootConditionalRanges.dependencies,
      source: root,
      ranges: rootConditionalRanges.ranges,
      trailing: rootConditionalRanges.trailing,
      staticBindings: rootConditionalRanges.staticBindings,
      descriptorBlocks: rootConditionalRanges.descriptorBlocks,
    });
    plans.push(...(rootConditionalRanges.nestedPlans || []));
    for (const range of rootConditionalRanges.ranges) {
      conditionalExpressions.add(range.source);
    }
    return {
      plans,
      componentElements,
      conditionalExpressions,
      ownedElements,
      keyedExpressions,
    };
  }
  nextId = rootConditionalRangeStart;

  const result = visitHost(root, undefined, false);
  if (result.reason) return { reason: result.reason };
  return {
    plans,
    componentElements,
    conditionalExpressions,
    ownedElements,
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
  const rootPlan = planBySource.get(root);
  if (rootPlan?.kind === "mixed-ranges") {
    return mixedRangesBoundary(blockRuntime, rootPlan);
  }
  if (rootPlan?.kind === "keyed-ranges") {
    return keyedRangesBoundary(blockRuntime, rootPlan);
  }
  if (rootPlan?.kind === "conditional-ranges") {
    return conditionalRangesBoundary(blockRuntime, rootPlan);
  }

  const visit = (element: t.JSXElement): void => {
    element.children = element.children.map((child) => {
      if (t.isJSXElement(child)) {
        const plan = planBySource.get(child);
        if (plan?.kind === "host-conditional") {
          return hostConditionalBoundary(blockRuntime, plan);
        }
        if (plan?.kind === "mixed-ranges") {
          return mixedRangesBoundary(blockRuntime, plan);
        }
        if (plan?.kind === "keyed-rows") {
          return keyedRowsBoundary(blockRuntime, plan);
        }
        if (plan?.kind === "keyed-ranges") {
          return keyedRangesBoundary(blockRuntime, plan);
        }
        if (plan?.kind === "conditional-ranges") {
          return conditionalRangesBoundary(blockRuntime, plan);
        }
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

function markShortCircuitBindings(bindings: readonly PendingBinding[]): void {
  for (const binding of bindings) {
    if (binding.kind === "block" || binding.dependencies.length < 2) continue;
    let shortCircuits = false;
    traverse(expressionFile(t.cloneNode(binding.value, true)), {
      ConditionalExpression(path) {
        shortCircuits = true;
        path.stop();
      },
      LogicalExpression(path) {
        shortCircuits = true;
        path.stop();
      },
      OptionalCallExpression(path) {
        shortCircuits = true;
        path.stop();
      },
      OptionalMemberExpression(path) {
        shortCircuits = true;
        path.stop();
      },
    });
    if (shortCircuits) binding.tracking = "dynamic";
  }
}

function lowerStableBindingTargets(
  root: t.JSXElement,
  bindings: readonly PendingBinding[],
  blockRuntime: t.Identifier,
  ownedElements: ReadonlySet<t.JSXElement>,
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
      if (ownedElements.has(child)) continue;
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
  ownedElements: ReadonlySet<t.JSXElement>,
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
        t.isJSXElement(child) && isHostElement(child) && !ownedElements.has(child),
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

    const hasOwnedElement = element.children.some(
      (child) => t.isJSXElement(child) && ownedElements.has(child),
    );
    const hasComponentElement = element.children.some(
      (child) => t.isJSXElement(child) && componentElements.has(child),
    );
    const hasDynamicBlocks =
      hasOwnedElement ||
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
        if (!t.isJSXElement(child) || !isHostElement(child) || ownedElements.has(child)) continue;
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
  if (binding.tracking) {
    properties.push(t.objectProperty(t.identifier("tracking"), t.stringLiteral(binding.tracking)));
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
  runtimeFeatureIdentifiers: ReadonlyMap<CompilerRuntimeFeatureName, t.Identifier>,
  usedRuntimeFeatures: Set<CompilerRuntimeFeatureName>,
  useStateNames: ReadonlySet<string>,
  reactNames: ReadonlySet<string>,
  listNames: ReadonlySet<string>,
  moduleId: string,
  reactivity: NormalizedReactCompilerOptions["reactivity"],
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
    const unsupported = collectionPipelineMethod(expanded)
      ? validateCollectionPipeline(expanded, safeGlobals)
      : validateDerivedExpression(expanded, safeGlobals);
    if (unsupported) {
      return `derived local ${binding.name} cannot use ${unsupported}`;
    }
    derivedByName.set(binding.name, expanded);
  }
  const rootWithDerived = rewriteDerivedAccess(returned.argument, derivedByName) as t.JSXElement;
  const handlerRewrite = rewriteHandlerAccess(rootWithDerived, handlersByName);
  if (handlerRewrite.reason) return handlerRewrite.reason;
  if (!handlerRewrite.root) return "event handlers could not be prepared safely";
  const expandedRootWithDeferredEvents = rewriteDestructuredPropAccess(
    handlerRewrite.root,
    propsPlan.destructuredNames,
    propsPlan.definitionParameter,
  );
  const expandedRoot = stabilizeDeferredEventCurrentTargets(
    expandedRootWithDeferredEvents,
    new Set(states.map((state) => state.setterName)),
  );
  const setterReason = validateSetterUsage(expandedRoot, statesBySetter);
  if (setterReason) return setterReason;
  const referencedPropNames = collectDestructuredPropNames(
    expandedRoot,
    propsPlan.destructuredNames,
    propsPlan.definitionParameter,
  );
  // React children and identity-bearing values remain on React's normal prop
  // reconciliation path. Other flat destructured props get runtime-validated
  // primitive cells so the compiled render plan can stay mounted.
  let propBindings = referencedPropNames.has("children")
    ? []
    : [...propsPlan.destructuredNames]
        .filter((propName) => referencedPropNames.has(propName))
        .map(
          (localName, propIndex): PropBinding => ({
            localName,
            valueName: path.scope.generateUidIdentifier(`farmProp${propIndex}`).name,
            index: states.length + propIndex,
          }),
        );
  const propBindingsByName = new Map(propBindings.map((binding) => [binding.localName, binding]));
  let reactiveByValue = new Map(statesByValue);
  for (const binding of propBindings) {
    reactiveByValue.set(binding.valueName, {
      valueName: binding.valueName,
      setterName: "",
      index: binding.index,
    });
  }
  let expandedReactiveRoot = rewriteTrackedPropAccess(
    expandedRoot,
    propsPlan.definitionParameter,
    propBindingsByName,
  ) as t.JSXElement;
  const referencedComponentNames = new Set<string>();
  traverse(expressionFile(t.cloneNode(expandedReactiveRoot, true)), {
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
  let blockAnalysis = analyzeComposableBlocks(
    expandedReactiveRoot,
    reactiveByValue,
    safeGlobals,
    listNames,
    allowedComponentNames,
  );
  let analysis = analyzeHostTree(
    expandedReactiveRoot,
    reactiveByValue,
    safeGlobals,
    blockAnalysis.conditionalExpressions || new Set<t.Expression>(),
    blockAnalysis.keyedExpressions || new Set<t.Expression>(),
    blockAnalysis.ownedElements || new Set<t.JSXElement>(),
    blockAnalysis.componentElements || new Set<t.JSXElement>(),
  );
  if (propBindings.length > 0 && (blockAnalysis.reason || analysis.reason)) {
    // Prop reactivity is optional inside an already eligible local-state
    // component. Preserve the established React prop path when the added prop
    // dependency makes a shape exceed the narrower prop-cell proof.
    propBindings = [];
    reactiveByValue = new Map(statesByValue);
    expandedReactiveRoot = t.cloneNode(expandedRoot, true);
    blockAnalysis = analyzeComposableBlocks(
      expandedReactiveRoot,
      reactiveByValue,
      safeGlobals,
      listNames,
      allowedComponentNames,
    );
    analysis = analyzeHostTree(
      expandedReactiveRoot,
      reactiveByValue,
      safeGlobals,
      blockAnalysis.conditionalExpressions || new Set<t.Expression>(),
      blockAnalysis.keyedExpressions || new Set<t.Expression>(),
      blockAnalysis.ownedElements || new Set<t.JSXElement>(),
      blockAnalysis.componentElements || new Set<t.JSXElement>(),
    );
  }
  if (blockAnalysis.reason) return blockAnalysis.reason;
  if (analysis.reason) return analysis.reason;
  const blockPlans = blockAnalysis.plans || [];
  const runtimeFeatures = runtimeFeaturesForPlans(blockPlans);
  markShortCircuitBindings(analysis.bindings || []);
  assignStableBindingTargets(analysis.bindings || []);

  const stateParameter = path.scope.generateUidIdentifier("farmState");
  const blockParameter = path.scope.generateUidIdentifier("farmBlocks");
  const definitionIdentifier = path.scope.generateUidIdentifier(`${name}Compiled`);
  const propsParameter = propsPlan.definitionParameter;
  const rootWithTargets = lowerStableBindingTargets(
    expandedReactiveRoot,
    analysis.bindings || [],
    blockParameter,
    blockAnalysis.ownedElements || new Set<t.JSXElement>(),
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
    reactiveByValue,
    statesBySetter,
  ) as t.JSXElement;
  const definition = t.callExpression(t.cloneNode(createComponentIdentifier), [
    t.objectExpression([
      t.objectProperty(t.identifier("displayName"), t.stringLiteral(name)),
      t.objectProperty(t.identifier("reactivity"), t.stringLiteral(reactivity)),
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
              t.stringLiteral(
                propBindings.length === 0
                  ? String(states.length)
                  : `${states.length}:${propBindings.map((binding) => binding.localName).join(",")}`,
              ),
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
      ...(propBindings.length > 0
        ? [
            t.objectProperty(
              t.identifier("readProps"),
              t.arrowFunctionExpression(
                [t.cloneNode(propsParameter)],
                t.arrayExpression(
                  propBindings.map((binding) =>
                    t.memberExpression(
                      t.cloneNode(propsParameter),
                      t.identifier(binding.localName),
                    ),
                  ),
                ),
              ),
            ),
          ]
        : []),
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
            bindingObject(binding, propsParameter, stateParameter, reactiveByValue, statesBySetter),
          ),
        ),
      ),
    ]),
    t.arrayExpression(
      runtimeFeatures.map((feature) => t.cloneNode(runtimeFeatureIdentifiers.get(feature)!)),
    ),
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
  for (const feature of runtimeFeatures) usedRuntimeFeatures.add(feature);
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
        const runtimeFeatureIdentifiers = new Map<CompilerRuntimeFeatureName, t.Identifier>(
          Object.entries(COMPILER_RUNTIME_FEATURE_EXPORTS).map(([feature, exportName]) => [
            feature as CompilerRuntimeFeatureName,
            programPath.scope.generateUidIdentifier(exportName),
          ]),
        );
        const usedRuntimeFeatures = new Set<CompilerRuntimeFeatureName>();
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
            runtimeFeatureIdentifiers,
            usedRuntimeFeatures,
            useStateNames,
            reactNames,
            listNames,
            id,
            options.reactivity,
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
                  t.identifier("createCompiledComponentWithFeatures"),
                ),
                ...[...usedRuntimeFeatures]
                  .sort()
                  .map((feature) =>
                    t.importSpecifier(
                      t.cloneNode(runtimeFeatureIdentifiers.get(feature)!),
                      t.identifier(COMPILER_RUNTIME_FEATURE_EXPORTS[feature]),
                    ),
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
