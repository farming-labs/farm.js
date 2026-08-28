import React from "react";
import { flushSync } from "react-dom";
import { materializeIterable } from "./iterable";

export type CompilerStateUpdater = unknown | ((previous: unknown) => unknown);
export type CompilerRuntimeReactivity = "static" | "hybrid";

interface CompilerKeyedMapUpdateHint {
  readonly sourceToken: object;
  readonly changedIndices: readonly number[];
  readonly previous?: CompilerKeyedMapUpdateHint;
}

const COMPILER_KEYED_COLLECTION_TOKENS = /* @__PURE__ */ new WeakMap<object, object>();
const COMPILER_KEYED_MAP_UPDATES = /* @__PURE__ */ new WeakMap<
  object,
  CompilerKeyedMapUpdateHint
>();
const COMPILER_KEYED_COMMITTED_COLLECTIONS = /* @__PURE__ */ new WeakSet<object>();

function compilerObject(value: unknown): object | undefined {
  return (typeof value === "object" && value !== null) || typeof value === "function"
    ? (value as object)
    : undefined;
}

function compilerKeyedCollectionToken(value: unknown): object | undefined {
  const target = compilerObject(value);
  if (!target) return undefined;
  let token = COMPILER_KEYED_COLLECTION_TOKENS.get(target);
  if (!token) {
    token = {};
    COMPILER_KEYED_COLLECTION_TOKENS.set(target, token);
  }
  return token;
}

function commitCompilerKeyedCollection(value: unknown): object | undefined {
  const target = compilerObject(value);
  if (!target) return undefined;
  COMPILER_KEYED_COMMITTED_COLLECTIONS.add(target);
  return compilerKeyedCollectionToken(target);
}

function compilerKeyedMapChangedIndices(
  value: unknown,
  sourceToken: object | undefined,
): readonly number[] | undefined {
  const target = compilerObject(value);
  if (!target || !sourceToken) return undefined;
  const update = COMPILER_KEYED_MAP_UPDATES.get(target);
  if (!update || update.sourceToken !== sourceToken) return undefined;
  const changedIndices: number[] = [];
  for (
    let current: CompilerKeyedMapUpdateHint | undefined = update;
    current;
    current = current.previous
  ) {
    changedIndices.push(...current.changedIndices);
  }
  return changedIndices;
}

/** @internal Records compiler-proven same-order Array.map metadata and returns the Array. */
export function createCompilerKeyedMapUpdate(
  previous: unknown,
  value: unknown,
  changedIndices: readonly number[],
): unknown {
  const previousTarget = compilerObject(previous);
  const valueTarget = compilerObject(value);
  const sourceToken = compilerKeyedCollectionToken(previousTarget);
  if (valueTarget && sourceToken) {
    const previousUpdate =
      previousTarget && !COMPILER_KEYED_COMMITTED_COLLECTIONS.has(previousTarget)
        ? COMPILER_KEYED_MAP_UPDATES.get(previousTarget)
        : undefined;
    COMPILER_KEYED_MAP_UPDATES.set(valueTarget, {
      sourceToken: previousUpdate?.sourceToken || sourceToken,
      changedIndices,
      ...(previousUpdate ? { previous: previousUpdate } : {}),
    });
  }
  return value;
}

export interface CompilerCell {
  get(): unknown;
  set(next: CompilerStateUpdater): void;
}

interface RuntimeCell extends CompilerCell {
  flush(): boolean;
  replace(next: unknown): void;
}

type PendingCellUpdate =
  | { kind: "state"; update: CompilerStateUpdater }
  | { kind: "value"; value: unknown };

type SelectableTextControl = HTMLInputElement | HTMLTextAreaElement;

interface InputSelectionSnapshot {
  element: SelectableTextControl;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

export interface CompilerTextBinding<Props> {
  kind: "text";
  /** Runtime tracking is useful only for compiler-proven short-circuiting readers. */
  tracking?: "dynamic";
  path: readonly number[];
  /** Stable ref target emitted by newer compiler versions. */
  target?: number;
  dependencies: readonly number[];
  read(props: Props, state: readonly CompilerCell[]): unknown;
}

export interface CompilerAttributeBinding<Props> {
  kind: "attribute";
  /** Runtime tracking is useful only for compiler-proven short-circuiting readers. */
  tracking?: "dynamic";
  path: readonly number[];
  /** Stable ref target emitted by newer compiler versions. */
  target?: number;
  dependencies: readonly number[];
  name: string;
  read(props: Props, state: readonly CompilerCell[]): unknown;
}

export interface CompilerStyleBinding<Props> {
  kind: "style";
  /** Runtime tracking is useful only for compiler-proven short-circuiting readers. */
  tracking?: "dynamic";
  path: readonly number[];
  /** Stable ref target emitted by newer compiler versions. */
  target?: number;
  dependencies: readonly number[];
  name: string;
  read(props: Props, state: readonly CompilerCell[]): unknown;
}

export interface CompilerConditionalBlockBinding {
  kind: "block";
  id: number;
  /** Nearest conditional boundary that owns this block, when nested. */
  parent?: number;
  dependencies: readonly number[];
}

export interface CompilerConditionalBlockProps {
  id: number;
  render(): React.ReactNode;
}

export interface CompilerKeyedListBlockProps {
  id: number;
  render(): React.ReactNode;
}

export interface CompilerHostElement {
  kind: "element";
  tag: string;
  attributes: readonly { name: string; value: unknown }[];
  styles: readonly { name: string; value: unknown }[];
  children: readonly (CompilerHostElement | unknown)[];
  /** Direct-child structure owned without creating another React fiber. */
  block?: CompilerHostBlock;
}

export type CompilerKeyedRowElement = CompilerHostElement;

export interface CompilerKeyedRowEvent {
  name: string;
  /** Host-element path relative to the keyed row root. */
  path?: readonly number[];
  invoke(item: unknown, index: number, event: React.SyntheticEvent): unknown;
}

export interface CompilerKeyedRowConditionalBranch {
  bindings: readonly CompilerKeyedRowBinding[];
}

export interface CompilerKeyedRowConditional {
  id: number;
  /** Host-container path relative to the keyed row root. */
  path: readonly number[];
  test(item: unknown, index: number): unknown;
  logical: boolean;
  truthy?: CompilerKeyedRowConditionalBranch;
  falsy?: CompilerKeyedRowConditionalBranch;
}

export interface CompilerHostConditionalBinding {
  kind: "text" | "attribute" | "style";
  path: readonly number[];
  name?: string;
  read(): unknown;
}

export interface CompilerStaticRangeBinding {
  kind: "text" | "attribute" | "style";
  /** Static segment before range N, or the trailing segment at ranges.length. */
  segment: number;
  /** Direct host sibling inside that static segment. */
  sibling: number;
  /** Host-element path relative to the selected static sibling. */
  path: readonly number[];
  name?: string;
  read(): unknown;
}

export interface CompilerHostConditionalBranch {
  create(): CompilerHostElement;
  bindings: readonly CompilerHostConditionalBinding[];
}

export interface CompilerHostConditionalRanges {
  kind: "conditional-ranges";
  id: number;
  ranges: readonly CompilerConditionalRange[];
  trailing: number;
  bindings?: readonly CompilerStaticRangeBinding[];
}

export interface CompilerHostKeyedRanges {
  kind: "keyed-ranges";
  id: number;
  ranges: readonly CompilerKeyedRange[];
  trailing: number;
  bindings?: readonly CompilerStaticRangeBinding[];
  /** Compiler output may store only static direct children and materialize rows from the ranges. */
  staticChildrenOnly?: boolean;
}

export interface CompilerHostMixedRanges {
  kind: "mixed-ranges";
  id: number;
  ranges: readonly CompilerMixedRange[];
  trailing: number;
  bindings?: readonly CompilerStaticRangeBinding[];
}

export type CompilerHostBlock =
  | CompilerHostConditionalRanges
  | CompilerHostKeyedRanges
  | CompilerHostMixedRanges;

export interface CompilerHostConditionalBlockProps {
  id: number;
  render(): React.ReactElement;
  test(): unknown;
  /** Logical && can produce a visible number instead of an empty branch. */
  logical?: boolean;
  truthy?: CompilerHostConditionalBranch;
  falsy?: CompilerHostConditionalBranch;
}

export interface CompilerConditionalRange {
  /** Number of static direct host siblings between this slot and the previous slot. */
  before: number;
  test(): unknown;
  /** Logical && can produce a visible number instead of an empty branch. */
  logical?: boolean;
  truthy?: CompilerHostConditionalBranch;
  falsy?: CompilerHostConditionalBranch;
}

export interface CompilerConditionalRangesBlockProps {
  id: number;
  render(): React.ReactElement;
  rootRef?: React.RefCallback<Element>;
  ranges: readonly CompilerConditionalRange[];
  /** Number of static direct host siblings after the final conditional slot. */
  trailing: number;
  bindings?: readonly CompilerStaticRangeBinding[];
}

export interface CompilerKeyedRowBinding {
  kind: "text" | "attribute" | "style";
  path: readonly number[];
  name?: string;
  /** Component state cells read by this binding, when emitted by the compiler. */
  dependencies?: readonly number[];
  /** A compiler-proven primitive value compared strictly with this row's key. */
  identityTarget?: {
    dependency: number;
    read(): unknown;
  };
  /** A compiler-proven native Set whose members are compared with this row's key. */
  membershipTarget?: {
    dependency: number;
    read(): unknown;
  };
  /** A compiler-proven native Map whose values are read with this row's key. */
  mapLookupTarget?: {
    dependency: number;
    read(): unknown;
  };
  read(item: unknown, index: number): unknown;
}

export interface CompilerKeyedRowsBlockProps {
  id: number;
  render(
    event: (
      item: unknown,
      index: number,
      eventId: number,
    ) => React.EventHandler<React.SyntheticEvent>,
    conditional: (
      item: unknown,
      index: number,
      conditionalId: number,
      render: (item: unknown, index: number) => React.ReactNode,
    ) => React.ReactNode,
  ): React.ReactElement;
  items(): Iterable<unknown> | null | undefined;
  /** Complete component-state dependencies used anywhere inside this boundary. */
  dependencies?: readonly number[];
  /** State cells that can change the row collection or its key projection. */
  structureDependencies?: readonly number[];
  /** Direct state cell supplying items, eligible for compiler-emitted update hints. */
  collectionDependency?: number;
  rowKey(item: unknown, index: number): React.Key;
  create(item: unknown, index: number): CompilerKeyedRowElement;
  bindings: readonly CompilerKeyedRowBinding[];
  events?: readonly CompilerKeyedRowEvent[];
  /** Route compiler-proven bubbling row events through the stable React container. */
  delegateEvents?: boolean;
  conditionals?: readonly CompilerKeyedRowConditional[];
  /** Row descriptors contain compiler-owned nested host scopes. */
  hostBlocks?: boolean;
}

export interface CompilerKeyedRange {
  /** Number of static direct host siblings between this range and the previous range. */
  before: number;
  items(): Iterable<unknown> | null | undefined;
  rowKey(item: unknown, index: number): React.Key;
  create(item: unknown, index: number): CompilerKeyedRowElement;
  bindings: readonly CompilerKeyedRowBinding[];
}

export type CompilerMixedRange =
  | ({ kind: "conditional" } & CompilerConditionalRange)
  | ({ kind: "keyed" } & CompilerKeyedRange);

export interface CompilerMixedRangesBlockProps {
  id: number;
  render(): React.ReactElement;
  create(): CompilerHostElement;
  rootRef?: React.RefCallback<Element>;
}

export interface CompilerKeyedRangesBlockProps {
  id: number;
  render(): React.ReactElement;
  rootRef?: React.RefCallback<Element>;
  ranges: readonly CompilerKeyedRange[];
  /** Number of static direct host siblings after the final keyed range. */
  trailing: number;
  bindings?: readonly CompilerStaticRangeBinding[];
}

export interface CompilerComponentBlockProps {
  id: number;
  render(): React.ReactNode;
}

export interface CompilerBlockRuntime {
  Conditional: React.ComponentType<CompilerConditionalBlockProps>;
  HostConditional: React.ComponentType<CompilerHostConditionalBlockProps>;
  ConditionalRanges: React.ComponentType<CompilerConditionalRangesBlockProps>;
  KeyedList: React.ComponentType<CompilerKeyedListBlockProps>;
  KeyedRows: React.ComponentType<CompilerKeyedRowsBlockProps>;
  KeyedRanges: React.ComponentType<CompilerKeyedRangesBlockProps>;
  MixedRanges: React.ComponentType<CompilerMixedRangesBlockProps>;
  Component: React.ComponentType<CompilerComponentBlockProps>;
  target(id: number): React.RefCallback<Element>;
}

export type CompilerBinding<Props> =
  | CompilerTextBinding<Props>
  | CompilerAttributeBinding<Props>
  | CompilerStyleBinding<Props>
  | CompilerConditionalBlockBinding;

export interface CompiledComponentDefinition<Props> {
  displayName: string;
  /** Scheduler selected by the compiler. Hand-authored definitions default to `static`. */
  reactivity?: CompilerRuntimeReactivity;
  /** Stable development-only identity used to preserve state across compatible refreshes. */
  hmrId?: string;
  /** Changes when the compiler-owned state layout is no longer refresh-compatible. */
  stateSignature?: string;
  initialize(props: Props): readonly unknown[];
  /**
   * Compiler-emitted flat prop reads. Primitive values can share the local
   * dependency graph; identity-bearing values retain normal React rendering.
   */
  readProps?(props: Props): readonly unknown[];
  render(
    props: Props,
    state: readonly CompilerCell[],
    blocks: CompilerBlockRuntime,
  ): React.ReactElement;
  bindings: readonly CompilerBinding<Props>[];
}

interface CompiledDefinitionReference<Props> {
  current: CompiledComponentDefinition<Props>;
}

interface CompilerHmrRegistryEntry {
  component: React.ComponentType<unknown>;
  definition: CompiledDefinitionReference<unknown>;
  refreshListeners: Set<() => void>;
  stateSignature: string;
  runtimeSignature: string;
}

type CompilerHmrRegistry = Map<string, CompilerHmrRegistryEntry>;

const COMPILER_HMR_REGISTRY = Symbol.for("@farm.js/react/compiler-hmr-registry");

function getCompilerHmrRegistry(): CompilerHmrRegistry {
  const globalTarget = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = globalTarget[COMPILER_HMR_REGISTRY];
  if (existing instanceof Map) return existing as CompilerHmrRegistry;
  const registry: CompilerHmrRegistry = new Map();
  globalTarget[COMPILER_HMR_REGISTRY] = registry;
  return registry;
}

function renderTextValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(renderTextValue).join("");
  if (value === null || value === undefined || typeof value === "boolean") return "";
  return String(value);
}

function isCompilerPrimitive(value: unknown): boolean {
  if (value === null) return true;
  const kind = typeof value;
  return (
    kind === "string" ||
    kind === "number" ||
    kind === "boolean" ||
    kind === "bigint" ||
    kind === "undefined"
  );
}

function findBindingTarget(
  root: Element,
  path: readonly number[],
  blockRoots: ReadonlySet<Element>,
): Element | null {
  let current: Element | null = root;
  for (const index of path) {
    if (!current) return null;
    current = [...current.children].filter((child) => !blockRoots.has(child))[index] || null;
  }
  return current;
}

const UNITLESS_STYLE_PROPERTIES = new Set([
  "animationIterationCount",
  "aspectRatio",
  "borderImageOutset",
  "borderImageSlice",
  "borderImageWidth",
  "boxFlex",
  "boxFlexGroup",
  "boxOrdinalGroup",
  "columnCount",
  "columns",
  "flex",
  "flexGrow",
  "flexNegative",
  "flexOrder",
  "flexPositive",
  "flexShrink",
  "fontWeight",
  "gridArea",
  "gridColumn",
  "gridColumnEnd",
  "gridColumnSpan",
  "gridColumnStart",
  "gridRow",
  "gridRowEnd",
  "gridRowSpan",
  "gridRowStart",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "scale",
  "tabSize",
  "widows",
  "zIndex",
  "zoom",
  "fillOpacity",
  "floodOpacity",
  "stopOpacity",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeMiterlimit",
  "strokeOpacity",
  "strokeWidth",
]);

function unprefixedStyleName(name: string): string {
  const unprefixed = name.replace(/^(?:Webkit|Moz|ms|O)(?=[A-Z])/, "");
  return unprefixed ? unprefixed[0].toLowerCase() + unprefixed.slice(1) : name;
}

function isHtmlOrSvgElement(element: Element): element is HTMLElement | SVGElement {
  const view = element.ownerDocument.defaultView;
  return Boolean(
    view && (element instanceof view.HTMLElement || element instanceof view.SVGElement),
  );
}

function isInputElement(element: Element): element is HTMLInputElement {
  const view = element.ownerDocument.defaultView;
  return Boolean(view && element instanceof view.HTMLInputElement);
}

function isTextAreaElement(element: Element): element is HTMLTextAreaElement {
  const view = element.ownerDocument.defaultView;
  return Boolean(view && element instanceof view.HTMLTextAreaElement);
}

function isSelectElement(element: Element): element is HTMLSelectElement {
  const view = element.ownerDocument.defaultView;
  return Boolean(view && element instanceof view.HTMLSelectElement);
}

function isOptionElement(element: Element): element is HTMLOptionElement {
  const view = element.ownerDocument.defaultView;
  return Boolean(view && element instanceof view.HTMLOptionElement);
}

function isSelectableTextControl(
  element: Element | null | undefined,
): element is SelectableTextControl {
  return Boolean(element && (isInputElement(element) || isTextAreaElement(element)));
}

function updateStyle(element: Element, name: string, value: unknown): void {
  if (!isHtmlOrSvgElement(element)) return;
  const customProperty = name.startsWith("--");
  let nextValue = "";
  if (value !== null && value !== undefined && typeof value !== "boolean" && value !== "") {
    nextValue =
      typeof value === "number" &&
      value !== 0 &&
      !customProperty &&
      !UNITLESS_STYLE_PROPERTIES.has(unprefixedStyleName(name))
        ? `${value}px`
        : String(value).trim();
  }

  if (customProperty || name.includes("-")) {
    element.style.setProperty(name, nextValue);
  } else {
    (element.style as unknown as Record<string, string>)[name] = nextValue;
  }
}

function updateSelectValue(element: HTMLSelectElement, value: unknown): void {
  const options = [...element.options];
  if (element.multiple) {
    const selected = new Set(
      (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]).map(
        String,
      ),
    );
    for (const option of options) option.selected = selected.has(option.value);
    return;
  }

  const selectedValue = value === null || value === undefined ? "" : String(value);
  let fallback: HTMLOptionElement | undefined;
  for (const option of options) {
    if (!option.disabled && !fallback) fallback = option;
    if (option.value === selectedValue) {
      option.selected = true;
      return;
    }
  }
  if (fallback) fallback.selected = true;
}

function updateAttribute(element: Element, name: string, value: unknown): void {
  const attributeName = name === "className" ? "class" : name === "htmlFor" ? "for" : name;
  const stringifiesBoolean = attributeName.startsWith("data-") || attributeName.startsWith("aria-");

  if (name === "value" && (isInputElement(element) || isTextAreaElement(element))) {
    const nextValue = value === null || value === undefined ? "" : String(value);
    if (element.value !== nextValue) element.value = nextValue;
    return;
  }

  if (name === "value" && isSelectElement(element)) {
    updateSelectValue(element, value);
    return;
  }

  if (name === "checked" && isInputElement(element)) {
    element.checked = Boolean(value);
    return;
  }

  if (name === "selected" && isOptionElement(element)) {
    element.selected = Boolean(value);
    return;
  }

  if (name === "disabled" && "disabled" in element) {
    (element as HTMLButtonElement).disabled = Boolean(value);
    return;
  }

  if (value === null || value === undefined || (value === false && !stringifiesBoolean)) {
    element.removeAttribute(attributeName);
  } else if (value === true && !stringifiesBoolean) {
    element.setAttribute(attributeName, "");
  } else {
    element.setAttribute(attributeName, String(value));
  }
}

type CompilerBlockRefresh = (afterCommit?: () => void, dirtyState?: ReadonlySet<number>) => void;

export interface CompilerRuntimeFeatureOwner {
  setRoot(id: number, root: Element | null): void;
  subscribe(id: number, refresh: CompilerBlockRefresh): () => void;
}

export interface CompilerRuntimeFeature {
  /** Stable identity used by Fast Refresh compatibility checks. */
  name: string;
  create(owner: CompilerRuntimeFeatureOwner): Partial<CompilerBlockRuntime>;
}

interface ConditionalBlockOwner {
  setRoot(id: number, root: Element | null): void;
  subscribe(id: number, refresh: CompilerBlockRefresh): () => void;
}

function createConditionalBlockComponent(
  owner: ConditionalBlockOwner,
): React.ComponentType<CompilerConditionalBlockProps> {
  class FarmConditionalBlock extends React.Component<CompilerConditionalBlockProps> {
    static displayName = "FarmCompiledConditionalBlock";

    private unsubscribe: (() => void) | undefined;

    private captureRoot = (root: Element | null) => {
      owner.setRoot(this.props.id, root);
    };

    private refresh = (afterCommit?: () => void) => {
      this.forceUpdate(afterCommit);
    };

    private subscribe(): void {
      this.unsubscribe = owner.subscribe(this.props.id, this.refresh);
    }

    componentDidMount(): void {
      this.subscribe();
    }

    componentDidUpdate(previous: CompilerConditionalBlockProps): void {
      if (previous.id === this.props.id) return;
      this.unsubscribe?.();
      owner.setRoot(previous.id, null);
      this.subscribe();
    }

    componentWillUnmount(): void {
      this.unsubscribe?.();
      owner.setRoot(this.props.id, null);
    }

    render(): React.ReactNode {
      const node = this.props.render();
      if (!React.isValidElement(node)) {
        if (
          node === null ||
          node === undefined ||
          typeof node === "boolean" ||
          typeof node === "string" ||
          typeof node === "number" ||
          typeof node === "bigint"
        ) {
          return node;
        }
        throw new TypeError(
          `Compiled conditional block ${this.props.id} must return one host element or an empty value.`,
        );
      }
      if (typeof node.type !== "string") {
        throw new TypeError(
          `Compiled conditional block ${this.props.id} must return one host element.`,
        );
      }
      return React.cloneElement(node, {
        ref: this.captureRoot,
      } as React.Attributes);
    }
  }

  return FarmConditionalBlock;
}

function createKeyedListBlockComponent(
  owner: Pick<ConditionalBlockOwner, "subscribe">,
): React.ComponentType<CompilerKeyedListBlockProps> {
  class FarmKeyedListBlock extends React.Component<CompilerKeyedListBlockProps> {
    static displayName = "FarmCompiledKeyedListBlock";

    private unsubscribe: (() => void) | undefined;

    private refresh = (afterCommit?: () => void) => {
      this.forceUpdate(afterCommit);
    };

    private subscribe(): void {
      this.unsubscribe = owner.subscribe(this.props.id, this.refresh);
    }

    componentDidMount(): void {
      this.subscribe();
    }

    componentDidUpdate(previous: CompilerKeyedListBlockProps): void {
      if (previous.id === this.props.id) return;
      this.unsubscribe?.();
      this.subscribe();
    }

    componentWillUnmount(): void {
      this.unsubscribe?.();
    }

    render(): React.ReactNode {
      return this.props.render();
    }
  }

  return FarmKeyedListBlock;
}

interface CompilerHostInstance {
  element: Element;
  values: unknown[];
  scope?: CompilerHostTreeScope;
}

function isCompilerHostElement(value: unknown): value is CompilerHostElement {
  return (
    typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "element"
  );
}

function createCompilerHostElement(document: Document, descriptor: CompilerHostElement): Element {
  const element = document.createElement(descriptor.tag);
  for (const attribute of descriptor.attributes) {
    updateAttribute(element, attribute.name, attribute.value);
  }
  for (const style of descriptor.styles) updateStyle(element, style.name, style.value);
  const appendChild = (child: unknown): void => {
    if (Array.isArray(child)) {
      for (const nested of child) appendChild(nested);
      return;
    }
    if (isCompilerHostElement(child)) {
      element.append(createCompilerHostElement(document, child));
      return;
    }
    const text = renderTextValue(child);
    if (text) element.append(document.createTextNode(text));
  };
  for (const child of materializeCompilerHostChildren(descriptor)) appendChild(child);
  // Select options and textarea text must exist before their controlled value
  // is finalized. Reapplying is harmless for other attributes and avoids a
  // transient/default selection becoming the compiled branch's final state.
  for (const attribute of descriptor.attributes) {
    if (attribute.name === "value" && (isSelectElement(element) || isTextAreaElement(element))) {
      updateAttribute(element, attribute.name, attribute.value);
    }
  }
  return element;
}

function matchesCompilerHostElement(
  element: Element,
  descriptor: CompilerHostElement,
  opaquePaths: ReadonlySet<string> = new Set(),
  path: readonly number[] = [],
): boolean {
  if (element.tagName.toLowerCase() !== descriptor.tag.toLowerCase()) return false;
  if (opaquePaths.has(path.join(".")) || descriptor.block) return true;
  const expectedChildren = flattenCompilerHostElements(descriptor.children);
  if (element.children.length !== expectedChildren.length) return false;
  return expectedChildren.every((child, index) =>
    matchesCompilerHostElement(element.children[index], child, opaquePaths, [...path, index]),
  );
}

function flattenCompilerHostElements(children: readonly unknown[]): CompilerHostElement[] {
  const elements: CompilerHostElement[] = [];
  const visit = (child: unknown): void => {
    if (Array.isArray(child)) {
      for (const nested of child) visit(nested);
    } else if (isCompilerHostElement(child)) {
      elements.push(child);
    }
  };
  for (const child of children) visit(child);
  return elements;
}

function materializeCompilerHostChildren(descriptor: CompilerHostElement): readonly unknown[] {
  const block = descriptor.block;
  if (block?.kind !== "keyed-ranges" || !block.staticChildrenOnly) {
    return descriptor.children;
  }
  const staticChildren = flattenCompilerHostElements(descriptor.children);
  const children: CompilerHostElement[] = [];
  let cursor = 0;
  for (const range of block.ranges) {
    children.push(...staticChildren.slice(cursor, cursor + range.before));
    cursor += range.before;
    const items = materializeIterable(range.items());
    children.push(...items.map((item, index) => range.create(item, index)));
  }
  children.push(...staticChildren.slice(cursor, cursor + block.trailing));
  return children;
}

function collectCompilerHostBlockIds(descriptor: CompilerHostElement, ids: Set<number>): void {
  for (const child of flattenCompilerHostElements(descriptor.children)) {
    collectCompilerHostBlockIds(child, ids);
  }
  const block = descriptor.block;
  if (!block || ids.has(block.id)) return;
  ids.add(block.id);
  if (block.kind === "conditional-ranges") {
    for (const range of block.ranges) {
      if (range.truthy) collectCompilerHostBlockIds(range.truthy.create(), ids);
      if (range.falsy) collectCompilerHostBlockIds(range.falsy.create(), ids);
    }
  } else if (block.kind === "keyed-ranges") {
    for (const range of block.ranges) {
      const first = materializeIterable(range.items())[0];
      if (first !== undefined) collectCompilerHostBlockIds(range.create(first, 0), ids);
    }
  } else {
    for (const range of block.ranges) {
      if (range.kind === "conditional") {
        if (range.truthy) collectCompilerHostBlockIds(range.truthy.create(), ids);
        if (range.falsy) collectCompilerHostBlockIds(range.falsy.create(), ids);
      } else {
        const first = materializeIterable(range.items())[0];
        if (first !== undefined) collectCompilerHostBlockIds(range.create(first, 0), ids);
      }
    }
  }
}

function findCompilerHostTarget(root: Element, path: readonly number[]): Element | null {
  let current: Element | null = root;
  for (const index of path) current = current?.children[index] || null;
  return current;
}

const UNSET_STATIC_RANGE_BINDING = Symbol("unset static range binding");

function normalizedStaticRangeBindingValue(
  binding: CompilerStaticRangeBinding,
  value: unknown,
): unknown {
  return binding.kind === "text" ? renderTextValue(value) : value;
}

function applyStaticRangeBindings(
  bindings: readonly CompilerStaticRangeBinding[] | undefined,
  segments: readonly (readonly Element[])[],
  values: unknown[],
): boolean {
  const activeBindings = bindings || [];
  if (values.length === 0 && activeBindings.length > 0) {
    values.push(...activeBindings.map(() => UNSET_STATIC_RANGE_BINDING));
  }
  if (values.length !== activeBindings.length) return false;

  for (let index = 0; index < activeBindings.length; index += 1) {
    const binding = activeBindings[index];
    if (
      !Number.isSafeInteger(binding.segment) ||
      binding.segment < 0 ||
      !Number.isSafeInteger(binding.sibling) ||
      binding.sibling < 0
    ) {
      return false;
    }
    const sibling = segments[binding.segment]?.[binding.sibling];
    const target = sibling && findCompilerHostTarget(sibling, binding.path);
    if (!target) return false;
    const rawValue = binding.read();
    const value = normalizedStaticRangeBindingValue(binding, rawValue);
    if (Object.is(values[index], value)) continue;
    values[index] = value;
    if (binding.kind === "text") {
      target.textContent = value as string;
    } else if (binding.kind === "style" && binding.name) {
      updateStyle(target, binding.name, rawValue);
    } else if (binding.kind === "attribute" && binding.name) {
      updateAttribute(target, binding.name, rawValue);
    } else {
      return false;
    }
  }
  return true;
}

interface CompilerKeyedRowInstance extends CompilerHostInstance {
  key: string;
  item: unknown;
  index: number;
  conditionalValues: ReadonlyMap<number, readonly unknown[]>;
}

interface CompilerKeyedIdentityTargetSnapshot {
  eligible: boolean;
  key?: string;
}

interface CompilerKeyedMembershipTargetSnapshot {
  eligible: boolean;
  values?: ReadonlySet<unknown>;
}

interface CompilerKeyedMapLookupTargetSnapshot {
  eligible: boolean;
  values?: ReadonlyMap<unknown, unknown>;
}

const UNSET_KEYED_ROW_BINDING = Symbol("unset interactive keyed-row binding");

function keyedRowIdentity(key: React.Key): string {
  return String(key);
}

function keyedIdentityTargetSnapshot(value: unknown): CompilerKeyedIdentityTargetSnapshot {
  const kind = typeof value;
  return value === null ||
    value === undefined ||
    kind === "string" ||
    kind === "number" ||
    kind === "bigint"
    ? { eligible: true, key: String(value) }
    : { eligible: false };
}

const NATIVE_SET_PROTOTYPE = Set.prototype;
const NATIVE_SET_ADD = Set.prototype.add;
const NATIVE_SET_HAS = Set.prototype.has;
const NATIVE_SET_VALUES = Set.prototype.values;

function keyedMembershipTargetSnapshot(value: unknown): CompilerKeyedMembershipTargetSnapshot {
  if (typeof value !== "object" || value === null) return { eligible: false };
  let iterator: SetIterator<unknown>;
  try {
    iterator = NATIVE_SET_VALUES.call(value as Set<unknown>);
  } catch {
    return { eligible: false };
  }
  if (
    Object.getPrototypeOf(value) !== NATIVE_SET_PROTOTYPE ||
    Object.prototype.hasOwnProperty.call(value, "has") ||
    (value as Set<unknown>).has !== NATIVE_SET_HAS
  ) {
    return { eligible: false };
  }
  const values = new Set<unknown>();
  try {
    for (const entry of iterator) {
      if (!keyedIdentityTargetSnapshot(entry).eligible) return { eligible: false };
      NATIVE_SET_ADD.call(values, entry);
    }
  } catch {
    return { eligible: false };
  }
  return { eligible: true, values };
}

function keyedMembershipChangedKeys(
  previous: ReadonlySet<unknown>,
  next: ReadonlySet<unknown>,
): Set<string> {
  const keys = new Set<string>();
  for (const value of previous) {
    if (!NATIVE_SET_HAS.call(next, value)) NATIVE_SET_ADD.call(keys, String(value));
  }
  for (const value of next) {
    if (!NATIVE_SET_HAS.call(previous, value)) NATIVE_SET_ADD.call(keys, String(value));
  }
  return keys;
}

const NATIVE_MAP_PROTOTYPE = Map.prototype;
const NATIVE_MAP_GET = Map.prototype.get;
const NATIVE_MAP_SET = Map.prototype.set;
const NATIVE_MAP_ENTRIES = Map.prototype.entries;

function isSafeKeyedMapLookupValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  );
}

function keyedMapLookupTargetSnapshot(value: unknown): CompilerKeyedMapLookupTargetSnapshot {
  if (typeof value !== "object" || value === null) return { eligible: false };
  let iterator: MapIterator<[unknown, unknown]>;
  try {
    iterator = NATIVE_MAP_ENTRIES.call(value as Map<unknown, unknown>);
  } catch {
    return { eligible: false };
  }
  if (
    Object.getPrototypeOf(value) !== NATIVE_MAP_PROTOTYPE ||
    Object.prototype.hasOwnProperty.call(value, "get") ||
    (value as Map<unknown, unknown>).get !== NATIVE_MAP_GET
  ) {
    return { eligible: false };
  }
  const values = new Map<unknown, unknown>();
  try {
    for (const [key, entry] of iterator) {
      if (!keyedIdentityTargetSnapshot(key).eligible || !isSafeKeyedMapLookupValue(entry)) {
        return { eligible: false };
      }
      NATIVE_MAP_SET.call(values, key, entry);
    }
  } catch {
    return { eligible: false };
  }
  return { eligible: true, values };
}

function keyedMapLookupChangedKeys(
  previous: ReadonlyMap<unknown, unknown>,
  next: ReadonlyMap<unknown, unknown>,
): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of previous) {
    if (!Object.is(value, NATIVE_MAP_GET.call(next, key))) {
      NATIVE_SET_ADD.call(keys, String(key));
    }
  }
  for (const [key, value] of next) {
    if (!Object.is(value, NATIVE_MAP_GET.call(previous, key))) {
      NATIVE_SET_ADD.call(keys, String(key));
    }
  }
  return keys;
}

function normalizedKeyedRowBindingValue(binding: CompilerKeyedRowBinding, value: unknown): unknown {
  return binding.kind === "text" ? renderTextValue(value) : value;
}

type CompilerKeyedRowBindingSource = Pick<CompilerKeyedRowsBlockProps, "bindings">;

function readKeyedRowBindingValues(
  props: CompilerKeyedRowBindingSource,
  item: unknown,
  index: number,
): unknown[] {
  return props.bindings.map((binding) =>
    normalizedKeyedRowBindingValue(binding, binding.read(item, index)),
  );
}

function applyKeyedRowBindings(
  props: CompilerKeyedRowBindingSource,
  instance: CompilerKeyedRowInstance,
  item: unknown,
  index: number,
): void {
  for (let bindingIndex = 0; bindingIndex < props.bindings.length; bindingIndex += 1) {
    applyKeyedRowBinding(props, instance, item, index, bindingIndex);
  }
}

function applyKeyedRowBinding(
  props: CompilerKeyedRowBindingSource,
  instance: CompilerKeyedRowInstance,
  item: unknown,
  index: number,
  bindingIndex: number,
): void {
  const binding = props.bindings[bindingIndex];
  const rawValue = binding.read(item, index);
  const value = normalizedKeyedRowBindingValue(binding, rawValue);
  if (Object.is(instance.values[bindingIndex], value)) return;
  instance.values[bindingIndex] = value;
  const target = findCompilerHostTarget(instance.element, binding.path);
  if (!target) return;
  if (binding.kind === "text") {
    target.textContent = value as string;
  } else if (binding.kind === "style" && binding.name) {
    updateStyle(target, binding.name, rawValue);
  } else if (binding.kind === "attribute" && binding.name) {
    updateAttribute(target, binding.name, rawValue);
  }
}

function keyedRowConditionalSnapshot(
  conditional: CompilerKeyedRowConditional,
  item: unknown,
  index: number,
): readonly unknown[] {
  const test = conditional.test(item, index);
  if (conditional.logical && !test) {
    return typeof test === "number" || typeof test === "bigint" ? ["primitive", test] : ["empty"];
  }
  const key = test ? "truthy" : "falsy";
  const branch = key === "truthy" ? conditional.truthy : conditional.falsy;
  if (!branch) return ["empty"];
  return [
    key,
    ...branch.bindings.map((binding) =>
      normalizedKeyedRowBindingValue(binding, binding.read(item, index)),
    ),
  ];
}

function readKeyedRowConditionalValues(
  props: CompilerKeyedRowsBlockProps,
  item: unknown,
  index: number,
): ReadonlyMap<number, readonly unknown[]> {
  if (!props.conditionals?.length) return EMPTY_KEYED_ROW_CONDITIONAL_VALUES;
  return new Map(
    props.conditionals.map((conditional) => [
      conditional.id,
      keyedRowConditionalSnapshot(conditional, item, index),
    ]),
  );
}

const EMPTY_KEYED_ROW_CONDITIONAL_VALUES: ReadonlyMap<number, readonly unknown[]> = new Map();

function keyedRowConditionalChanged(
  previous: readonly unknown[] | undefined,
  next: readonly unknown[],
): boolean {
  return (
    !previous ||
    previous.length !== next.length ||
    next.some((value, index) => !Object.is(value, previous[index]))
  );
}

type CompilerHostConditionalSelection =
  | { kind: "branch"; key: "truthy" | "falsy"; branch: CompilerHostConditionalBranch }
  | { kind: "empty" }
  | { kind: "fallback" };
type CompilerHostConditionalPreparedSelection = Exclude<
  CompilerHostConditionalSelection,
  { kind: "fallback" }
>;

function hostConditionalSelection(
  props: Pick<CompilerHostConditionalBlockProps, "test" | "logical" | "truthy" | "falsy">,
): CompilerHostConditionalSelection {
  const test = props.test();
  if (props.logical && !test) {
    // React renders 0, NaN, and (where supported) 0n from `value && <Element />`.
    // The host-only fast path cannot represent that primitive branch, so retain
    // React's exact behavior rather than coercing it to an empty branch.
    if (typeof test === "number" || typeof test === "bigint") return { kind: "fallback" };
    return { kind: "empty" };
  }
  const key = test ? "truthy" : "falsy";
  const branch = key === "truthy" ? props.truthy : props.falsy;
  return branch ? { kind: "branch", key, branch } : { kind: "empty" };
}

function normalizedHostConditionalBindingValue(
  binding: CompilerHostConditionalBinding,
  value: unknown,
): unknown {
  return binding.kind === "text" ? renderTextValue(value) : value;
}

function applyHostConditionalBindings(
  branch: CompilerHostConditionalBranch,
  instance: CompilerHostInstance,
): void {
  for (let bindingIndex = 0; bindingIndex < branch.bindings.length; bindingIndex += 1) {
    const binding = branch.bindings[bindingIndex];
    const rawValue = binding.read();
    const value = normalizedHostConditionalBindingValue(binding, rawValue);
    if (Object.is(instance.values[bindingIndex], value)) continue;
    instance.values[bindingIndex] = value;
    const target = findCompilerHostTarget(instance.element, binding.path);
    if (!target) continue;
    if (binding.kind === "text") {
      target.textContent = value as string;
    } else if (binding.kind === "style" && binding.name) {
      updateStyle(target, binding.name, rawValue);
    } else if (binding.kind === "attribute" && binding.name) {
      updateAttribute(target, binding.name, rawValue);
    }
  }
}

interface CompilerHostTreeScope {
  cleanup(): void;
  update(descriptor: CompilerHostElement): boolean;
}

const UNSET_HOST_CONDITIONAL_BINDING = Symbol("unset host conditional binding");

function mountCompilerHostTree(
  owner: Pick<ConditionalBlockOwner, "subscribe">,
  element: Element,
  descriptor: CompilerHostElement,
  onFallback: () => void,
): CompilerHostTreeScope | null {
  if (!matchesCompilerHostElement(element, descriptor)) return null;
  if (descriptor.block?.kind === "conditional-ranges") {
    const controller = new CompilerNestedConditionalRanges(
      owner,
      element,
      descriptor,
      descriptor.block,
      onFallback,
    );
    try {
      if (controller.adopt()) return controller;
      controller.cleanup();
      return null;
    } catch (error) {
      controller.cleanup();
      throw error;
    }
  }
  if (descriptor.block?.kind === "keyed-ranges") {
    const controller = new CompilerNestedKeyedRanges(
      owner,
      element,
      descriptor,
      descriptor.block,
      onFallback,
    );
    try {
      if (controller.adopt()) return controller;
      controller.cleanup();
      return null;
    } catch (error) {
      controller.cleanup();
      throw error;
    }
  }
  if (descriptor.block?.kind === "mixed-ranges") {
    const controller = new CompilerNestedMixedRanges(
      owner,
      element,
      descriptor,
      descriptor.block,
      onFallback,
    );
    try {
      if (controller.adopt()) return controller;
      controller.cleanup();
      return null;
    } catch (error) {
      controller.cleanup();
      throw error;
    }
  }

  const descriptors = flattenCompilerHostElements(descriptor.children);
  if (descriptors.length !== element.children.length) return null;
  const scopes: CompilerHostTreeScope[] = [];
  for (let index = 0; index < descriptors.length; index += 1) {
    const scope = mountCompilerHostTree(
      owner,
      element.children[index],
      descriptors[index],
      onFallback,
    );
    if (!scope) {
      for (const mounted of scopes) mounted.cleanup();
      return null;
    }
    scopes.push(scope);
  }
  let active = true;
  return {
    update(nextDescriptor) {
      if (!active || nextDescriptor.block || !matchesCompilerHostElement(element, nextDescriptor)) {
        return false;
      }
      const nextChildren = flattenCompilerHostElements(nextDescriptor.children);
      if (nextChildren.length !== scopes.length) return false;
      return scopes.every((scope, index) => scope.update(nextChildren[index]));
    },
    cleanup() {
      if (!active) return;
      active = false;
      for (const scope of scopes) scope.cleanup();
    },
  };
}

function mountCompilerHostInstance(
  owner: Pick<ConditionalBlockOwner, "subscribe">,
  element: Element,
  descriptor: CompilerHostElement,
  branch: Pick<CompilerHostConditionalBranch, "bindings">,
  onFallback: () => void,
): CompilerHostInstance | null {
  const scope = mountCompilerHostTree(owner, element, descriptor, onFallback);
  if (!scope) return null;
  const instance: CompilerHostInstance = {
    element,
    scope,
    values: branch.bindings.map(() => UNSET_HOST_CONDITIONAL_BINDING),
  };
  try {
    applyHostConditionalBindings(branch as CompilerHostConditionalBranch, instance);
  } catch (error) {
    scope.cleanup();
    throw error;
  }
  return instance;
}

interface NestedConditionalRangeInstance {
  key: "truthy" | "falsy";
  host: CompilerHostInstance;
}

class CompilerNestedConditionalRanges implements CompilerHostTreeScope {
  private readonly instances: Array<NestedConditionalRangeInstance | null> = [];
  private readonly staticSegments: Element[][] = [];
  private readonly staticScopes: CompilerHostTreeScope[] = [];
  private readonly staticValues: unknown[] = [];
  private unsubscribe: (() => void) | undefined;
  private active = true;

  constructor(
    private readonly owner: Pick<ConditionalBlockOwner, "subscribe">,
    private readonly root: Element,
    private host: CompilerHostElement,
    private block: CompilerHostConditionalRanges,
    private readonly onFallback: () => void,
  ) {}

  private readSelections(): CompilerHostConditionalPreparedSelection[] | null {
    const selections: CompilerHostConditionalPreparedSelection[] = [];
    for (const range of this.block.ranges) {
      const selection = hostConditionalSelection(range);
      if (selection.kind === "fallback") return null;
      selections.push(selection);
    }
    return selections;
  }

  private mountStatic(
    elements: readonly Element[],
    descriptors: readonly CompilerHostElement[],
  ): boolean {
    if (elements.length !== descriptors.length) return false;
    for (let index = 0; index < elements.length; index += 1) {
      const scope = mountCompilerHostTree(
        this.owner,
        elements[index],
        descriptors[index],
        this.onFallback,
      );
      if (!scope) return false;
      this.staticScopes.push(scope);
    }
    return true;
  }

  adopt(): boolean {
    if (!Number.isSafeInteger(this.block.trailing) || this.block.trailing < 0) return false;
    const selections = this.readSelections();
    if (!selections) return false;
    const elements = [...this.root.children];
    const descriptors = flattenCompilerHostElements(this.host.children);
    if (elements.length !== descriptors.length) return false;
    let cursor = 0;

    for (let index = 0; index < this.block.ranges.length; index += 1) {
      const range = this.block.ranges[index];
      if (!Number.isSafeInteger(range.before) || range.before < 0) {
        this.cleanup();
        return false;
      }
      const staticEnd = cursor + range.before;
      if (
        staticEnd > elements.length ||
        !this.mountStatic(elements.slice(cursor, staticEnd), descriptors.slice(cursor, staticEnd))
      ) {
        this.cleanup();
        return false;
      }
      this.staticSegments.push(elements.slice(cursor, staticEnd));
      cursor = staticEnd;

      const selection = selections[index];
      if (selection.kind === "empty") {
        this.instances.push(null);
        continue;
      }
      const element = elements[cursor];
      if (!element) {
        this.cleanup();
        return false;
      }
      const descriptor = selection.branch.create();
      const host = mountCompilerHostInstance(
        this.owner,
        element,
        descriptor,
        selection.branch,
        this.onFallback,
      );
      if (!host) {
        this.cleanup();
        return false;
      }
      this.instances.push({ key: selection.key, host });
      cursor += 1;
    }

    const trailingEnd = cursor + this.block.trailing;
    if (
      trailingEnd !== elements.length ||
      !this.mountStatic(elements.slice(cursor), descriptors.slice(cursor))
    ) {
      this.cleanup();
      return false;
    }
    this.staticSegments.push(elements.slice(cursor));
    if (!applyStaticRangeBindings(this.block.bindings, this.staticSegments, this.staticValues)) {
      this.cleanup();
      return false;
    }
    this.unsubscribe = this.owner.subscribe(this.block.id, this.refresh);
    return true;
  }

  private anchorAfter(rangeIndex: number): ChildNode | null {
    for (let next = rangeIndex + 1; next < this.instances.length; next += 1) {
      const staticAnchor = this.staticSegments[next]?.[0];
      if (staticAnchor) return staticAnchor;
      const rangeAnchor = this.instances[next]?.host.element;
      if (rangeAnchor) return rangeAnchor;
    }
    return this.staticSegments[this.instances.length]?.[0] || null;
  }

  private reconcileRange(
    rangeIndex: number,
    selection: CompilerHostConditionalPreparedSelection,
  ): boolean {
    const previous = this.instances[rangeIndex];
    if (selection.kind === "empty") {
      previous?.host.scope?.cleanup();
      previous?.host.element.remove();
      this.instances[rangeIndex] = null;
      return true;
    }
    if (previous?.key === selection.key) {
      const descriptor = selection.branch.create();
      if (!previous.host.scope?.update(descriptor)) return false;
      applyHostConditionalBindings(selection.branch, previous.host);
      return true;
    }

    const descriptor = selection.branch.create();
    const element = createCompilerHostElement(this.root.ownerDocument, descriptor);
    const host = mountCompilerHostInstance(
      this.owner,
      element,
      descriptor,
      selection.branch,
      this.onFallback,
    );
    if (!host) return false;
    previous?.host.scope?.cleanup();
    if (previous) previous.host.element.replaceWith(element);
    else this.root.insertBefore(element, this.anchorAfter(rangeIndex));
    this.instances[rangeIndex] = { key: selection.key, host };
    return true;
  }

  private refresh = (afterCommit?: () => void) => {
    if (!this.active) {
      afterCommit?.();
      return;
    }
    const selections = this.readSelections();
    if (!selections || selections.length !== this.instances.length) {
      this.onFallback();
      afterCommit?.();
      return;
    }
    if (!applyStaticRangeBindings(this.block.bindings, this.staticSegments, this.staticValues)) {
      this.onFallback();
      afterCommit?.();
      return;
    }
    for (let index = this.instances.length - 1; index >= 0; index -= 1) {
      if (!this.reconcileRange(index, selections[index])) {
        this.onFallback();
        afterCommit?.();
        return;
      }
    }
    afterCommit?.();
  };

  private updateStaticScopes(
    descriptor: CompilerHostElement,
    selections: readonly CompilerHostConditionalPreparedSelection[],
  ): boolean {
    const descriptors = flattenCompilerHostElements(descriptor.children);
    let descriptorIndex = 0;
    let scopeIndex = 0;
    for (let rangeIndex = 0; rangeIndex < this.block.ranges.length; rangeIndex += 1) {
      const range = this.block.ranges[rangeIndex];
      for (let index = 0; index < range.before; index += 1) {
        const scope = this.staticScopes[scopeIndex++];
        const child = descriptors[descriptorIndex++];
        if (!scope || !child || !scope.update(child)) return false;
      }
      if (selections[rangeIndex].kind === "branch") descriptorIndex += 1;
    }
    for (let index = 0; index < this.block.trailing; index += 1) {
      const scope = this.staticScopes[scopeIndex++];
      const child = descriptors[descriptorIndex++];
      if (!scope || !child || !scope.update(child)) return false;
    }
    return scopeIndex === this.staticScopes.length && descriptorIndex === descriptors.length;
  }

  update(descriptor: CompilerHostElement): boolean {
    const block = descriptor.block;
    if (
      !this.active ||
      block?.kind !== "conditional-ranges" ||
      block.id !== this.block.id ||
      block.ranges.length !== this.block.ranges.length ||
      block.trailing !== this.block.trailing ||
      block.ranges.some((range, index) => range.before !== this.block.ranges[index].before)
    ) {
      return false;
    }
    this.host = descriptor;
    this.block = block;
    const selections = this.readSelections();
    if (
      !selections ||
      !this.updateStaticScopes(descriptor, selections) ||
      !applyStaticRangeBindings(this.block.bindings, this.staticSegments, this.staticValues)
    ) {
      return false;
    }
    for (let index = this.instances.length - 1; index >= 0; index -= 1) {
      if (!this.reconcileRange(index, selections[index])) return false;
    }
    return true;
  }

  cleanup(): void {
    if (!this.active) return;
    this.active = false;
    this.unsubscribe?.();
    for (const instance of this.instances) instance?.host.scope?.cleanup();
    for (const scope of this.staticScopes) scope.cleanup();
    this.instances.length = 0;
    this.staticSegments.length = 0;
    this.staticScopes.length = 0;
    this.staticValues.length = 0;
  }
}

interface NestedReadKeyedRange {
  items: unknown[];
  keys: string[];
}

class CompilerNestedKeyedRanges implements CompilerHostTreeScope {
  private readonly instances: Array<Map<string, CompilerKeyedRowInstance>> = [];
  private readonly staticSegments: Element[][] = [];
  private readonly staticScopes: CompilerHostTreeScope[] = [];
  private readonly staticValues: unknown[] = [];
  private unsubscribe: (() => void) | undefined;
  private active = true;

  constructor(
    private readonly owner: Pick<ConditionalBlockOwner, "subscribe">,
    private readonly root: Element,
    private host: CompilerHostElement,
    private block: CompilerHostKeyedRanges,
    private readonly onFallback: () => void,
  ) {}

  private readRange(range: CompilerKeyedRange): NestedReadKeyedRange | null {
    const items = materializeIterable(range.items());
    const keys = items.map((item, index) => keyedRowIdentity(range.rowKey(item, index)));
    return new Set(keys).size === keys.length ? { items, keys } : null;
  }

  private readRanges(): NestedReadKeyedRange[] | null {
    const ranges: NestedReadKeyedRange[] = [];
    for (const range of this.block.ranges) {
      const rows = this.readRange(range);
      if (!rows) return null;
      ranges.push(rows);
    }
    return ranges;
  }

  private mountStatic(
    elements: readonly Element[],
    descriptors: readonly CompilerHostElement[],
  ): boolean {
    if (elements.length !== descriptors.length) return false;
    for (let index = 0; index < elements.length; index += 1) {
      const scope = mountCompilerHostTree(
        this.owner,
        elements[index],
        descriptors[index],
        this.onFallback,
      );
      if (!scope) return false;
      this.staticScopes.push(scope);
    }
    return true;
  }

  adopt(): boolean {
    if (!Number.isSafeInteger(this.block.trailing) || this.block.trailing < 0) return false;
    const rowsByRange = this.readRanges();
    if (!rowsByRange) return false;
    const elements = [...this.root.children];
    const descriptors = flattenCompilerHostElements(materializeCompilerHostChildren(this.host));
    if (elements.length !== descriptors.length) return false;
    let cursor = 0;

    for (let rangeIndex = 0; rangeIndex < this.block.ranges.length; rangeIndex += 1) {
      const range = this.block.ranges[rangeIndex];
      const rows = rowsByRange[rangeIndex];
      if (!Number.isSafeInteger(range.before) || range.before < 0) {
        this.cleanup();
        return false;
      }
      const staticEnd = cursor + range.before;
      if (
        staticEnd > elements.length ||
        !this.mountStatic(elements.slice(cursor, staticEnd), descriptors.slice(cursor, staticEnd))
      ) {
        this.cleanup();
        return false;
      }
      this.staticSegments.push(elements.slice(cursor, staticEnd));
      cursor = staticEnd;

      const instances = new Map<string, CompilerKeyedRowInstance>();
      for (let index = 0; index < rows.items.length; index += 1) {
        const element = elements[cursor + index];
        if (!element) {
          this.cleanup();
          return false;
        }
        const descriptor = range.create(rows.items[index], index);
        const scope = mountCompilerHostTree(this.owner, element, descriptor, this.onFallback);
        if (!scope) {
          this.cleanup();
          return false;
        }
        instances.set(rows.keys[index], {
          key: rows.keys[index],
          element,
          scope,
          values: range.bindings.map(() => UNSET_KEYED_ROW_BINDING),
          item: rows.items[index],
          index,
          conditionalValues: new Map(),
        });
        applyKeyedRowBindings(range, instances.get(rows.keys[index])!, rows.items[index], index);
      }
      this.instances.push(instances);
      cursor += rows.items.length;
    }

    const trailingEnd = cursor + this.block.trailing;
    if (
      trailingEnd !== elements.length ||
      !this.mountStatic(elements.slice(cursor), descriptors.slice(cursor))
    ) {
      this.cleanup();
      return false;
    }
    this.staticSegments.push(elements.slice(cursor));
    if (!applyStaticRangeBindings(this.block.bindings, this.staticSegments, this.staticValues)) {
      this.cleanup();
      return false;
    }
    this.unsubscribe = this.owner.subscribe(this.block.id, this.refresh);
    return true;
  }

  private anchorAfter(rangeIndex: number): ChildNode | null {
    for (let next = rangeIndex + 1; next < this.instances.length; next += 1) {
      const staticAnchor = this.staticSegments[next]?.[0];
      if (staticAnchor) return staticAnchor;
      const rowAnchor = this.instances[next].values().next().value?.element;
      if (rowAnchor) return rowAnchor;
    }
    return this.staticSegments[this.instances.length]?.[0] || null;
  }

  private reconcileRange(rangeIndex: number, rows: NestedReadKeyedRange): boolean {
    const range = this.block.ranges[rangeIndex];
    const previous = this.instances[rangeIndex];
    const oldIndices = new Map<string, number>();
    [...previous.keys()].forEach((key, index) => oldIndices.set(key, index));
    const nextKeys = new Set(rows.keys);
    for (const [key, instance] of previous) {
      if (nextKeys.has(key)) continue;
      instance.scope?.cleanup();
      instance.element.remove();
    }

    const sequence = rows.keys.map((key) => oldIndices.get(key) ?? -1);
    const stablePositions = longestIncreasingSubsequencePositions(sequence);
    const nextInstances: CompilerKeyedRowInstance[] = [];
    for (let index = 0; index < rows.items.length; index += 1) {
      const key = rows.keys[index];
      const existing = previous.get(key);
      if (existing) {
        const descriptor = range.create(rows.items[index], index);
        if (!existing.scope?.update(descriptor)) return false;
        applyKeyedRowBindings(range, existing, rows.items[index], index);
        existing.item = rows.items[index];
        existing.index = index;
        nextInstances.push(existing);
        continue;
      }
      const descriptor = range.create(rows.items[index], index);
      const element = createCompilerHostElement(this.root.ownerDocument, descriptor);
      const scope = mountCompilerHostTree(this.owner, element, descriptor, this.onFallback);
      if (!scope) return false;
      nextInstances.push({
        key,
        element,
        scope,
        values: readKeyedRowBindingValues(range, rows.items[index], index),
        item: rows.items[index],
        index,
        conditionalValues: new Map(),
      });
    }

    let anchor = this.anchorAfter(rangeIndex);
    for (let index = nextInstances.length - 1; index >= 0; index -= 1) {
      const instance = nextInstances[index];
      if (
        sequence[index] < 0 ||
        (!stablePositions.has(index) && instance.element.nextSibling !== anchor)
      ) {
        this.root.insertBefore(instance.element, anchor);
      }
      anchor = instance.element;
    }
    this.instances[rangeIndex] = new Map(nextInstances.map((instance) => [instance.key, instance]));
    return true;
  }

  private refresh = (afterCommit?: () => void) => {
    if (!this.active) {
      afterCommit?.();
      return;
    }
    const rowsByRange = this.readRanges();
    if (!rowsByRange || rowsByRange.length !== this.instances.length) {
      this.onFallback();
      afterCommit?.();
      return;
    }
    if (!applyStaticRangeBindings(this.block.bindings, this.staticSegments, this.staticValues)) {
      this.onFallback();
      afterCommit?.();
      return;
    }
    const activeElement = this.root.ownerDocument.activeElement;
    const restoreFocus = Boolean(activeElement && this.root.contains(activeElement));
    for (let index = rowsByRange.length - 1; index >= 0; index -= 1) {
      if (!this.reconcileRange(index, rowsByRange[index])) {
        this.onFallback();
        afterCommit?.();
        return;
      }
    }
    if (
      restoreFocus &&
      activeElement?.isConnected &&
      activeElement.ownerDocument.activeElement !== activeElement &&
      "focus" in activeElement
    ) {
      (activeElement as HTMLElement).focus({ preventScroll: true });
    }
    afterCommit?.();
  };

  private updateStaticScopes(
    descriptor: CompilerHostElement,
    rowsByRange: readonly NestedReadKeyedRange[],
  ): boolean {
    const descriptors = flattenCompilerHostElements(materializeCompilerHostChildren(descriptor));
    let descriptorIndex = 0;
    let scopeIndex = 0;
    for (let rangeIndex = 0; rangeIndex < this.block.ranges.length; rangeIndex += 1) {
      const range = this.block.ranges[rangeIndex];
      for (let index = 0; index < range.before; index += 1) {
        const scope = this.staticScopes[scopeIndex++];
        const child = descriptors[descriptorIndex++];
        if (!scope || !child || !scope.update(child)) return false;
      }
      descriptorIndex += rowsByRange[rangeIndex].items.length;
    }
    for (let index = 0; index < this.block.trailing; index += 1) {
      const scope = this.staticScopes[scopeIndex++];
      const child = descriptors[descriptorIndex++];
      if (!scope || !child || !scope.update(child)) return false;
    }
    return scopeIndex === this.staticScopes.length && descriptorIndex === descriptors.length;
  }

  update(descriptor: CompilerHostElement): boolean {
    const block = descriptor.block;
    if (
      !this.active ||
      block?.kind !== "keyed-ranges" ||
      block.id !== this.block.id ||
      block.ranges.length !== this.block.ranges.length ||
      block.trailing !== this.block.trailing ||
      block.ranges.some((range, index) => range.before !== this.block.ranges[index].before)
    ) {
      return false;
    }
    this.host = descriptor;
    this.block = block;
    const rowsByRange = this.readRanges();
    if (
      !rowsByRange ||
      rowsByRange.length !== this.instances.length ||
      !this.updateStaticScopes(descriptor, rowsByRange) ||
      !applyStaticRangeBindings(this.block.bindings, this.staticSegments, this.staticValues)
    ) {
      return false;
    }
    for (let index = rowsByRange.length - 1; index >= 0; index -= 1) {
      if (!this.reconcileRange(index, rowsByRange[index])) return false;
    }
    return true;
  }

  cleanup(): void {
    if (!this.active) return;
    this.active = false;
    this.unsubscribe?.();
    for (const instances of this.instances) {
      for (const instance of instances.values()) instance.scope?.cleanup();
    }
    for (const scope of this.staticScopes) scope.cleanup();
    this.instances.length = 0;
    this.staticSegments.length = 0;
    this.staticScopes.length = 0;
    this.staticValues.length = 0;
  }
}

type NestedMixedRangeSnapshot =
  | { kind: "conditional"; selection: CompilerHostConditionalPreparedSelection }
  | { kind: "keyed"; rows: NestedReadKeyedRange };

type NestedMixedRangeInstance =
  | { kind: "conditional"; value: NestedConditionalRangeInstance | null }
  | { kind: "keyed"; value: Map<string, CompilerKeyedRowInstance> };

class CompilerNestedMixedRanges implements CompilerHostTreeScope {
  private readonly instances: NestedMixedRangeInstance[] = [];
  private readonly staticSegments: Element[][] = [];
  private readonly staticScopes: CompilerHostTreeScope[] = [];
  private readonly staticValues: unknown[] = [];
  private unsubscribe: (() => void) | undefined;
  private active = true;

  constructor(
    private readonly owner: Pick<ConditionalBlockOwner, "subscribe">,
    private readonly root: Element,
    private host: CompilerHostElement,
    private block: CompilerHostMixedRanges,
    private readonly onFallback: () => void,
  ) {}

  private readSnapshots(): NestedMixedRangeSnapshot[] | null {
    const snapshots: NestedMixedRangeSnapshot[] = [];
    for (const range of this.block.ranges) {
      if (range.kind === "conditional") {
        const selection = hostConditionalSelection(range);
        if (selection.kind === "fallback") return null;
        snapshots.push({ kind: "conditional", selection });
        continue;
      }
      const items = materializeIterable(range.items());
      const keys = items.map((item, index) => keyedRowIdentity(range.rowKey(item, index)));
      if (new Set(keys).size !== keys.length) return null;
      snapshots.push({ kind: "keyed", rows: { items, keys } });
    }
    return snapshots;
  }

  private mountStatic(
    elements: readonly Element[],
    descriptors: readonly CompilerHostElement[],
  ): boolean {
    if (elements.length !== descriptors.length) return false;
    for (let index = 0; index < elements.length; index += 1) {
      const scope = mountCompilerHostTree(
        this.owner,
        elements[index],
        descriptors[index],
        this.onFallback,
      );
      if (!scope) return false;
      this.staticScopes.push(scope);
    }
    return true;
  }

  adopt(): boolean {
    if (!Number.isSafeInteger(this.block.trailing) || this.block.trailing < 0) return false;
    const snapshots = this.readSnapshots();
    if (!snapshots) return false;
    const elements = [...this.root.children];
    const descriptors = flattenCompilerHostElements(this.host.children);
    if (elements.length !== descriptors.length) return false;
    let cursor = 0;

    for (let rangeIndex = 0; rangeIndex < this.block.ranges.length; rangeIndex += 1) {
      const range = this.block.ranges[rangeIndex];
      const snapshot = snapshots[rangeIndex];
      if (!Number.isSafeInteger(range.before) || range.before < 0 || range.kind !== snapshot.kind) {
        this.cleanup();
        return false;
      }
      const staticEnd = cursor + range.before;
      if (
        staticEnd > elements.length ||
        !this.mountStatic(elements.slice(cursor, staticEnd), descriptors.slice(cursor, staticEnd))
      ) {
        this.cleanup();
        return false;
      }
      this.staticSegments.push(elements.slice(cursor, staticEnd));
      cursor = staticEnd;

      if (range.kind === "conditional" && snapshot.kind === "conditional") {
        if (snapshot.selection.kind === "empty") {
          this.instances.push({ kind: "conditional", value: null });
          continue;
        }
        const element = elements[cursor];
        if (!element) {
          this.cleanup();
          return false;
        }
        const descriptor = snapshot.selection.branch.create();
        const host = mountCompilerHostInstance(
          this.owner,
          element,
          descriptor,
          snapshot.selection.branch,
          this.onFallback,
        );
        if (!host) {
          this.cleanup();
          return false;
        }
        this.instances.push({
          kind: "conditional",
          value: { key: snapshot.selection.key, host },
        });
        cursor += 1;
        continue;
      }

      if (range.kind !== "keyed" || snapshot.kind !== "keyed") {
        this.cleanup();
        return false;
      }
      const keyedInstances = new Map<string, CompilerKeyedRowInstance>();
      for (let index = 0; index < snapshot.rows.items.length; index += 1) {
        const element = elements[cursor + index];
        if (!element) {
          this.cleanup();
          return false;
        }
        const descriptor = range.create(snapshot.rows.items[index], index);
        const scope = mountCompilerHostTree(this.owner, element, descriptor, this.onFallback);
        if (!scope) {
          this.cleanup();
          return false;
        }
        const instance: CompilerKeyedRowInstance = {
          key: snapshot.rows.keys[index],
          element,
          scope,
          values: range.bindings.map(() => UNSET_KEYED_ROW_BINDING),
          item: snapshot.rows.items[index],
          index,
          conditionalValues: new Map(),
        };
        try {
          applyKeyedRowBindings(range, instance, snapshot.rows.items[index], index);
        } catch (error) {
          scope.cleanup();
          throw error;
        }
        keyedInstances.set(snapshot.rows.keys[index], instance);
      }
      this.instances.push({ kind: "keyed", value: keyedInstances });
      cursor += snapshot.rows.items.length;
    }

    const trailingEnd = cursor + this.block.trailing;
    if (
      trailingEnd !== elements.length ||
      !this.mountStatic(elements.slice(cursor), descriptors.slice(cursor))
    ) {
      this.cleanup();
      return false;
    }
    this.staticSegments.push(elements.slice(cursor));
    if (!applyStaticRangeBindings(this.block.bindings, this.staticSegments, this.staticValues)) {
      this.cleanup();
      return false;
    }
    this.unsubscribe = this.owner.subscribe(this.block.id, this.refresh);
    return true;
  }

  private firstInstanceElement(instance: NestedMixedRangeInstance): Element | null {
    if (instance.kind === "conditional") return instance.value?.host.element || null;
    return instance.value.values().next().value?.element || null;
  }

  private anchorAfter(rangeIndex: number): ChildNode | null {
    for (let next = rangeIndex + 1; next < this.instances.length; next += 1) {
      const staticAnchor = this.staticSegments[next]?.[0];
      if (staticAnchor) return staticAnchor;
      const rangeAnchor = this.firstInstanceElement(this.instances[next]);
      if (rangeAnchor) return rangeAnchor;
    }
    return this.staticSegments[this.instances.length]?.[0] || null;
  }

  private reconcileConditional(
    rangeIndex: number,
    range: CompilerMixedRange & { kind: "conditional" },
    selection: CompilerHostConditionalPreparedSelection,
  ): boolean {
    const instance = this.instances[rangeIndex];
    if (instance.kind !== "conditional") return false;
    const previous = instance.value;
    if (selection.kind === "empty") {
      previous?.host.scope?.cleanup();
      previous?.host.element.remove();
      instance.value = null;
      return true;
    }
    if (previous?.key === selection.key) {
      const descriptor = selection.branch.create();
      if (!previous.host.scope?.update(descriptor)) return false;
      applyHostConditionalBindings(selection.branch, previous.host);
      return true;
    }
    const descriptor = selection.branch.create();
    const element = createCompilerHostElement(this.root.ownerDocument, descriptor);
    const host = mountCompilerHostInstance(
      this.owner,
      element,
      descriptor,
      selection.branch,
      this.onFallback,
    );
    if (!host) return false;
    previous?.host.scope?.cleanup();
    if (previous) previous.host.element.replaceWith(element);
    else this.root.insertBefore(element, this.anchorAfter(rangeIndex));
    instance.value = { key: selection.key, host };
    return true;
  }

  private reconcileKeyed(
    rangeIndex: number,
    range: CompilerMixedRange & { kind: "keyed" },
    rows: NestedReadKeyedRange,
  ): boolean {
    const instance = this.instances[rangeIndex];
    if (instance.kind !== "keyed") return false;
    const previous = instance.value;
    const oldIndices = new Map<string, number>();
    [...previous.keys()].forEach((key, index) => oldIndices.set(key, index));
    const nextKeys = new Set(rows.keys);
    for (const [key, row] of previous) {
      if (nextKeys.has(key)) continue;
      row.scope?.cleanup();
      row.element.remove();
    }

    const sequence = rows.keys.map((key) => oldIndices.get(key) ?? -1);
    const stablePositions = longestIncreasingSubsequencePositions(sequence);
    const nextInstances: CompilerKeyedRowInstance[] = [];
    for (let index = 0; index < rows.items.length; index += 1) {
      const key = rows.keys[index];
      const existing = previous.get(key);
      if (existing) {
        const descriptor = range.create(rows.items[index], index);
        if (!existing.scope?.update(descriptor)) return false;
        applyKeyedRowBindings(range, existing, rows.items[index], index);
        existing.item = rows.items[index];
        existing.index = index;
        nextInstances.push(existing);
        continue;
      }
      const descriptor = range.create(rows.items[index], index);
      const element = createCompilerHostElement(this.root.ownerDocument, descriptor);
      const scope = mountCompilerHostTree(this.owner, element, descriptor, this.onFallback);
      if (!scope) return false;
      let values: unknown[];
      try {
        values = readKeyedRowBindingValues(range, rows.items[index], index);
      } catch (error) {
        scope.cleanup();
        throw error;
      }
      nextInstances.push({
        key,
        element,
        scope,
        values,
        item: rows.items[index],
        index,
        conditionalValues: new Map(),
      });
    }

    let anchor = this.anchorAfter(rangeIndex);
    for (let index = nextInstances.length - 1; index >= 0; index -= 1) {
      const row = nextInstances[index];
      if (
        sequence[index] < 0 ||
        (!stablePositions.has(index) && row.element.nextSibling !== anchor)
      ) {
        this.root.insertBefore(row.element, anchor);
      }
      anchor = row.element;
    }
    instance.value = new Map(nextInstances.map((row) => [row.key, row]));
    return true;
  }

  private reconcileRange(rangeIndex: number, snapshot: NestedMixedRangeSnapshot): boolean {
    const range = this.block.ranges[rangeIndex];
    if (range.kind !== snapshot.kind) return false;
    return range.kind === "conditional" && snapshot.kind === "conditional"
      ? this.reconcileConditional(rangeIndex, range, snapshot.selection)
      : range.kind === "keyed" && snapshot.kind === "keyed"
        ? this.reconcileKeyed(rangeIndex, range, snapshot.rows)
        : false;
  }

  private refresh = (afterCommit?: () => void) => {
    if (!this.active) {
      afterCommit?.();
      return;
    }
    const snapshots = this.readSnapshots();
    if (!snapshots || snapshots.length !== this.instances.length) {
      this.onFallback();
      afterCommit?.();
      return;
    }
    if (!applyStaticRangeBindings(this.block.bindings, this.staticSegments, this.staticValues)) {
      this.onFallback();
      afterCommit?.();
      return;
    }
    const activeElement = this.root.ownerDocument.activeElement;
    const restoreFocus = Boolean(activeElement && this.root.contains(activeElement));
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      if (!this.reconcileRange(index, snapshots[index])) {
        this.onFallback();
        afterCommit?.();
        return;
      }
    }
    if (
      restoreFocus &&
      activeElement?.isConnected &&
      activeElement.ownerDocument.activeElement !== activeElement &&
      "focus" in activeElement
    ) {
      (activeElement as HTMLElement).focus({ preventScroll: true });
    }
    afterCommit?.();
  };

  private updateStaticScopes(
    descriptor: CompilerHostElement,
    snapshots: readonly NestedMixedRangeSnapshot[],
  ): boolean {
    const descriptors = flattenCompilerHostElements(descriptor.children);
    let descriptorIndex = 0;
    let scopeIndex = 0;
    for (let rangeIndex = 0; rangeIndex < this.block.ranges.length; rangeIndex += 1) {
      const range = this.block.ranges[rangeIndex];
      for (let index = 0; index < range.before; index += 1) {
        const scope = this.staticScopes[scopeIndex++];
        const child = descriptors[descriptorIndex++];
        if (!scope || !child || !scope.update(child)) return false;
      }
      const snapshot = snapshots[rangeIndex];
      if (snapshot.kind === "conditional") {
        if (snapshot.selection.kind === "branch") descriptorIndex += 1;
      } else {
        descriptorIndex += snapshot.rows.items.length;
      }
    }
    for (let index = 0; index < this.block.trailing; index += 1) {
      const scope = this.staticScopes[scopeIndex++];
      const child = descriptors[descriptorIndex++];
      if (!scope || !child || !scope.update(child)) return false;
    }
    return scopeIndex === this.staticScopes.length && descriptorIndex === descriptors.length;
  }

  update(descriptor: CompilerHostElement): boolean {
    const block = descriptor.block;
    if (
      !this.active ||
      block?.kind !== "mixed-ranges" ||
      block.id !== this.block.id ||
      block.ranges.length !== this.block.ranges.length ||
      block.trailing !== this.block.trailing ||
      block.ranges.some(
        (range, index) =>
          range.kind !== this.block.ranges[index].kind ||
          range.before !== this.block.ranges[index].before,
      )
    ) {
      return false;
    }
    this.host = descriptor;
    this.block = block;
    const snapshots = this.readSnapshots();
    if (
      !snapshots ||
      snapshots.length !== this.instances.length ||
      !this.updateStaticScopes(descriptor, snapshots) ||
      !applyStaticRangeBindings(this.block.bindings, this.staticSegments, this.staticValues)
    ) {
      return false;
    }
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      if (!this.reconcileRange(index, snapshots[index])) return false;
    }
    return true;
  }

  cleanup(): void {
    if (!this.active) return;
    this.active = false;
    this.unsubscribe?.();
    for (const instance of this.instances) {
      if (instance.kind === "conditional") {
        instance.value?.host.scope?.cleanup();
      } else {
        for (const row of instance.value.values()) row.scope?.cleanup();
      }
    }
    for (const scope of this.staticScopes) scope.cleanup();
    this.instances.length = 0;
    this.staticSegments.length = 0;
    this.staticScopes.length = 0;
    this.staticValues.length = 0;
  }
}

function createHostConditionalBlockComponent(
  owner: Pick<ConditionalBlockOwner, "subscribe">,
): React.ComponentType<CompilerHostConditionalBlockProps> {
  interface State {
    fallback: boolean;
  }

  class FarmHostConditionalBlock extends React.Component<CompilerHostConditionalBlockProps, State> {
    static displayName = "FarmCompiledHostConditional";

    state: State = { fallback: false };
    private root: Element | null = null;
    private mounted = false;
    private fallbackRequested = false;
    private fallbackVersion = 0;
    private propSyncQueued = false;
    private currentProps = this.props;
    private unsubscribe: (() => void) | undefined;
    private fallbackUnsubscribers: Array<() => void> = [];
    private activeBranch: "truthy" | "falsy" | null = null;
    private instance: CompilerHostInstance | null = null;

    private requestNestedFallback = () => {
      this.instance?.scope?.cleanup();
      this.activateFallback();
    };

    private subscribeFallbackDescendants(): void {
      for (const unsubscribe of this.fallbackUnsubscribers) unsubscribe();
      this.fallbackUnsubscribers = [];
      const ids = new Set<number>();
      if (this.currentProps.truthy) {
        collectCompilerHostBlockIds(this.currentProps.truthy.create(), ids);
      }
      if (this.currentProps.falsy) {
        collectCompilerHostBlockIds(this.currentProps.falsy.create(), ids);
      }
      ids.delete(this.currentProps.id);
      for (const id of ids) {
        this.fallbackUnsubscribers.push(
          owner.subscribe(id, (afterCommit) => {
            this.fallbackVersion += 1;
            this.forceUpdate(afterCommit);
          }),
        );
      }
    }

    private captureRoot = (root: Element | null) => {
      this.root = root;
    };

    private adopt(): boolean {
      if (!this.root) return false;
      const selection = hostConditionalSelection(this.currentProps);
      if (selection.kind === "fallback") return false;
      if (selection.kind === "empty") {
        if (this.root.childNodes.length !== 0) return false;
        this.activeBranch = null;
        this.instance = null;
        return true;
      }
      if (
        this.root.childNodes.length !== 1 ||
        this.root.firstElementChild === null ||
        this.root.firstElementChild !== this.root.firstChild
      ) {
        return false;
      }
      const descriptor = selection.branch.create();
      const element = this.root.firstElementChild;
      if (!matchesCompilerHostElement(element, descriptor)) return false;
      const instance = mountCompilerHostInstance(
        owner,
        element,
        descriptor,
        selection.branch,
        this.requestNestedFallback,
      );
      if (!instance) return false;
      this.activeBranch = selection.key;
      this.instance = instance;
      return true;
    }

    private activateFallback(afterCommit?: () => void): void {
      if (!this.mounted || this.state.fallback || this.fallbackRequested) {
        afterCommit?.();
        return;
      }
      this.fallbackRequested = true;
      this.instance?.scope?.cleanup();
      this.instance = null;
      this.activeBranch = null;
      this.subscribeFallbackDescendants();
      // One key change on entry: the compiled path mutated the DOM behind
      // React's back, so the first fallback render must rebuild the subtree.
      this.fallbackVersion += 1;
      this.setState({ fallback: true }, afterCommit);
    }

    private reconcile(afterCommit?: () => void): void {
      if (!this.mounted || !this.root) {
        afterCommit?.();
        return;
      }
      if (this.state.fallback) {
        // React owns the container while in fallback; re-render with the
        // stable key so updates reconcile in place instead of remounting the
        // subtree (which would wipe uncontrolled inputs, focus, and scroll).
        this.forceUpdate(afterCommit);
        return;
      }

      const selection = hostConditionalSelection(this.currentProps);
      if (selection.kind === "fallback") {
        this.activateFallback(afterCommit);
        return;
      }
      if (selection.kind === "empty") {
        this.instance?.scope?.cleanup();
        if (this.instance) this.instance.element.remove();
        this.activeBranch = null;
        this.instance = null;
        afterCommit?.();
        return;
      }
      if (this.activeBranch === selection.key && this.instance) {
        const descriptor = selection.branch.create();
        const scope = mountCompilerHostTree(
          owner,
          this.instance.element,
          descriptor,
          this.requestNestedFallback,
        );
        if (!scope) {
          this.activateFallback(afterCommit);
          return;
        }
        this.instance.scope?.cleanup();
        this.instance.scope = scope;
        applyHostConditionalBindings(selection.branch, this.instance);
        afterCommit?.();
        return;
      }

      const descriptor = selection.branch.create();
      const element = createCompilerHostElement(this.root.ownerDocument, descriptor);
      const instance = mountCompilerHostInstance(
        owner,
        element,
        descriptor,
        selection.branch,
        this.requestNestedFallback,
      );
      if (!instance) {
        this.activateFallback(afterCommit);
        return;
      }
      this.instance?.scope?.cleanup();
      this.root.replaceChildren(element);
      this.activeBranch = selection.key;
      this.instance = instance;
      afterCommit?.();
    }

    private refresh = (afterCommit?: () => void) => {
      this.reconcile(afterCommit);
    };

    private schedulePropSync(): void {
      if (this.propSyncQueued) return;
      this.propSyncQueued = true;
      queueMicrotask(() => {
        this.propSyncQueued = false;
        if (this.mounted && !this.state.fallback) this.reconcile();
      });
    }

    shouldComponentUpdate(nextProps: CompilerHostConditionalBlockProps, nextState: State): boolean {
      this.currentProps = nextProps;
      if (nextState.fallback || this.state.fallback) return true;
      this.schedulePropSync();
      return false;
    }

    componentDidMount(): void {
      this.mounted = true;
      this.unsubscribe = owner.subscribe(this.props.id, this.refresh);
      if (!this.adopt()) this.activateFallback();
    }

    componentWillUnmount(): void {
      this.mounted = false;
      this.unsubscribe?.();
      for (const unsubscribe of this.fallbackUnsubscribers) unsubscribe();
      this.fallbackUnsubscribers = [];
      this.instance?.scope?.cleanup();
      this.root = null;
      this.activeBranch = null;
      this.instance = null;
    }

    render(): React.ReactNode {
      const container = this.currentProps.render();
      if (!React.isValidElement(container) || typeof container.type !== "string") {
        throw new TypeError(
          `Compiled host conditional ${this.currentProps.id} must own one host container.`,
        );
      }
      return React.cloneElement(container, {
        key: this.state.fallback ? `react-${this.fallbackVersion}` : "compiled",
        ref: this.captureRoot,
      } as React.Attributes);
    }
  }

  return FarmHostConditionalBlock;
}

function createConditionalRangesBlockComponent(
  owner: Pick<ConditionalBlockOwner, "subscribe">,
): React.ComponentType<CompilerConditionalRangesBlockProps> {
  interface State {
    fallback: boolean;
  }

  interface ConditionalRangeInstance {
    key: "truthy" | "falsy";
    host: CompilerHostInstance;
  }

  class FarmConditionalRangesBlock extends React.Component<
    CompilerConditionalRangesBlockProps,
    State
  > {
    static displayName = "FarmCompiledConditionalRanges";

    state: State = { fallback: false };
    private root: Element | null = null;
    private mounted = false;
    private fallbackRequested = false;
    private fallbackVersion = 0;
    private propFallbackQueued = false;
    private currentProps = this.props;
    private unsubscribe: (() => void) | undefined;
    private fallbackUnsubscribers: Array<() => void> = [];
    private rangeInstances: Array<ConditionalRangeInstance | null> = [];
    private staticSegments: Element[][] = [];
    private readonly staticValues: unknown[] = [];

    private requestNestedFallback = () => {
      for (const instance of this.rangeInstances) instance?.host.scope?.cleanup();
      this.activateFallback();
    };

    private subscribeFallbackDescendants(): void {
      for (const unsubscribe of this.fallbackUnsubscribers) unsubscribe();
      this.fallbackUnsubscribers = [];
      const ids = new Set<number>();
      for (const range of this.currentProps.ranges) {
        if (range.truthy) collectCompilerHostBlockIds(range.truthy.create(), ids);
        if (range.falsy) collectCompilerHostBlockIds(range.falsy.create(), ids);
      }
      ids.delete(this.currentProps.id);
      for (const id of ids) {
        this.fallbackUnsubscribers.push(
          owner.subscribe(id, (afterCommit) => {
            this.fallbackVersion += 1;
            this.forceUpdate(afterCommit);
          }),
        );
      }
    }

    private captureRoot = (root: Element | null) => {
      this.root = root;
      this.currentProps.rootRef?.(root);
    };

    private readSelections(
      props: CompilerConditionalRangesBlockProps,
    ): CompilerHostConditionalPreparedSelection[] | null {
      const selections: CompilerHostConditionalPreparedSelection[] = [];
      for (const range of props.ranges) {
        const selection = hostConditionalSelection(range);
        if (selection.kind === "fallback") return null;
        selections.push(selection);
      }
      return selections;
    }

    private adopt(props: CompilerConditionalRangesBlockProps = this.currentProps): boolean {
      if (!this.root || !Number.isSafeInteger(props.trailing) || props.trailing < 0) return false;
      const selections = this.readSelections(props);
      if (!selections) return false;
      const elements = [...this.root.children];
      const staticSegments: Element[][] = [];
      const instances: Array<ConditionalRangeInstance | null> = [];
      const cleanupInstances = () => {
        for (const instance of instances) instance?.host.scope?.cleanup();
      };
      let cursor = 0;

      for (let rangeIndex = 0; rangeIndex < props.ranges.length; rangeIndex += 1) {
        const range = props.ranges[rangeIndex];
        if (!Number.isSafeInteger(range.before) || range.before < 0) {
          cleanupInstances();
          return false;
        }
        const staticEnd = cursor + range.before;
        if (staticEnd > elements.length) {
          cleanupInstances();
          return false;
        }
        staticSegments.push(elements.slice(cursor, staticEnd));
        cursor = staticEnd;

        const selection = selections[rangeIndex];
        if (selection.kind === "empty") {
          instances.push(null);
          continue;
        }
        const element = elements[cursor];
        if (!element) {
          cleanupInstances();
          return false;
        }
        const descriptor = selection.branch.create();
        if (!matchesCompilerHostElement(element, descriptor)) {
          cleanupInstances();
          return false;
        }
        const host = mountCompilerHostInstance(
          owner,
          element,
          descriptor,
          selection.branch,
          this.requestNestedFallback,
        );
        if (!host) {
          cleanupInstances();
          return false;
        }
        instances.push({
          key: selection.key,
          host,
        });
        cursor += 1;
      }

      if (cursor + props.trailing !== elements.length) {
        cleanupInstances();
        return false;
      }
      staticSegments.push(elements.slice(cursor));
      this.staticSegments = staticSegments;
      this.rangeInstances = instances;
      if (!applyStaticRangeBindings(props.bindings, this.staticSegments, this.staticValues)) {
        cleanupInstances();
        this.rangeInstances = [];
        this.staticSegments = [];
        return false;
      }
      return true;
    }

    private anchorAfter(rangeIndex: number): ChildNode | null {
      for (let next = rangeIndex + 1; next < this.rangeInstances.length; next += 1) {
        const staticAnchor = this.staticSegments[next]?.[0];
        if (staticAnchor) return staticAnchor;
        const rangeAnchor = this.rangeInstances[next]?.host.element;
        if (rangeAnchor) return rangeAnchor;
      }
      return this.staticSegments[this.rangeInstances.length]?.[0] || null;
    }

    private reconcileRange(
      rangeIndex: number,
      selection: CompilerHostConditionalPreparedSelection,
    ): boolean {
      if (!this.root) return false;
      const previous = this.rangeInstances[rangeIndex];
      if (selection.kind === "empty") {
        previous?.host.scope?.cleanup();
        previous?.host.element.remove();
        this.rangeInstances[rangeIndex] = null;
        return true;
      }
      if (previous?.key === selection.key) {
        const descriptor = selection.branch.create();
        const scope = mountCompilerHostTree(
          owner,
          previous.host.element,
          descriptor,
          this.requestNestedFallback,
        );
        if (!scope) {
          this.requestNestedFallback();
          return false;
        }
        previous.host.scope?.cleanup();
        previous.host.scope = scope;
        applyHostConditionalBindings(selection.branch, previous.host);
        return true;
      }

      const descriptor = selection.branch.create();
      const element = createCompilerHostElement(this.root.ownerDocument, descriptor);
      const host = mountCompilerHostInstance(
        owner,
        element,
        descriptor,
        selection.branch,
        this.requestNestedFallback,
      );
      if (!host) {
        this.requestNestedFallback();
        return false;
      }
      previous?.host.scope?.cleanup();
      if (previous) previous.host.element.replaceWith(element);
      else this.root.insertBefore(element, this.anchorAfter(rangeIndex));
      this.rangeInstances[rangeIndex] = {
        key: selection.key,
        host,
      };
      return true;
    }

    private reconcile(afterCommit?: () => void): void {
      if (!this.mounted || !this.root) {
        afterCommit?.();
        return;
      }
      if (this.state.fallback) {
        this.fallbackVersion += 1;
        this.forceUpdate(afterCommit);
        return;
      }
      if (this.currentProps.ranges.length !== this.rangeInstances.length) {
        this.activateFallback(afterCommit);
        return;
      }
      const selections = this.readSelections(this.currentProps);
      if (!selections) {
        this.activateFallback(afterCommit);
        return;
      }
      if (
        !applyStaticRangeBindings(
          this.currentProps.bindings,
          this.staticSegments,
          this.staticValues,
        )
      ) {
        this.activateFallback(afterCommit);
        return;
      }

      for (let rangeIndex = this.rangeInstances.length - 1; rangeIndex >= 0; rangeIndex -= 1) {
        if (!this.reconcileRange(rangeIndex, selections[rangeIndex])) {
          afterCommit?.();
          return;
        }
      }
      afterCommit?.();
    }

    private refresh = (afterCommit?: () => void) => {
      this.reconcile(afterCommit);
    };

    private activateFallback(afterCommit?: () => void): void {
      if (!this.mounted || this.state.fallback || this.fallbackRequested) {
        afterCommit?.();
        return;
      }
      this.fallbackRequested = true;
      for (const instance of this.rangeInstances) instance?.host.scope?.cleanup();
      this.subscribeFallbackDescendants();
      this.setState({ fallback: true }, afterCommit);
    }

    private schedulePropFallback(): void {
      if (this.propFallbackQueued) return;
      this.propFallbackQueued = true;
      queueMicrotask(() => {
        this.propFallbackQueued = false;
        if (this.mounted && !this.state.fallback) this.activateFallback();
      });
    }

    shouldComponentUpdate(
      nextProps: CompilerConditionalRangesBlockProps,
      nextState: State,
    ): boolean {
      this.currentProps = nextProps;
      if (nextState.fallback || this.state.fallback) return true;
      this.schedulePropFallback();
      return false;
    }

    componentDidMount(): void {
      this.mounted = true;
      this.unsubscribe = owner.subscribe(this.props.id, this.refresh);
      if (!this.adopt()) this.activateFallback();
    }

    componentWillUnmount(): void {
      this.mounted = false;
      this.unsubscribe?.();
      for (const unsubscribe of this.fallbackUnsubscribers) unsubscribe();
      this.fallbackUnsubscribers = [];
      for (const instance of this.rangeInstances) instance?.host.scope?.cleanup();
      this.root = null;
      this.rangeInstances = [];
      this.staticSegments = [];
      this.staticValues.length = 0;
    }

    render(): React.ReactNode {
      const container = this.currentProps.render();
      if (!React.isValidElement(container) || typeof container.type !== "string") {
        throw new TypeError(
          `Compiled conditional ranges ${this.currentProps.id} must own one host container.`,
        );
      }
      return React.cloneElement(container, {
        key: this.state.fallback ? `react-${this.fallbackVersion}` : "compiled",
        ref: this.captureRoot,
      } as React.Attributes);
    }
  }

  return FarmConditionalRangesBlock;
}

/** Returns positions forming the LIS while ignoring newly inserted (-1) entries. */
function longestIncreasingSubsequencePositions(sequence: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous = Array.from({ length: sequence.length }, () => -1);

  for (let index = 0; index < sequence.length; index += 1) {
    if (sequence[index] < 0) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sequence[tails[middle]] < sequence[index]) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  }

  const positions = new Set<number>();
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    positions.add(cursor);
    cursor = previous[cursor];
  }
  return positions;
}

type RowConditionalRefresh = (item: unknown, index: number, afterCommit?: () => void) => void;

interface RowConditionalOwner {
  subscribe(key: string, id: number, refresh: RowConditionalRefresh): () => void;
}

interface RowConditionalProps {
  owner: RowConditionalOwner;
  rowKey: string;
  id: number;
  renderVersion: number;
  item: unknown;
  index: number;
  render(item: unknown, index: number): React.ReactNode;
}

interface RowConditionalState {
  renderVersion: number;
  item: unknown;
  index: number;
}

interface KeyedRowConditionalRuntime {
  Component: React.ComponentType<RowConditionalProps>;
  readValues(
    props: Pick<CompilerKeyedRowsBlockProps, "conditionals">,
    item: unknown,
    index: number,
  ): ReadonlyMap<number, readonly unknown[]>;
  changed(previous: readonly unknown[] | undefined, next: readonly unknown[]): boolean;
}

interface KeyedRowHostRuntime {
  mount(
    element: Element,
    descriptor: CompilerHostElement,
    requestFallback: () => void,
  ): CompilerHostTreeScope | null;
}

interface KeyedMapUpdateRuntime {
  commit(value: unknown): object | undefined;
  reconcile(
    props: CompilerKeyedRowsBlockProps,
    dirtyState: ReadonlySet<number>,
    collectionToken: object | undefined,
    instances: ReadonlyMap<string, CompilerKeyedRowInstance>,
    conditionals: KeyedRowConditionalRuntime | undefined,
  ):
    | {
        collectionToken: object | undefined;
        conditionalChanges: readonly {
          key: string;
          id: number;
          item: unknown;
          index: number;
        }[];
        fallback: boolean;
      }
    | undefined;
}

const keyedMapUpdateRuntime: KeyedMapUpdateRuntime = {
  commit: commitCompilerKeyedCollection,
  reconcile: reconcileCompilerKeyedMapUpdate,
};

interface KeyedRowsRuntimeOptions {
  conditionals?: KeyedRowConditionalRuntime;
  hostBlocks?: KeyedRowHostRuntime;
  keyedMapUpdates?: KeyedMapUpdateRuntime;
}

function reconcileCompilerKeyedMapUpdate(
  props: CompilerKeyedRowsBlockProps,
  dirtyState: ReadonlySet<number>,
  collectionToken: object | undefined,
  instances: ReadonlyMap<string, CompilerKeyedRowInstance>,
  conditionals: KeyedRowConditionalRuntime | undefined,
): ReturnType<KeyedMapUpdateRuntime["reconcile"]> {
  const dependency = props.collectionDependency;
  if (dependency === undefined) return undefined;
  const dependencies = props.dependencies || props.structureDependencies || [];
  const relevantDirty = [...dirtyState].filter((index) => dependencies.includes(index));
  if (relevantDirty.length !== 1 || relevantDirty[0] !== dependency) return undefined;

  const finalValue = props.items();
  const hintedIndices = compilerKeyedMapChangedIndices(finalValue, collectionToken);
  if (!hintedIndices || !Array.isArray(finalValue) || finalValue.length !== instances.size) {
    return undefined;
  }

  const changedIndices = [...new Set(hintedIndices)].sort((left, right) => left - right);
  const updates: Array<{
    key: string;
    item: unknown;
    index: number;
    instance: CompilerKeyedRowInstance;
  }> = [];
  try {
    for (const index of changedIndices) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= finalValue.length) return undefined;
      const item = finalValue[index];
      const key = keyedRowIdentity(props.rowKey(item, index));
      const instance = instances.get(key);
      if (!instance || instance.index !== index) return undefined;
      updates.push({ key, item, index, instance });
    }
  } catch {
    return undefined;
  }

  const conditionalChanges: Array<{ key: string; id: number; item: unknown; index: number }> = [];
  for (const { key, item, index, instance } of updates) {
    if (props.hostBlocks) {
      const descriptor = props.create(item, index);
      if (!instance.scope?.update(descriptor)) {
        return { collectionToken, conditionalChanges: [], fallback: true };
      }
    }
    applyKeyedRowBindings(props, instance, item, index);
    const conditionalValues =
      conditionals?.readValues(props, item, index) || EMPTY_KEYED_ROW_CONDITIONAL_VALUES;
    for (const [id, values] of conditionalValues) {
      if (conditionals?.changed(instance.conditionalValues.get(id), values)) {
        conditionalChanges.push({ key, id, item, index });
      }
    }
    instance.conditionalValues = conditionalValues;
    instance.item = item;
  }
  return {
    collectionToken: commitCompilerKeyedCollection(finalValue),
    conditionalChanges,
    fallback: false,
  };
}

function createKeyedRowConditionalRuntime(): KeyedRowConditionalRuntime {
  class FarmKeyedRowConditional extends React.Component<RowConditionalProps, RowConditionalState> {
    static displayName = "FarmCompiledKeyedRowConditional";

    state: RowConditionalState = {
      renderVersion: this.props.renderVersion,
      item: this.props.item,
      index: this.props.index,
    };
    private unsubscribe: (() => void) | undefined;

    static getDerivedStateFromProps(
      props: RowConditionalProps,
      state: RowConditionalState,
    ): Partial<RowConditionalState> | null {
      if (props.renderVersion === state.renderVersion) return null;
      return {
        renderVersion: props.renderVersion,
        item: props.item,
        index: props.index,
      };
    }

    private refresh: RowConditionalRefresh = (item, index, afterCommit) => {
      this.setState({ item, index }, afterCommit);
    };

    private subscribe(): void {
      this.unsubscribe = this.props.owner.subscribe(this.props.rowKey, this.props.id, this.refresh);
    }

    componentDidMount(): void {
      this.subscribe();
    }

    componentDidUpdate(previous: RowConditionalProps): void {
      if (
        previous.owner === this.props.owner &&
        previous.rowKey === this.props.rowKey &&
        previous.id === this.props.id
      ) {
        return;
      }
      this.unsubscribe?.();
      this.subscribe();
    }

    componentWillUnmount(): void {
      this.unsubscribe?.();
    }

    render(): React.ReactNode {
      return this.props.render(this.state.item, this.state.index);
    }
  }

  return {
    Component: FarmKeyedRowConditional,
    readValues: readKeyedRowConditionalValues,
    changed: keyedRowConditionalChanged,
  };
}

function createKeyedRowHostRuntime(): KeyedRowHostRuntime {
  const owner: Pick<ConditionalBlockOwner, "subscribe"> = {
    subscribe: () => () => {},
  };
  return {
    mount: (element, descriptor, requestFallback) =>
      mountCompilerHostTree(owner, element, descriptor, requestFallback),
  };
}

function createKeyedRowsBlockComponent(
  owner: Pick<ConditionalBlockOwner, "subscribe">,
  options: KeyedRowsRuntimeOptions = {},
): React.ComponentType<CompilerKeyedRowsBlockProps> {
  interface State {
    fallback: boolean;
  }

  class FarmKeyedRowsBlock extends React.Component<CompilerKeyedRowsBlockProps, State> {
    static displayName = "FarmCompiledKeyedRows";

    state: State = { fallback: false };
    private root: Element | null = null;
    private mounted = false;
    private fallbackRequested = false;
    private fallbackVersion = 0;
    private fallbackKeysWereUnsafe = false;
    private propSyncQueued = false;
    private currentProps = this.props;
    private unsubscribe: (() => void) | undefined;
    private instances = new Map<string, CompilerKeyedRowInstance>();
    private identityTargets = new Map<number, CompilerKeyedIdentityTargetSnapshot>();
    private membershipTargets = new Map<number, CompilerKeyedMembershipTargetSnapshot>();
    private mapLookupTargets = new Map<number, CompilerKeyedMapLookupTargetSnapshot>();
    private collectionToken: object | undefined;
    private renderVersion = 0;
    private readonly eventHandlers = new Map<
      string,
      Map<number, React.EventHandler<React.SyntheticEvent>>
    >();
    private readonly conditionalListeners = new Map<string, Map<number, RowConditionalRefresh>>();
    private instancesByElement = new WeakMap<Element, CompilerKeyedRowInstance>();
    private readonly conditionalOwner: RowConditionalOwner = {
      subscribe: (key, id, refresh) => this.subscribeToRowConditional(key, id, refresh),
    };

    private captureRoot = (root: Element | null) => {
      this.root = root;
    };

    private requestHostScopeFallback = () => {
      this.activateFallback();
    };

    private readRows(
      props: CompilerKeyedRowsBlockProps,
    ): { items: unknown[]; keys: string[] } | null {
      const items = materializeIterable(props.items());
      const keys = items.map((item, index) => keyedRowIdentity(props.rowKey(item, index)));
      if (new Set(keys).size !== keys.length) return null;
      return { items, keys };
    }

    private rowEvent = (
      item: unknown,
      index: number,
      eventId: number,
    ): React.EventHandler<React.SyntheticEvent> => {
      if (this.state.fallback) {
        return (event) => this.currentProps.events?.[eventId]?.invoke(item, index, event);
      }
      if (this.usesDelegatedEvents()) {
        return undefined as unknown as React.EventHandler<React.SyntheticEvent>;
      }
      const key = keyedRowIdentity(this.currentProps.rowKey(item, index));
      let handlers = this.eventHandlers.get(key);
      if (!handlers) {
        handlers = new Map();
        this.eventHandlers.set(key, handlers);
      }
      const existing = handlers.get(eventId);
      if (existing) return existing;
      const handler: React.EventHandler<React.SyntheticEvent> = (event) => {
        const instance = this.instances.get(key);
        const descriptor = this.currentProps.events?.[eventId];
        if (!instance || !descriptor) return;
        return descriptor.invoke(instance.item, instance.index, event);
      };
      handlers.set(eventId, handler);
      return handler;
    };

    private usesDelegatedEvents(props: CompilerKeyedRowsBlockProps = this.currentProps): boolean {
      return Boolean(
        props.delegateEvents &&
        props.events?.length &&
        props.events.every((event) => event.path !== undefined),
      );
    }

    private rebuildElementIndex(instances: ReadonlyMap<string, CompilerKeyedRowInstance>): void {
      this.instancesByElement = new WeakMap();
      for (const instance of instances.values()) {
        this.instancesByElement.set(instance.element, instance);
      }
    }

    private eventRowInstance(event: React.SyntheticEvent): CompilerKeyedRowInstance | undefined {
      if (!this.root) return undefined;
      const target = event.target as Node | null;
      if (!target) return undefined;
      let element =
        target.nodeType === 1 ? (target as Element) : (target.parentElement as Element | null);
      while (element && element.parentElement !== this.root) element = element.parentElement;
      return element?.parentElement === this.root
        ? this.instancesByElement.get(element)
        : undefined;
    }

    private invokeDelegatedEvent(
      descriptor: CompilerKeyedRowEvent,
      instance: CompilerKeyedRowInstance,
      event: React.SyntheticEvent,
      currentTarget: Element,
    ): void {
      const ownCurrentTarget = Object.getOwnPropertyDescriptor(event, "currentTarget");
      try {
        Object.defineProperty(event, "currentTarget", {
          configurable: true,
          value: currentTarget,
        });
        descriptor.invoke(instance.item, instance.index, event);
      } finally {
        if (ownCurrentTarget) Object.defineProperty(event, "currentTarget", ownCurrentTarget);
        else Reflect.deleteProperty(event, "currentTarget");
      }
    }

    private dispatchDelegatedEvent = (name: string, event: React.SyntheticEvent): void => {
      const instance = this.eventRowInstance(event);
      const eventTarget = event.target as Node | null;
      if (!instance || !eventTarget) return;
      const capture = name.endsWith("Capture");
      const matches = (this.currentProps.events || [])
        .filter((descriptor) => descriptor.name === name && descriptor.path !== undefined)
        .map((descriptor) => ({
          descriptor,
          target: findCompilerHostTarget(instance.element, descriptor.path || []),
        }))
        .filter((match): match is { descriptor: CompilerKeyedRowEvent; target: Element } =>
          Boolean(
            match.target && (match.target === eventTarget || match.target.contains(eventTarget)),
          ),
        )
        .sort((left, right) =>
          capture
            ? (left.descriptor.path?.length || 0) - (right.descriptor.path?.length || 0)
            : (right.descriptor.path?.length || 0) - (left.descriptor.path?.length || 0),
        );

      for (const match of matches) {
        this.invokeDelegatedEvent(match.descriptor, instance, event, match.target);
        if (event.isPropagationStopped()) break;
      }
    };

    private delegatedContainerProps(container: React.ReactElement): Record<string, unknown> {
      if (this.state.fallback || !this.usesDelegatedEvents()) return {};
      const props = container.props as Record<string, unknown>;
      return Object.fromEntries(
        [...new Set((this.currentProps.events || []).map((event) => event.name))].map((name) => {
          const existing = props[name] as React.EventHandler<React.SyntheticEvent> | undefined;
          const capture = name.endsWith("Capture");
          const handler: React.EventHandler<React.SyntheticEvent> = (event) => {
            if (capture) existing?.(event);
            if (!event.isPropagationStopped()) this.dispatchDelegatedEvent(name, event);
            if (!capture && !event.isPropagationStopped()) existing?.(event);
          };
          return [name, handler];
        }),
      );
    }

    private rowConditional = (
      item: unknown,
      index: number,
      conditionalId: number,
      render: (item: unknown, index: number) => React.ReactNode,
    ): React.ReactNode => {
      if (this.state.fallback) return render(item, index);
      const key = keyedRowIdentity(this.currentProps.rowKey(item, index));
      const Conditional = options.conditionals?.Component;
      if (!Conditional) return render(item, index);
      return React.createElement(Conditional, {
        key: `${key}:${conditionalId}`,
        owner: this.conditionalOwner,
        rowKey: key,
        id: conditionalId,
        renderVersion: this.renderVersion,
        item,
        index,
        render,
      });
    };

    private subscribeToRowConditional(
      key: string,
      id: number,
      refresh: RowConditionalRefresh,
    ): () => void {
      let listeners = this.conditionalListeners.get(key);
      if (!listeners) {
        listeners = new Map();
        this.conditionalListeners.set(key, listeners);
      }
      listeners.set(id, refresh);
      return () => {
        const current = this.conditionalListeners.get(key);
        if (current?.get(id) !== refresh) return;
        current.delete(id);
        if (current.size === 0) this.conditionalListeners.delete(key);
      };
    }

    private hasReactOwnedRows(props: CompilerKeyedRowsBlockProps = this.currentProps): boolean {
      return Boolean(
        props.conditionals?.length || (props.events?.length && !this.usesDelegatedEvents(props)),
      );
    }

    private cleanupHostScopes(
      instances: ReadonlyMap<string, CompilerKeyedRowInstance> = this.instances,
    ): void {
      for (const instance of instances.values()) instance.scope?.cleanup();
    }

    private mountRowHostScope(
      element: Element,
      descriptor: CompilerHostElement,
      props: CompilerKeyedRowsBlockProps = this.currentProps,
    ): CompilerHostTreeScope | null | undefined {
      if (!props.hostBlocks) return undefined;
      return options.hostBlocks?.mount(element, descriptor, this.requestHostScopeFallback) || null;
    }

    private readConditionalValues(
      props: CompilerKeyedRowsBlockProps,
      item: unknown,
      index: number,
    ): ReadonlyMap<number, readonly unknown[]> {
      return (
        options.conditionals?.readValues(props, item, index) || EMPTY_KEYED_ROW_CONDITIONAL_VALUES
      );
    }

    private pruneEventHandlers(keys: readonly string[]): void {
      const active = new Set(keys);
      for (const key of this.eventHandlers.keys()) {
        if (!active.has(key)) this.eventHandlers.delete(key);
      }
    }

    private pruneConditionalListeners(keys: readonly string[]): void {
      const active = new Set(keys);
      for (const key of this.conditionalListeners.keys()) {
        if (!active.has(key)) this.conditionalListeners.delete(key);
      }
    }

    private commitCurrentCollection(dirtyState?: ReadonlySet<number>): void {
      this.collectionToken = options.keyedMapUpdates?.commit(this.currentProps.items());
      this.commitKeyedTargets(dirtyState);
    }

    private hasSafeMembershipTargets(dirtyState?: ReadonlySet<number>): boolean {
      for (const binding of this.currentProps.bindings) {
        const target = binding.membershipTarget;
        if (!target || (dirtyState && !dirtyState.has(target.dependency))) continue;
        if (!keyedMembershipTargetSnapshot(target.read()).eligible) return false;
      }
      return true;
    }

    private hasSafeMapLookupTargets(dirtyState?: ReadonlySet<number>): boolean {
      for (const binding of this.currentProps.bindings) {
        const target = binding.mapLookupTarget;
        if (!target || (dirtyState && !dirtyState.has(target.dependency))) continue;
        if (!keyedMapLookupTargetSnapshot(target.read()).eligible) return false;
      }
      return true;
    }

    private commitKeyedTargets(dirtyState?: ReadonlySet<number>): void {
      if (!dirtyState) {
        this.identityTargets.clear();
        this.membershipTargets.clear();
        this.mapLookupTargets.clear();
      }
      for (
        let bindingIndex = 0;
        bindingIndex < this.currentProps.bindings.length;
        bindingIndex += 1
      ) {
        const binding = this.currentProps.bindings[bindingIndex];
        const identityTarget = binding.identityTarget;
        if (!identityTarget) {
          this.identityTargets.delete(bindingIndex);
        } else if (!dirtyState || dirtyState.has(identityTarget.dependency)) {
          this.identityTargets.set(
            bindingIndex,
            keyedIdentityTargetSnapshot(identityTarget.read()),
          );
        }

        const membershipTarget = binding.membershipTarget;
        if (!membershipTarget) {
          this.membershipTargets.delete(bindingIndex);
        } else if (!dirtyState || dirtyState.has(membershipTarget.dependency)) {
          this.membershipTargets.set(
            bindingIndex,
            keyedMembershipTargetSnapshot(membershipTarget.read()),
          );
        }

        const mapLookupTarget = binding.mapLookupTarget;
        if (!mapLookupTarget) {
          this.mapLookupTargets.delete(bindingIndex);
        } else if (!dirtyState || dirtyState.has(mapLookupTarget.dependency)) {
          this.mapLookupTargets.set(
            bindingIndex,
            keyedMapLookupTargetSnapshot(mapLookupTarget.read()),
          );
        }
      }
    }

    private adopt(): boolean {
      if (!this.root) return false;
      if (!this.hasSafeMembershipTargets() || !this.hasSafeMapLookupTargets()) return false;
      const rows = this.readRows(this.currentProps);
      const elements = [...this.root.children];
      if (!rows || rows.items.length !== elements.length) return false;
      const opaqueConditionalPaths = new Set(
        (this.currentProps.conditionals || []).map((conditional) => conditional.path.join(".")),
      );
      const instances = new Map<string, CompilerKeyedRowInstance>();
      for (let index = 0; index < rows.items.length; index += 1) {
        const descriptor = this.currentProps.create(rows.items[index], index);
        if (
          this.hasReactOwnedRows() &&
          !matchesCompilerHostElement(elements[index], descriptor, opaqueConditionalPaths)
        ) {
          this.cleanupHostScopes(instances);
          return false;
        }
        const scope = this.mountRowHostScope(elements[index], descriptor);
        if (this.currentProps.hostBlocks && !scope) {
          this.cleanupHostScopes(instances);
          return false;
        }
        const instance: CompilerKeyedRowInstance = {
          key: rows.keys[index],
          element: elements[index],
          scope: scope || undefined,
          values: this.hasReactOwnedRows()
            ? this.currentProps.bindings.map(() => UNSET_KEYED_ROW_BINDING)
            : readKeyedRowBindingValues(this.currentProps, rows.items[index], index),
          item: rows.items[index],
          index,
          conditionalValues: this.readConditionalValues(
            this.currentProps,
            rows.items[index],
            index,
          ),
        };
        if (this.hasReactOwnedRows()) {
          // React compares the next row against its previous virtual props, not
          // against DOM values patched by Farm between commits. Reapply every
          // binding after a structural React commit so both views converge
          // before direct same-key patches resume.
          applyKeyedRowBindings(this.currentProps, instance, rows.items[index], index);
        }
        instances.set(rows.keys[index], instance);
      }
      this.cleanupHostScopes();
      this.instances = instances;
      this.rebuildElementIndex(instances);
      this.pruneEventHandlers(rows.keys);
      this.pruneConditionalListeners(rows.keys);
      this.commitCurrentCollection();
      return true;
    }

    private hasUnsafeFallbackKeys(): boolean {
      try {
        return this.readRows(this.currentProps) === null;
      } catch {
        return true;
      }
    }

    private activateFallback(afterCommit?: () => void): void {
      if (!this.mounted || this.state.fallback || this.fallbackRequested) {
        afterCommit?.();
        return;
      }
      this.fallbackRequested = true;
      this.fallbackKeysWereUnsafe = this.hasUnsafeFallbackKeys();
      // One key change on entry: the compiled path mutated the DOM behind
      // React's back, so the first fallback render must rebuild the subtree.
      this.cleanupHostScopes();
      this.fallbackVersion += 1;
      this.setState({ fallback: true }, afterCommit);
    }

    private synchronizeReactOwnedRows(afterCommit?: () => void): void {
      this.forceUpdate(() => {
        if (!this.mounted) {
          afterCommit?.();
          return;
        }
        if (!this.adopt()) {
          this.activateFallback(afterCommit);
          return;
        }
        afterCommit?.();
      });
    }

    private notifyConditionalChanges(
      changes: readonly {
        key: string;
        id: number;
        item: unknown;
        index: number;
      }[],
      afterCommit?: () => void,
    ): void {
      if (changes.length === 0) {
        afterCommit?.();
        return;
      }
      let pending = changes.length;
      const committed = () => {
        pending -= 1;
        if (pending === 0) afterCommit?.();
      };
      // The normal row bindings above are patched synchronously. Flush the
      // React-owned conditional boundaries in the same turn as well so React
      // 18 cannot expose a transient row where text and branch disagree.
      flushSync(() => {
        for (const change of changes) {
          const refresh = this.conditionalListeners.get(change.key)?.get(change.id);
          if (refresh) refresh(change.item, change.index, committed);
          else committed();
        }
      });
    }

    private refreshDirtyBindings(
      dirtyState: ReadonlySet<number>,
      afterCommit?: () => void,
    ): boolean {
      if (
        !this.mounted ||
        !this.root ||
        this.state.fallback ||
        this.hasReactOwnedRows() ||
        this.currentProps.hostBlocks ||
        !this.currentProps.structureDependencies ||
        this.currentProps.structureDependencies.some((dependency) => dirtyState.has(dependency)) ||
        this.currentProps.bindings.some((binding) => binding.dependencies === undefined)
      ) {
        return false;
      }

      const affectedBindingIndices: number[] = [];
      for (
        let bindingIndex = 0;
        bindingIndex < this.currentProps.bindings.length;
        bindingIndex += 1
      ) {
        const dependencies = this.currentProps.bindings[bindingIndex].dependencies || [];
        if (dependencies.some((dependency) => dirtyState.has(dependency))) {
          affectedBindingIndices.push(bindingIndex);
        }
      }

      const nextIdentityTargets = new Map<number, CompilerKeyedIdentityTargetSnapshot>();
      const nextMembershipTargets = new Map<number, CompilerKeyedMembershipTargetSnapshot>();
      const nextMapLookupTargets = new Map<number, CompilerKeyedMapLookupTargetSnapshot>();
      for (const bindingIndex of affectedBindingIndices) {
        const binding = this.currentProps.bindings[bindingIndex];
        if (binding.identityTarget) {
          nextIdentityTargets.set(
            bindingIndex,
            keyedIdentityTargetSnapshot(binding.identityTarget.read()),
          );
        }
        if (binding.membershipTarget) {
          const snapshot = keyedMembershipTargetSnapshot(binding.membershipTarget.read());
          if (!snapshot.eligible) {
            this.activateFallback(afterCommit);
            return true;
          }
          nextMembershipTargets.set(bindingIndex, snapshot);
        }
        if (binding.mapLookupTarget) {
          const snapshot = keyedMapLookupTargetSnapshot(binding.mapLookupTarget.read());
          if (!snapshot.eligible) {
            this.activateFallback(afterCommit);
            return true;
          }
          nextMapLookupTargets.set(bindingIndex, snapshot);
        }
      }

      for (const bindingIndex of affectedBindingIndices) {
        const binding = this.currentProps.bindings[bindingIndex];
        const identityTarget = binding.identityTarget;
        const previousIdentityTarget = this.identityTargets.get(bindingIndex);
        const nextIdentityTarget = nextIdentityTargets.get(bindingIndex);
        const canTargetIdentity = Boolean(
          identityTarget &&
          binding.dependencies?.length === 1 &&
          binding.dependencies[0] === identityTarget.dependency &&
          dirtyState.has(identityTarget.dependency) &&
          previousIdentityTarget?.eligible &&
          nextIdentityTarget?.eligible,
        );
        const membershipTarget = binding.membershipTarget;
        const previousMembershipTarget = this.membershipTargets.get(bindingIndex);
        const nextMembershipTarget = nextMembershipTargets.get(bindingIndex);
        const canTargetMembership = Boolean(
          membershipTarget &&
          binding.dependencies?.length === 1 &&
          binding.dependencies[0] === membershipTarget.dependency &&
          dirtyState.has(membershipTarget.dependency) &&
          previousMembershipTarget?.eligible &&
          previousMembershipTarget.values &&
          nextMembershipTarget?.eligible &&
          nextMembershipTarget.values,
        );
        const mapLookupTarget = binding.mapLookupTarget;
        const previousMapLookupTarget = this.mapLookupTargets.get(bindingIndex);
        const nextMapLookupTarget = nextMapLookupTargets.get(bindingIndex);
        const canTargetMapLookup = Boolean(
          mapLookupTarget &&
          binding.dependencies?.length === 1 &&
          binding.dependencies[0] === mapLookupTarget.dependency &&
          dirtyState.has(mapLookupTarget.dependency) &&
          previousMapLookupTarget?.eligible &&
          previousMapLookupTarget.values &&
          nextMapLookupTarget?.eligible &&
          nextMapLookupTarget.values,
        );

        if (canTargetMapLookup && previousMapLookupTarget?.values && nextMapLookupTarget?.values) {
          const keys = keyedMapLookupChangedKeys(
            previousMapLookupTarget.values,
            nextMapLookupTarget.values,
          );
          for (const key of keys) {
            const instance = this.instances.get(key);
            if (instance) {
              applyKeyedRowBinding(
                this.currentProps,
                instance,
                instance.item,
                instance.index,
                bindingIndex,
              );
            }
          }
        } else if (
          canTargetMembership &&
          previousMembershipTarget?.values &&
          nextMembershipTarget?.values
        ) {
          const keys = keyedMembershipChangedKeys(
            previousMembershipTarget.values,
            nextMembershipTarget.values,
          );
          for (const key of keys) {
            const instance = this.instances.get(key);
            if (instance) {
              applyKeyedRowBinding(
                this.currentProps,
                instance,
                instance.item,
                instance.index,
                bindingIndex,
              );
            }
          }
        } else if (canTargetIdentity && previousIdentityTarget && nextIdentityTarget) {
          const keys = new Set<string>();
          if (previousIdentityTarget.key !== undefined) keys.add(previousIdentityTarget.key);
          if (nextIdentityTarget.key !== undefined) keys.add(nextIdentityTarget.key);
          for (const key of keys) {
            const instance = this.instances.get(key);
            if (instance) {
              applyKeyedRowBinding(
                this.currentProps,
                instance,
                instance.item,
                instance.index,
                bindingIndex,
              );
            }
          }
        } else {
          for (const instance of this.instances.values()) {
            applyKeyedRowBinding(
              this.currentProps,
              instance,
              instance.item,
              instance.index,
              bindingIndex,
            );
          }
        }

        if (nextIdentityTarget) this.identityTargets.set(bindingIndex, nextIdentityTarget);
        else this.identityTargets.delete(bindingIndex);
        if (nextMembershipTarget) {
          this.membershipTargets.set(bindingIndex, nextMembershipTarget);
        } else {
          this.membershipTargets.delete(bindingIndex);
        }
        if (nextMapLookupTarget) {
          this.mapLookupTargets.set(bindingIndex, nextMapLookupTarget);
        } else {
          this.mapLookupTargets.delete(bindingIndex);
        }
      }
      afterCommit?.();
      return true;
    }

    private reconcileStableRows(
      rows: { items: unknown[]; keys: string[] },
      afterCommit?: () => void,
      dirtyState?: ReadonlySet<number>,
    ): boolean {
      if (rows.keys.length !== this.instances.size) return false;
      let index = 0;
      for (const key of this.instances.keys()) {
        if (rows.keys[index] !== key) return false;
        index += 1;
      }

      const conditionalChanges: Array<{
        key: string;
        id: number;
        item: unknown;
        index: number;
      }> = [];
      for (index = 0; index < rows.items.length; index += 1) {
        const key = rows.keys[index];
        const existing = this.instances.get(key);
        if (!existing) return false;
        if (this.currentProps.hostBlocks) {
          const descriptor = this.currentProps.create(rows.items[index], index);
          if (!existing.scope?.update(descriptor)) {
            this.activateFallback(afterCommit);
            return true;
          }
        }
        applyKeyedRowBindings(this.currentProps, existing, rows.items[index], index);
        const conditionalValues = this.readConditionalValues(
          this.currentProps,
          rows.items[index],
          index,
        );
        for (const [id, values] of conditionalValues) {
          if (options.conditionals?.changed(existing.conditionalValues.get(id), values)) {
            conditionalChanges.push({ key, id, item: rows.items[index], index });
          }
        }
        existing.conditionalValues = conditionalValues;
        existing.item = rows.items[index];
        existing.index = index;
      }
      this.commitCurrentCollection(dirtyState);
      this.notifyConditionalChanges(conditionalChanges, afterCommit);
      return true;
    }

    private reconcileSingleRemoval(
      rows: { items: unknown[]; keys: string[] },
      afterCommit?: () => void,
      dirtyState?: ReadonlySet<number>,
    ): boolean {
      if (this.hasReactOwnedRows() || rows.keys.length + 1 !== this.instances.size) return false;
      const previousKeys = [...this.instances.keys()];
      let removedIndex = 0;
      while (
        removedIndex < rows.keys.length &&
        previousKeys[removedIndex] === rows.keys[removedIndex]
      ) {
        removedIndex += 1;
      }
      for (let index = removedIndex; index < rows.keys.length; index += 1) {
        if (previousKeys[index + 1] !== rows.keys[index]) return false;
      }

      const removedKey = previousKeys[removedIndex];
      const removed = this.instances.get(removedKey);
      if (!removed) return false;
      const conditionalChanges: Array<{
        key: string;
        id: number;
        item: unknown;
        index: number;
      }> = [];
      for (let index = 0; index < rows.items.length; index += 1) {
        const key = rows.keys[index];
        const existing = this.instances.get(key);
        if (!existing) return false;
        if (this.currentProps.hostBlocks) {
          const descriptor = this.currentProps.create(rows.items[index], index);
          if (!existing.scope?.update(descriptor)) {
            this.activateFallback(afterCommit);
            return true;
          }
        }
        applyKeyedRowBindings(this.currentProps, existing, rows.items[index], index);
        const conditionalValues = this.readConditionalValues(
          this.currentProps,
          rows.items[index],
          index,
        );
        for (const [id, values] of conditionalValues) {
          if (options.conditionals?.changed(existing.conditionalValues.get(id), values)) {
            conditionalChanges.push({ key, id, item: rows.items[index], index });
          }
        }
        existing.conditionalValues = conditionalValues;
        existing.item = rows.items[index];
        existing.index = index;
      }

      removed.scope?.cleanup();
      removed.element.remove();
      this.instances.delete(removedKey);
      this.eventHandlers.delete(removedKey);
      this.conditionalListeners.delete(removedKey);
      this.commitCurrentCollection(dirtyState);
      this.notifyConditionalChanges(conditionalChanges, afterCommit);
      return true;
    }

    private reconcile(afterCommit?: () => void, dirtyState?: ReadonlySet<number>): void {
      if (!this.mounted || !this.root) {
        afterCommit?.();
        return;
      }
      if (this.state.fallback) {
        // React owns the container while in fallback; keep the key stable so
        // updates reconcile in place instead of remounting the subtree (which
        // would wipe uncontrolled inputs, focus, and scroll). The exception
        // is duplicate runtime keys: React's reconciliation of a keyed list
        // with duplicates is unreliable, so any render touched by them (this
        // one, or the previously committed one) still remounts.
        const unsafeKeys = this.hasUnsafeFallbackKeys();
        if (unsafeKeys || this.fallbackKeysWereUnsafe) {
          this.fallbackVersion += 1;
        }
        this.fallbackKeysWereUnsafe = unsafeKeys;
        this.forceUpdate(afterCommit);
        return;
      }

      if (!this.hasSafeMembershipTargets(dirtyState)) {
        this.activateFallback(afterCommit);
        return;
      }

      if (!this.hasSafeMapLookupTargets(dirtyState)) {
        this.activateFallback(afterCommit);
        return;
      }

      const rows = this.readRows(this.currentProps);
      if (!rows) {
        this.activateFallback(afterCommit);
        return;
      }

      if (this.hasReactOwnedRows()) {
        const previousKeys = [...this.instances.keys()];
        if (
          rows.keys.length !== previousKeys.length ||
          rows.keys.some((key, index) => key !== previousKeys[index])
        ) {
          this.synchronizeReactOwnedRows(afterCommit);
          return;
        }
      }

      if (rows.items.length === 0) {
        this.cleanupHostScopes();
        this.root.replaceChildren();
        this.instances = new Map();
        this.instancesByElement = new WeakMap();
        this.eventHandlers.clear();
        this.conditionalListeners.clear();
        this.commitCurrentCollection(dirtyState);
        afterCommit?.();
        return;
      }

      if (this.reconcileStableRows(rows, afterCommit, dirtyState)) return;
      if (this.reconcileSingleRemoval(rows, afterCommit, dirtyState)) return;

      const activeElement = this.root.ownerDocument.activeElement;
      const restoreFocus = Boolean(activeElement && this.root.contains(activeElement));
      const nextKeys = new Set(rows.keys);
      const hasSurvivingRows = rows.keys.some((key) => this.instances.has(key));
      const oldIndices = new Map<string, number>();
      if (hasSurvivingRows) {
        [...this.instances].forEach(([key], index) => oldIndices.set(key, index));
      }
      for (const [key, instance] of this.instances) {
        if (!nextKeys.has(key)) {
          instance.scope?.cleanup();
          if (hasSurvivingRows) instance.element.remove();
        }
      }

      const sequence = hasSurvivingRows
        ? rows.keys.map((key) => oldIndices.get(key) ?? -1)
        : rows.keys.map(() => -1);
      const stablePositions = hasSurvivingRows
        ? longestIncreasingSubsequencePositions(sequence)
        : new Set<number>();
      const nextInstances: CompilerKeyedRowInstance[] = [];
      const conditionalChanges: Array<{
        key: string;
        id: number;
        item: unknown;
        index: number;
      }> = [];
      for (let index = 0; index < rows.items.length; index += 1) {
        const key = rows.keys[index];
        const existing = this.instances.get(key);
        if (existing) {
          if (this.currentProps.hostBlocks) {
            const descriptor = this.currentProps.create(rows.items[index], index);
            if (!existing.scope?.update(descriptor)) {
              this.activateFallback(afterCommit);
              return;
            }
          }
          applyKeyedRowBindings(this.currentProps, existing, rows.items[index], index);
          const conditionalValues = this.readConditionalValues(
            this.currentProps,
            rows.items[index],
            index,
          );
          for (const [id, values] of conditionalValues) {
            if (options.conditionals?.changed(existing.conditionalValues.get(id), values)) {
              conditionalChanges.push({ key, id, item: rows.items[index], index });
            }
          }
          existing.conditionalValues = conditionalValues;
          existing.item = rows.items[index];
          existing.index = index;
          nextInstances.push(existing);
          continue;
        }
        const descriptor = this.currentProps.create(rows.items[index], index);
        const element = createCompilerHostElement(this.root.ownerDocument, descriptor);
        const scope = this.mountRowHostScope(element, descriptor);
        if (this.currentProps.hostBlocks && !scope) {
          for (const instance of nextInstances) {
            if (!this.instances.has(instance.key)) instance.scope?.cleanup();
          }
          this.activateFallback(afterCommit);
          return;
        }
        nextInstances.push({
          key,
          element,
          scope: scope || undefined,
          values: readKeyedRowBindingValues(this.currentProps, rows.items[index], index),
          item: rows.items[index],
          index,
          conditionalValues: this.readConditionalValues(
            this.currentProps,
            rows.items[index],
            index,
          ),
        });
      }

      if (!hasSurvivingRows) {
        const fragment = this.root.ownerDocument.createDocumentFragment();
        for (const instance of nextInstances) fragment.append(instance.element);
        this.root.replaceChildren(fragment);
      } else {
        let anchor: ChildNode | null = null;
        for (let index = nextInstances.length - 1; index >= 0; index -= 1) {
          const instance = nextInstances[index];
          if (sequence[index] < 0) {
            let start = index;
            while (start > 0 && sequence[start - 1] < 0) start -= 1;
            const fragment = this.root.ownerDocument.createDocumentFragment();
            for (let itemIndex = start; itemIndex <= index; itemIndex += 1) {
              fragment.append(nextInstances[itemIndex].element);
            }
            this.root.insertBefore(fragment, anchor);
            anchor = nextInstances[start].element;
            index = start;
          } else {
            if (!stablePositions.has(index) && instance.element.nextSibling !== anchor) {
              this.root.insertBefore(instance.element, anchor);
            }
            anchor = instance.element;
          }
        }
      }
      this.instances = new Map(nextInstances.map((instance) => [instance.key, instance]));
      this.rebuildElementIndex(this.instances);
      this.pruneEventHandlers(rows.keys);
      this.pruneConditionalListeners(rows.keys);
      if (
        restoreFocus &&
        activeElement?.isConnected &&
        activeElement.ownerDocument.activeElement !== activeElement &&
        "focus" in activeElement
      ) {
        (activeElement as HTMLElement).focus({ preventScroll: true });
      }
      this.commitCurrentCollection(dirtyState);
      this.notifyConditionalChanges(conditionalChanges, afterCommit);
    }

    private refresh: CompilerBlockRefresh = (afterCommit, dirtyState) => {
      if (
        dirtyState &&
        options.keyedMapUpdates &&
        this.mounted &&
        this.root &&
        !this.state.fallback
      ) {
        const result = options.keyedMapUpdates.reconcile(
          this.currentProps,
          dirtyState,
          this.collectionToken,
          this.instances,
          options.conditionals,
        );
        if (result) {
          if (result.fallback) this.activateFallback(afterCommit);
          else {
            this.collectionToken = result.collectionToken;
            this.notifyConditionalChanges(result.conditionalChanges, afterCommit);
          }
          return;
        }
      }
      if (dirtyState && this.refreshDirtyBindings(dirtyState, afterCommit)) return;
      this.reconcile(afterCommit, dirtyState);
    };

    private schedulePropSync(): void {
      if (this.propSyncQueued) return;
      this.propSyncQueued = true;
      queueMicrotask(() => {
        this.propSyncQueued = false;
        if (this.mounted && !this.state.fallback) this.reconcile();
      });
    }

    shouldComponentUpdate(nextProps: CompilerKeyedRowsBlockProps, nextState: State): boolean {
      const wasReactOwned = this.hasReactOwnedRows(this.currentProps);
      const willBeReactOwned = this.hasReactOwnedRows(nextProps);
      this.currentProps = nextProps;
      if (nextState.fallback || this.state.fallback) return true;
      if (wasReactOwned || willBeReactOwned) {
        // Parent prop updates and Fast Refresh definitions must pass through
        // React so event locations, static row markup, and proxy identities
        // cannot remain tied to an older render definition.
        this.eventHandlers.clear();
        return true;
      }
      this.schedulePropSync();
      return false;
    }

    componentDidUpdate(previousProps: CompilerKeyedRowsBlockProps): void {
      if (
        this.state.fallback ||
        previousProps === this.props ||
        (!this.hasReactOwnedRows(previousProps) && !this.hasReactOwnedRows(this.props)) ||
        this.adopt()
      ) {
        return;
      }
      this.activateFallback();
    }

    componentDidMount(): void {
      this.mounted = true;
      this.unsubscribe = owner.subscribe(this.props.id, this.refresh);
      if (!this.adopt()) this.activateFallback();
    }

    componentWillUnmount(): void {
      this.mounted = false;
      this.unsubscribe?.();
      this.root = null;
      this.cleanupHostScopes();
      this.instances.clear();
      this.identityTargets.clear();
      this.membershipTargets.clear();
      this.mapLookupTargets.clear();
      this.instancesByElement = new WeakMap();
      this.eventHandlers.clear();
      this.conditionalListeners.clear();
    }

    render(): React.ReactNode {
      this.renderVersion += 1;
      const container = this.currentProps.render(this.rowEvent, this.rowConditional);
      if (!React.isValidElement(container) || typeof container.type !== "string") {
        throw new TypeError(
          `Compiled keyed rows ${this.currentProps.id} must own one host container.`,
        );
      }
      return React.cloneElement(container, {
        ...this.delegatedContainerProps(container),
        key: this.state.fallback ? `react-${this.fallbackVersion}` : "compiled",
        ref: this.captureRoot,
      } as React.Attributes);
    }
  }

  return FarmKeyedRowsBlock;
}

function createKeyedRangesBlockComponent(
  owner: Pick<ConditionalBlockOwner, "subscribe">,
): React.ComponentType<CompilerKeyedRangesBlockProps> {
  interface State {
    fallback: boolean;
  }

  interface ReadRange {
    items: unknown[];
    keys: string[];
  }

  class FarmKeyedRangesBlock extends React.Component<CompilerKeyedRangesBlockProps, State> {
    static displayName = "FarmCompiledKeyedRanges";

    state: State = { fallback: false };
    private root: Element | null = null;
    private mounted = false;
    private fallbackRequested = false;
    private fallbackVersion = 0;
    private propFallbackQueued = false;
    private currentProps = this.props;
    private unsubscribe: (() => void) | undefined;
    private rangeInstances: Array<Map<string, CompilerKeyedRowInstance>> = [];
    private staticSegments: Element[][] = [];
    private readonly staticValues: unknown[] = [];

    private captureRoot = (root: Element | null) => {
      this.root = root;
      this.currentProps.rootRef?.(root);
    };

    private readRange(range: CompilerKeyedRange): ReadRange | null {
      const items = materializeIterable(range.items());
      const keys = items.map((item, index) => keyedRowIdentity(range.rowKey(item, index)));
      if (new Set(keys).size !== keys.length) return null;
      return { items, keys };
    }

    private readRanges(props: CompilerKeyedRangesBlockProps): ReadRange[] | null {
      const ranges: ReadRange[] = [];
      for (const range of props.ranges) {
        const rows = this.readRange(range);
        if (!rows) return null;
        ranges.push(rows);
      }
      return ranges;
    }

    private adopt(props: CompilerKeyedRangesBlockProps = this.currentProps): boolean {
      if (!this.root || !Number.isSafeInteger(props.trailing) || props.trailing < 0) return false;
      const rowsByRange = this.readRanges(props);
      if (!rowsByRange) return false;
      const elements = [...this.root.children];
      const staticSegments: Element[][] = [];
      const instancesByRange: Array<Map<string, CompilerKeyedRowInstance>> = [];
      let cursor = 0;

      for (let rangeIndex = 0; rangeIndex < props.ranges.length; rangeIndex += 1) {
        const range = props.ranges[rangeIndex];
        const rows = rowsByRange[rangeIndex];
        if (!Number.isSafeInteger(range.before) || range.before < 0) return false;
        const staticEnd = cursor + range.before;
        if (staticEnd > elements.length) return false;
        staticSegments.push(elements.slice(cursor, staticEnd));
        cursor = staticEnd;

        const rowEnd = cursor + rows.items.length;
        if (rowEnd > elements.length) return false;
        const instances = new Map<string, CompilerKeyedRowInstance>();
        for (let index = 0; index < rows.items.length; index += 1) {
          const element = elements[cursor + index];
          if (!matchesCompilerHostElement(element, range.create(rows.items[index], index))) {
            return false;
          }
          instances.set(rows.keys[index], {
            key: rows.keys[index],
            element,
            values: readKeyedRowBindingValues(range, rows.items[index], index),
            item: rows.items[index],
            index,
            conditionalValues: new Map(),
          });
        }
        instancesByRange.push(instances);
        cursor = rowEnd;
      }

      if (cursor + props.trailing !== elements.length) return false;
      staticSegments.push(elements.slice(cursor));
      this.staticSegments = staticSegments;
      this.rangeInstances = instancesByRange;
      if (!applyStaticRangeBindings(props.bindings, this.staticSegments, this.staticValues)) {
        this.rangeInstances = [];
        this.staticSegments = [];
        return false;
      }
      return true;
    }

    private anchorAfter(rangeIndex: number): ChildNode | null {
      for (let next = rangeIndex + 1; next < this.rangeInstances.length; next += 1) {
        const staticAnchor = this.staticSegments[next]?.[0];
        if (staticAnchor) return staticAnchor;
        const rowAnchor = this.rangeInstances[next].values().next().value?.element;
        if (rowAnchor) return rowAnchor;
      }
      return this.staticSegments[this.rangeInstances.length]?.[0] || null;
    }

    private reconcileRange(rangeIndex: number, rows: ReadRange): void {
      if (!this.root) return;
      const range = this.currentProps.ranges[rangeIndex];
      const previous = this.rangeInstances[rangeIndex];
      const oldIndices = new Map<string, number>();
      [...previous.keys()].forEach((key, index) => oldIndices.set(key, index));
      const nextKeys = new Set(rows.keys);
      for (const [key, instance] of previous) {
        if (!nextKeys.has(key)) instance.element.remove();
      }

      const sequence = rows.keys.map((key) => oldIndices.get(key) ?? -1);
      const stablePositions = longestIncreasingSubsequencePositions(sequence);
      const nextInstances: CompilerKeyedRowInstance[] = [];
      for (let index = 0; index < rows.items.length; index += 1) {
        const key = rows.keys[index];
        const existing = previous.get(key);
        if (existing) {
          applyKeyedRowBindings(range, existing, rows.items[index], index);
          existing.item = rows.items[index];
          existing.index = index;
          nextInstances.push(existing);
          continue;
        }
        const element = createCompilerHostElement(
          this.root.ownerDocument,
          range.create(rows.items[index], index),
        );
        nextInstances.push({
          key,
          element,
          values: readKeyedRowBindingValues(range, rows.items[index], index),
          item: rows.items[index],
          index,
          conditionalValues: new Map(),
        });
      }

      let anchor = this.anchorAfter(rangeIndex);
      for (let index = nextInstances.length - 1; index >= 0; index -= 1) {
        const instance = nextInstances[index];
        if (sequence[index] < 0) {
          this.root.insertBefore(instance.element, anchor);
        } else if (!stablePositions.has(index) && instance.element.nextSibling !== anchor) {
          this.root.insertBefore(instance.element, anchor);
        }
        anchor = instance.element;
      }
      this.rangeInstances[rangeIndex] = new Map(
        nextInstances.map((instance) => [instance.key, instance]),
      );
    }

    private reconcile(afterCommit?: () => void): void {
      if (!this.mounted || !this.root) {
        afterCommit?.();
        return;
      }
      if (this.state.fallback) {
        this.fallbackVersion += 1;
        this.forceUpdate(afterCommit);
        return;
      }
      const rowsByRange = this.readRanges(this.currentProps);
      if (!rowsByRange || rowsByRange.length !== this.rangeInstances.length) {
        this.activateFallback(afterCommit);
        return;
      }
      if (
        !applyStaticRangeBindings(
          this.currentProps.bindings,
          this.staticSegments,
          this.staticValues,
        )
      ) {
        this.activateFallback(afterCommit);
        return;
      }

      const activeElement = this.root.ownerDocument.activeElement;
      const restoreFocus = Boolean(activeElement && this.root.contains(activeElement));
      for (let rangeIndex = rowsByRange.length - 1; rangeIndex >= 0; rangeIndex -= 1) {
        this.reconcileRange(rangeIndex, rowsByRange[rangeIndex]);
      }
      if (
        restoreFocus &&
        activeElement?.isConnected &&
        activeElement.ownerDocument.activeElement !== activeElement &&
        "focus" in activeElement
      ) {
        (activeElement as HTMLElement).focus({ preventScroll: true });
      }
      afterCommit?.();
    }

    private refresh = (afterCommit?: () => void) => {
      this.reconcile(afterCommit);
    };

    private activateFallback(afterCommit?: () => void): void {
      if (!this.mounted || this.state.fallback || this.fallbackRequested) {
        afterCommit?.();
        return;
      }
      this.fallbackRequested = true;
      this.setState({ fallback: true }, afterCommit);
    }

    private schedulePropFallback(): void {
      if (this.propFallbackQueued) return;
      this.propFallbackQueued = true;
      queueMicrotask(() => {
        this.propFallbackQueued = false;
        if (this.mounted && !this.state.fallback) this.activateFallback();
      });
    }

    shouldComponentUpdate(nextProps: CompilerKeyedRangesBlockProps, nextState: State): boolean {
      this.currentProps = nextProps;
      if (nextState.fallback || this.state.fallback) return true;
      // Parent props and compatible Fast Refresh definitions can change static
      // siblings that are deliberately outside the range descriptors. Remount
      // this one container through React instead of retaining stale markup.
      this.schedulePropFallback();
      return false;
    }

    componentDidMount(): void {
      this.mounted = true;
      this.unsubscribe = owner.subscribe(this.props.id, this.refresh);
      if (!this.adopt()) this.activateFallback();
    }

    componentWillUnmount(): void {
      this.mounted = false;
      this.unsubscribe?.();
      this.root = null;
      this.rangeInstances = [];
      this.staticSegments = [];
      this.staticValues.length = 0;
    }

    render(): React.ReactNode {
      const container = this.currentProps.render();
      if (!React.isValidElement(container) || typeof container.type !== "string") {
        throw new TypeError(
          `Compiled keyed ranges ${this.currentProps.id} must own one host container.`,
        );
      }
      return React.cloneElement(container, {
        key: this.state.fallback ? `react-${this.fallbackVersion}` : "compiled",
        ref: this.captureRoot,
      } as React.Attributes);
    }
  }

  return FarmKeyedRangesBlock;
}

function createMixedRangesBlockComponent(
  owner: Pick<ConditionalBlockOwner, "subscribe">,
): React.ComponentType<CompilerMixedRangesBlockProps> {
  interface State {
    fallback: boolean;
  }

  class FarmMixedRangesBlock extends React.Component<CompilerMixedRangesBlockProps, State> {
    static displayName = "FarmCompiledMixedRanges";

    state: State = { fallback: false };
    private root: Element | null = null;
    private mounted = false;
    private fallbackRequested = false;
    private fallbackVersion = 0;
    private propFallbackQueued = false;
    private currentProps = this.props;
    private controller: CompilerNestedMixedRanges | null = null;
    private fallbackUnsubscribers: Array<() => void> = [];

    private captureRoot = (root: Element | null) => {
      this.root = root;
      this.currentProps.rootRef?.(root);
    };

    private clearFallbackSubscriptions(): void {
      for (const unsubscribe of this.fallbackUnsubscribers) unsubscribe();
      this.fallbackUnsubscribers = [];
    }

    private subscribeFallbackBlocks(): void {
      this.clearFallbackSubscriptions();
      const descriptor = this.currentProps.create();
      const ids = new Set<number>();
      collectCompilerHostBlockIds(descriptor, ids);
      for (const id of ids) {
        this.fallbackUnsubscribers.push(
          owner.subscribe(id, (afterCommit) => {
            if (!this.mounted || !this.state.fallback) {
              afterCommit?.();
              return;
            }
            this.fallbackVersion += 1;
            this.forceUpdate(afterCommit);
          }),
        );
      }
    }

    private adopt(): boolean {
      if (!this.root) return false;
      const descriptor = this.currentProps.create();
      const block = descriptor.block;
      if (block?.kind !== "mixed-ranges" || block.id !== this.currentProps.id) return false;
      const controller = new CompilerNestedMixedRanges(
        owner,
        this.root,
        descriptor,
        block,
        this.activateFallback,
      );
      try {
        if (!controller.adopt()) {
          controller.cleanup();
          return false;
        }
      } catch (error) {
        controller.cleanup();
        throw error;
      }
      this.controller = controller;
      return true;
    }

    private activateFallback = (afterCommit?: () => void): void => {
      if (!this.mounted || this.state.fallback || this.fallbackRequested) {
        afterCommit?.();
        return;
      }
      this.fallbackRequested = true;
      this.controller?.cleanup();
      this.controller = null;
      this.fallbackVersion += 1;
      this.setState({ fallback: true }, () => {
        this.subscribeFallbackBlocks();
        afterCommit?.();
      });
    };

    private schedulePropFallback(): void {
      if (this.propFallbackQueued) return;
      this.propFallbackQueued = true;
      queueMicrotask(() => {
        this.propFallbackQueued = false;
        if (this.mounted && !this.state.fallback) this.activateFallback();
      });
    }

    shouldComponentUpdate(nextProps: CompilerMixedRangesBlockProps, nextState: State): boolean {
      this.currentProps = nextProps;
      if (nextState.fallback || this.state.fallback) return true;
      this.schedulePropFallback();
      return false;
    }

    componentDidMount(): void {
      this.mounted = true;
      if (!this.adopt()) this.activateFallback();
    }

    componentDidUpdate(): void {
      if (this.state.fallback) this.subscribeFallbackBlocks();
    }

    componentWillUnmount(): void {
      this.mounted = false;
      this.controller?.cleanup();
      this.controller = null;
      this.clearFallbackSubscriptions();
      this.root = null;
    }

    render(): React.ReactNode {
      const container = this.currentProps.render();
      if (!React.isValidElement(container) || typeof container.type !== "string") {
        throw new TypeError(
          `Compiled mixed ranges ${this.currentProps.id} must own one host container.`,
        );
      }
      return React.cloneElement(container, {
        key: this.state.fallback ? `react-${this.fallbackVersion}` : "compiled",
        ref: this.captureRoot,
      } as React.Attributes);
    }
  }

  return FarmMixedRangesBlock;
}

function createComponentBlockComponent(
  owner: Pick<ConditionalBlockOwner, "subscribe">,
): React.ComponentType<CompilerComponentBlockProps> {
  class FarmComponentBlock extends React.Component<CompilerComponentBlockProps> {
    static displayName = "FarmCompiledComponentIsland";

    private unsubscribe: (() => void) | undefined;

    private refresh = (afterCommit?: () => void) => {
      this.forceUpdate(afterCommit);
    };

    private subscribe(): void {
      this.unsubscribe = owner.subscribe(this.props.id, this.refresh);
    }

    componentDidMount(): void {
      this.subscribe();
    }

    componentDidUpdate(previous: CompilerComponentBlockProps): void {
      if (previous.id === this.props.id) return;
      this.unsubscribe?.();
      this.subscribe();
    }

    componentWillUnmount(): void {
      this.unsubscribe?.();
    }

    render(): React.ReactNode {
      return this.props.render();
    }
  }

  return FarmComponentBlock;
}

export const conditionalRuntimeFeature: CompilerRuntimeFeature = {
  name: "conditional",
  create: (owner) => ({
    Conditional: createConditionalBlockComponent(owner),
  }),
};

export const hostConditionalRuntimeFeature: CompilerRuntimeFeature = {
  name: "host-conditional",
  create: (owner) => ({
    HostConditional: createHostConditionalBlockComponent(owner),
  }),
};

export const conditionalRangesRuntimeFeature: CompilerRuntimeFeature = {
  name: "conditional-ranges",
  create: (owner) => ({
    ConditionalRanges: createConditionalRangesBlockComponent(owner),
  }),
};

export const keyedListRuntimeFeature: CompilerRuntimeFeature = {
  name: "keyed-list",
  create: (owner) => ({
    KeyedList: createKeyedListBlockComponent(owner),
  }),
};

export const keyedRowsRuntimeFeature: CompilerRuntimeFeature = {
  name: "keyed-rows",
  create: (owner) => ({
    KeyedRows: createKeyedRowsBlockComponent(owner),
  }),
};

export const keyedRowsHintedRuntimeFeature: CompilerRuntimeFeature = {
  name: "keyed-rows:hinted",
  create: (owner) => ({
    KeyedRows: createKeyedRowsBlockComponent(owner, { keyedMapUpdates: keyedMapUpdateRuntime }),
  }),
};

export const keyedRowsConditionalRuntimeFeature: CompilerRuntimeFeature = {
  name: "keyed-rows:conditional",
  create: (owner) => ({
    KeyedRows: createKeyedRowsBlockComponent(owner, {
      conditionals: createKeyedRowConditionalRuntime(),
    }),
  }),
};

export const keyedRowsConditionalHintedRuntimeFeature: CompilerRuntimeFeature = {
  name: "keyed-rows:conditional:hinted",
  create: (owner) => ({
    KeyedRows: createKeyedRowsBlockComponent(owner, {
      conditionals: createKeyedRowConditionalRuntime(),
      keyedMapUpdates: keyedMapUpdateRuntime,
    }),
  }),
};

export const keyedRowsHostRuntimeFeature: CompilerRuntimeFeature = {
  name: "keyed-rows:host",
  create: (owner) => ({
    KeyedRows: createKeyedRowsBlockComponent(owner, {
      hostBlocks: createKeyedRowHostRuntime(),
    }),
  }),
};

export const keyedRowsHostHintedRuntimeFeature: CompilerRuntimeFeature = {
  name: "keyed-rows:host:hinted",
  create: (owner) => ({
    KeyedRows: createKeyedRowsBlockComponent(owner, {
      hostBlocks: createKeyedRowHostRuntime(),
      keyedMapUpdates: keyedMapUpdateRuntime,
    }),
  }),
};

export const keyedRowsCompleteRuntimeFeature: CompilerRuntimeFeature = {
  name: "keyed-rows:complete",
  create: (owner) => ({
    KeyedRows: createKeyedRowsBlockComponent(owner, {
      conditionals: createKeyedRowConditionalRuntime(),
      hostBlocks: createKeyedRowHostRuntime(),
    }),
  }),
};

export const keyedRowsCompleteHintedRuntimeFeature: CompilerRuntimeFeature = {
  name: "keyed-rows:complete:hinted",
  create: (owner) => ({
    KeyedRows: createKeyedRowsBlockComponent(owner, {
      conditionals: createKeyedRowConditionalRuntime(),
      hostBlocks: createKeyedRowHostRuntime(),
      keyedMapUpdates: keyedMapUpdateRuntime,
    }),
  }),
};

export const keyedRangesRuntimeFeature: CompilerRuntimeFeature = {
  name: "keyed-ranges",
  create: (owner) => ({
    KeyedRanges: createKeyedRangesBlockComponent(owner),
  }),
};

export const mixedRangesRuntimeFeature: CompilerRuntimeFeature = {
  name: "mixed-ranges",
  create: (owner) => ({
    MixedRanges: createMixedRangesBlockComponent(owner),
  }),
};

export const componentRuntimeFeature: CompilerRuntimeFeature = {
  name: "component",
  create: (owner) => ({
    Component: createComponentBlockComponent(owner),
  }),
};

/**
 * Tree-shakable runtime target emitted by the AOT transform.
 *
 * React owns initial placement, SSR, hydration, props, and event semantics.
 * Compiler cells own local updates and precomputed DOM paths. Structural
 * helpers are installed only when the compiler emitted that boundary kind.
 */
export function createCompiledComponentWithFeatures<Props>(
  definition: CompiledComponentDefinition<Props>,
  runtimeFeatures: readonly CompilerRuntimeFeature[],
): React.ComponentType<Props> {
  const stateSignature = definition.stateSignature || String(definition.initialize.length);
  const runtimeSignature = [...new Set(runtimeFeatures.map((feature) => feature.name))]
    .sort()
    .join(",");
  if (definition.hmrId) {
    const registry = getCompilerHmrRegistry();
    const existing = registry.get(definition.hmrId);
    if (
      existing?.stateSignature === stateSignature &&
      existing.runtimeSignature === runtimeSignature
    ) {
      existing.definition.current = definition as CompiledComponentDefinition<unknown>;
      existing.component.displayName = `FarmCompiled(${definition.displayName})`;
      for (const refresh of existing.refreshListeners) refresh();
      return existing.component as React.ComponentType<Props>;
    }
  }

  const definitionReference: CompiledDefinitionReference<Props> = { current: definition };
  const refreshListeners = new Set<() => void>();

  class FarmCompiledComponent extends React.Component<Props, Record<string, never>, boolean> {
    private root: Element | null = null;
    private mounted = false;
    private flushQueued = false;
    private bindingError: unknown;
    private hasBindingError = false;
    private inputSelection: InputSelectionSnapshot | null = null;
    private readonly dirtyState = new Set<number>();
    private indexedDefinition: CompiledComponentDefinition<Props> | null = null;
    private staticBindingsByDependency: CompilerBinding<Props>[][] = [];
    private blockBindingsByDependency: CompilerConditionalBlockBinding[][] = [];
    private readonly blockBindings = new Map<number, CompilerConditionalBlockBinding>();
    private trackedBindingsByDependency: Set<CompilerBinding<Props>>[] = [];
    private readonly trackedDependenciesByBinding = new Map<CompilerBinding<Props>, Set<number>>();
    private readonly bindingValues = new Map<CompilerBinding<Props>, unknown>();
    private activeBinding: CompilerBinding<Props> | null = null;
    private activeDependencies: Set<number> | null = null;
    private readonly cells: RuntimeCell[];
    private readonly propCellOffset: number;
    private renderedDefinition: CompiledComponentDefinition<Props> | null = null;
    private renderedElement: React.ReactElement | null = null;
    private readonly blockRefreshListeners = new Map<number, CompilerBlockRefresh>();
    private readonly blockRoots = new Map<number, Element>();
    private readonly blockRootElements = new Set<Element>();
    private readonly bindingTargets = new Map<number, Element>();
    private readonly bindingTargetRefs = new Map<number, React.RefCallback<Element>>();
    private readonly blockRuntime: CompilerBlockRuntime;

    constructor(props: Props) {
      super(props);
      const initialState = definitionReference.current.initialize(props);
      const initialProps = definitionReference.current.readProps?.(props) || [];
      this.propCellOffset = initialState.length;
      this.cells = [...initialState, ...initialProps].map((initialValue, index) => {
        let value = initialValue;
        const pending: PendingCellUpdate[] = [];
        return {
          get: () => {
            if (this.activeBinding && this.activeDependencies) {
              this.activeDependencies.add(index);
            }
            return value;
          },
          set: (next) => {
            pending.push({ kind: "state", update: next });
            this.scheduleBindingFlush(index);
          },
          replace: (next) => {
            pending.push({ kind: "value", value: next });
          },
          flush: () => {
            if (pending.length === 0) return false;
            const previous = value;
            for (const next of pending.splice(0)) {
              if (next.kind === "value") {
                value = next.value;
              } else {
                value = typeof next.update === "function" ? next.update(value) : next.update;
              }
            }
            return !Object.is(previous, value);
          },
        };
      });
      const featureOwner: CompilerRuntimeFeatureOwner = {
        setRoot: (id, root) => this.setBlockRoot(id, root),
        subscribe: (id, refresh) => this.subscribeToBlock(id, refresh),
      };
      const blockRuntime: Partial<CompilerBlockRuntime> = {
        target: (id) => this.bindingTarget(id),
      };
      for (const feature of runtimeFeatures) {
        Object.assign(blockRuntime, feature.create(featureOwner));
      }
      this.blockRuntime = blockRuntime as CompilerBlockRuntime;
    }

    private usesHybridReactivity(): boolean {
      return definitionReference.current.reactivity === "hybrid";
    }

    private canReuseRenderedElement(
      currentDefinition: CompiledComponentDefinition<Props>,
      propValues: readonly unknown[] | null,
    ): boolean {
      return Boolean(
        this.mounted &&
        propValues &&
        propValues.every(isCompilerPrimitive) &&
        this.renderedDefinition === currentDefinition &&
        this.renderedElement,
      );
    }

    private renderCellsForProps(propValues: readonly unknown[] | null): {
      cells: readonly CompilerCell[];
      commit(): void;
    } {
      if (!propValues) return { cells: this.cells, commit: () => undefined };
      // A full React render must see its own prop snapshot, including inside
      // nested block render callbacks. The view switches to committed cells
      // only when its root ref is attached, so an abandoned render cannot
      // publish values or replace the reusable element.
      let committed = false;
      const cells: CompilerCell[] = this.cells.slice(0, this.propCellOffset);
      for (let propIndex = 0; propIndex < propValues.length; propIndex += 1) {
        const cell = this.cells[this.propCellOffset + propIndex];
        if (!cell) continue;
        cells.push({
          get: () => (committed ? cell.get() : propValues[propIndex]),
          set: (next) => cell.set(next),
        });
      }
      return {
        cells,
        commit: () => {
          committed = true;
        },
      };
    }

    private tracksBinding(
      binding: Exclude<CompilerBinding<Props>, CompilerConditionalBlockBinding>,
    ): boolean {
      return this.usesHybridReactivity() && binding.tracking === "dynamic";
    }

    private ensureBindingIndex(): void {
      const currentDefinition = definitionReference.current;
      if (this.indexedDefinition === currentDefinition) return;

      this.indexedDefinition = currentDefinition;
      this.staticBindingsByDependency = Array.from({ length: this.cells.length }, () => []);
      this.blockBindingsByDependency = Array.from({ length: this.cells.length }, () => []);
      this.trackedBindingsByDependency = Array.from(
        { length: this.cells.length },
        () => new Set<CompilerBinding<Props>>(),
      );
      this.blockBindings.clear();
      this.trackedDependenciesByBinding.clear();
      this.bindingValues.clear();

      for (const binding of currentDefinition.bindings) {
        if (binding.kind === "block") this.blockBindings.set(binding.id, binding);
        for (const dependency of binding.dependencies) {
          if (dependency < 0 || dependency >= this.cells.length) continue;
          if (binding.kind === "block") {
            this.blockBindingsByDependency[dependency].push(binding);
          } else if (!this.tracksBinding(binding)) {
            this.staticBindingsByDependency[dependency].push(binding);
          }
        }
      }
    }

    private updateTrackedDependencies(
      binding: CompilerBinding<Props>,
      nextDependencies: Set<number>,
    ): void {
      const previousDependencies = this.trackedDependenciesByBinding.get(binding);
      if (previousDependencies) {
        for (const dependency of previousDependencies) {
          if (!nextDependencies.has(dependency)) {
            this.trackedBindingsByDependency[dependency]?.delete(binding);
          }
        }
      }
      for (const dependency of nextDependencies) {
        if (!previousDependencies?.has(dependency)) {
          this.trackedBindingsByDependency[dependency]?.add(binding);
        }
      }
      this.trackedDependenciesByBinding.set(binding, nextDependencies);
    }

    private readBinding(binding: Exclude<CompilerBinding<Props>, CompilerConditionalBlockBinding>) {
      if (!this.tracksBinding(binding)) return binding.read(this.props, this.cells);

      const previousBinding = this.activeBinding;
      const previousDependencies = this.activeDependencies;
      const nextDependencies = new Set<number>();
      this.activeBinding = binding;
      this.activeDependencies = nextDependencies;
      try {
        return binding.read(this.props, this.cells);
      } finally {
        this.activeBinding = previousBinding;
        this.activeDependencies = previousDependencies;
        this.updateTrackedDependencies(binding, nextDependencies);
      }
    }

    private bindingValue(
      binding: Exclude<CompilerBinding<Props>, CompilerConditionalBlockBinding>,
      value: unknown,
    ): unknown {
      return binding.kind === "text" ? renderTextValue(value) : value;
    }

    private primeHybridBindings(): void {
      if (!this.usesHybridReactivity()) return;
      for (const binding of definitionReference.current.bindings) {
        if (binding.kind === "block") continue;
        if (!this.tracksBinding(binding)) continue;
        const value = this.readBinding(binding);
        this.bindingValues.set(binding, this.bindingValue(binding, value));
      }
    }

    private captureRoot = (root: Element | null) => {
      this.root = root;
    };

    private refreshDefinition = () => {
      if (this.mounted) this.forceUpdate();
    };

    private bindingTarget(id: number): React.RefCallback<Element> {
      const existing = this.bindingTargetRefs.get(id);
      if (existing) return existing;
      const capture: React.RefCallback<Element> = (element) => {
        if (element) {
          this.bindingTargets.set(id, element);
        } else {
          this.bindingTargets.delete(id);
        }
      };
      this.bindingTargetRefs.set(id, capture);
      return capture;
    }

    private captureInputSelection(): void {
      const active = this.root?.ownerDocument.activeElement;
      if (
        !isSelectableTextControl(active) ||
        !this.root?.contains(active) ||
        active.selectionStart === null ||
        active.selectionEnd === null
      ) {
        return;
      }
      this.inputSelection = {
        element: active,
        start: active.selectionStart,
        end: active.selectionEnd,
        direction: active.selectionDirection || "none",
      };
    }

    private restoreInputSelection(snapshot: InputSelectionSnapshot | null): void {
      if (
        !snapshot ||
        !snapshot.element.isConnected ||
        snapshot.element.ownerDocument.activeElement !== snapshot.element
      ) {
        return;
      }
      snapshot.element.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction);
    }

    private setBlockRoot(id: number, root: Element | null): void {
      const previous = this.blockRoots.get(id);
      if (previous) this.blockRootElements.delete(previous);
      if (root) {
        this.blockRoots.set(id, root);
        this.blockRootElements.add(root);
      } else {
        this.blockRoots.delete(id);
      }
    }

    private subscribeToBlock(id: number, refresh: CompilerBlockRefresh): () => void {
      this.blockRefreshListeners.set(id, refresh);
      return () => {
        if (this.blockRefreshListeners.get(id) === refresh) {
          this.blockRefreshListeners.delete(id);
        }
      };
    }

    private scheduleBindingFlush(index: number): void {
      this.dirtyState.add(index);
      this.captureInputSelection();
      if (!this.mounted || this.flushQueued) return;
      this.flushQueued = true;
      queueMicrotask(() => {
        this.flushQueued = false;
        this.flushBindingUpdates();
      });
    }

    private flushBindingUpdates(): void {
      const inputSelection = this.inputSelection;
      this.inputSelection = null;
      if (!this.mounted) return;
      const dirty = new Set<number>();
      for (const index of this.dirtyState) {
        if (this.cells[index]?.flush()) dirty.add(index);
      }
      this.dirtyState.clear();
      if (dirty.size === 0) return;
      try {
        this.ensureBindingIndex();
        const affectedBlockIds = new Set<number>();
        const affectedBindings = new Set<CompilerBinding<Props>>();

        for (const dependency of dirty) {
          for (const binding of this.blockBindingsByDependency[dependency] || []) {
            affectedBlockIds.add(binding.id);
          }
          for (const binding of this.staticBindingsByDependency[dependency] || []) {
            affectedBindings.add(binding);
          }
          if (this.usesHybridReactivity()) {
            for (const binding of this.trackedBindingsByDependency[dependency] || []) {
              affectedBindings.add(binding);
            }
          }
        }

        const hasAffectedMountedAncestor = (binding: CompilerConditionalBlockBinding): boolean => {
          let parent = binding.parent;
          while (parent !== undefined) {
            if (affectedBlockIds.has(parent) && this.blockRefreshListeners.has(parent)) {
              return true;
            }
            parent = this.blockBindings.get(parent)?.parent;
          }
          return false;
        };

        const blockRefreshes = [...affectedBlockIds]
          .map((id) => {
            const binding = this.blockBindings.get(id);
            const refresh = this.blockRefreshListeners.get(id);
            return binding && refresh && !hasAffectedMountedAncestor(binding) ? refresh : undefined;
          })
          .filter((refresh): refresh is CompilerBlockRefresh => refresh !== undefined);

        for (const binding of affectedBindings) {
          if (binding.kind !== "block") this.applyBinding(binding);
        }

        let pendingBlockCommits = blockRefreshes.length;
        for (const refresh of blockRefreshes) {
          refresh(() => {
            pendingBlockCommits -= 1;
            if (pendingBlockCommits === 0) this.restoreInputSelection(inputSelection);
          }, dirty);
        }
        if (blockRefreshes.length === 0) this.restoreInputSelection(inputSelection);
      } catch (error) {
        this.bindingError = error;
        this.hasBindingError = true;
        this.forceUpdate();
      }
    }

    private applyBinding(binding: CompilerBinding<Props>, force = false): void {
      if (!this.root || binding.kind === "block") return;
      const target =
        binding.target === undefined
          ? findBindingTarget(this.root, binding.path, this.blockRootElements)
          : binding.path.length === 0
            ? this.root
            : this.bindingTargets.get(binding.target) || null;
      if (!target) return;
      const value = this.readBinding(binding);
      const comparableValue = this.bindingValue(binding, value);
      if (!force && this.bindingValues.has(binding)) {
        if (Object.is(this.bindingValues.get(binding), comparableValue)) return;
      }
      if (binding.kind === "text") {
        target.textContent = comparableValue as string;
      } else if (binding.kind === "style") {
        updateStyle(target, binding.name, value);
      } else {
        updateAttribute(target, binding.name, value);
      }
      this.bindingValues.set(binding, comparableValue);
    }

    componentDidMount(): void {
      this.mounted = true;
      refreshListeners.add(this.refreshDefinition);
      this.ensureBindingIndex();
      this.primeHybridBindings();
    }

    getSnapshotBeforeUpdate(): boolean {
      const currentDefinition = definitionReference.current;
      const propValues = currentDefinition.readProps?.(this.props) || null;
      return this.canReuseRenderedElement(currentDefinition, propValues);
    }

    componentDidUpdate(
      _previousProps: Readonly<Props>,
      _previousState: Readonly<Record<string, never>>,
      reusedRenderedElement = false,
    ): void {
      const propValues = definitionReference.current.readProps?.(this.props) || null;
      if (propValues) {
        if (reusedRenderedElement) this.captureInputSelection();
        for (let propIndex = 0; propIndex < propValues.length; propIndex += 1) {
          const cellIndex = this.propCellOffset + propIndex;
          const cell = this.cells[cellIndex];
          if (!cell) continue;
          cell.replace(propValues[propIndex]);
          if (reusedRenderedElement) {
            this.dirtyState.add(cellIndex);
          } else {
            // React already reconciled a full render using the pending prop
            // snapshot. Commit the cell without scheduling duplicate work.
            cell.flush();
          }
        }
        this.flushBindingUpdates();
        return;
      }

      // Hand-authored definitions without prop cells retain the original
      // React-owned prop reconciliation behavior.
      this.ensureBindingIndex();
      for (const binding of definitionReference.current.bindings) {
        if (binding.kind !== "block") this.applyBinding(binding, true);
      }
    }

    componentWillUnmount(): void {
      this.mounted = false;
      this.root = null;
      this.dirtyState.clear();
      this.inputSelection = null;
      this.blockRefreshListeners.clear();
      this.blockRoots.clear();
      this.blockRootElements.clear();
      this.bindingTargets.clear();
      this.bindingTargetRefs.clear();
      this.indexedDefinition = null;
      this.staticBindingsByDependency = [];
      this.blockBindingsByDependency = [];
      this.blockBindings.clear();
      this.trackedBindingsByDependency = [];
      this.trackedDependenciesByBinding.clear();
      this.bindingValues.clear();
      this.activeBinding = null;
      this.activeDependencies = null;
      refreshListeners.delete(this.refreshDefinition);
    }

    render(): React.ReactNode {
      if (this.hasBindingError) throw this.bindingError;
      const currentDefinition = definitionReference.current;
      const propValues = currentDefinition.readProps?.(this.props) || null;
      if (this.canReuseRenderedElement(currentDefinition, propValues)) {
        return this.renderedElement;
      }

      const renderCells = this.renderCellsForProps(propValues);
      const element = currentDefinition.render(this.props, renderCells.cells, this.blockRuntime);
      if (!React.isValidElement(element)) {
        throw new TypeError(
          `Compiled component ${currentDefinition.displayName} must return one host element.`,
        );
      }
      let renderedElement: React.ReactElement;
      const captureCommittedRoot = (root: Element | null) => {
        this.captureRoot(root);
        if (!root) return;
        renderCells.commit();
        this.renderedDefinition = currentDefinition;
        this.renderedElement = renderedElement;
      };
      if (element.type === this.blockRuntime.KeyedRanges) {
        renderedElement = React.cloneElement(
          element as React.ReactElement<CompilerKeyedRangesBlockProps>,
          {
            rootRef: captureCommittedRoot,
          },
        );
      } else if (element.type === this.blockRuntime.ConditionalRanges) {
        renderedElement = React.cloneElement(
          element as React.ReactElement<CompilerConditionalRangesBlockProps>,
          { rootRef: captureCommittedRoot },
        );
      } else if (element.type === this.blockRuntime.MixedRanges) {
        renderedElement = React.cloneElement(
          element as React.ReactElement<CompilerMixedRangesBlockProps>,
          {
            rootRef: captureCommittedRoot,
          },
        );
      } else if (typeof element.type !== "string") {
        throw new TypeError(
          `Compiled component ${currentDefinition.displayName} must return one host element.`,
        );
      } else {
        renderedElement = React.cloneElement(element, {
          ref: captureCommittedRoot,
        } as React.Attributes);
      }
      return renderedElement;
    }
  }

  (FarmCompiledComponent as React.ComponentType<Props>).displayName =
    `FarmCompiled(${definition.displayName})`;
  const component = FarmCompiledComponent as React.ComponentType<Props>;

  if (definition.hmrId) {
    getCompilerHmrRegistry().set(definition.hmrId, {
      component: component as React.ComponentType<unknown>,
      definition: definitionReference as CompiledDefinitionReference<unknown>,
      refreshListeners,
      stateSignature,
      runtimeSignature,
    });
  }

  return component;
}

const COMPLETE_RUNTIME_FEATURES: readonly CompilerRuntimeFeature[] = [
  conditionalRuntimeFeature,
  hostConditionalRuntimeFeature,
  conditionalRangesRuntimeFeature,
  keyedListRuntimeFeature,
  keyedRowsCompleteHintedRuntimeFeature,
  keyedRangesRuntimeFeature,
  mixedRangesRuntimeFeature,
  componentRuntimeFeature,
];

/**
 * Compatibility entry for hand-authored runtime definitions.
 * Compiler output uses createCompiledComponentWithFeatures so unused structural
 * runtimes can be removed from production bundles.
 */
export function createCompiledComponent<Props>(
  definition: CompiledComponentDefinition<Props>,
): React.ComponentType<Props> {
  return createCompiledComponentWithFeatures(definition, COMPLETE_RUNTIME_FEATURES);
}
