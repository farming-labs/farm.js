import React from "react";

export type CompilerStateUpdater = unknown | ((previous: unknown) => unknown);

export interface CompilerCell {
  get(): unknown;
  set(next: CompilerStateUpdater): void;
}

interface RuntimeCell extends CompilerCell {
  flush(): boolean;
}

type SelectableTextControl = HTMLInputElement | HTMLTextAreaElement;

interface InputSelectionSnapshot {
  element: SelectableTextControl;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

export interface CompilerTextBinding<Props> {
  kind: "text";
  path: readonly number[];
  dependencies: readonly number[];
  read(props: Props, state: readonly CompilerCell[]): unknown;
}

export interface CompilerAttributeBinding<Props> {
  kind: "attribute";
  path: readonly number[];
  dependencies: readonly number[];
  name: string;
  read(props: Props, state: readonly CompilerCell[]): unknown;
}

export interface CompilerStyleBinding<Props> {
  kind: "style";
  path: readonly number[];
  dependencies: readonly number[];
  name: string;
  read(props: Props, state: readonly CompilerCell[]): unknown;
}

export interface CompilerConditionalBlockBinding {
  kind: "block";
  id: number;
  dependencies: readonly number[];
}

export interface CompilerConditionalBlockProps {
  id: number;
  render(): React.ReactNode;
}

export interface CompilerBlockRuntime {
  Conditional: React.ComponentType<CompilerConditionalBlockProps>;
}

export type CompilerBinding<Props> =
  | CompilerTextBinding<Props>
  | CompilerAttributeBinding<Props>
  | CompilerStyleBinding<Props>
  | CompilerConditionalBlockBinding;

export interface CompiledComponentDefinition<Props> {
  displayName: string;
  /** Stable development-only identity used to preserve state across compatible refreshes. */
  hmrId?: string;
  /** Changes when the compiler-owned state layout is no longer refresh-compatible. */
  stateSignature?: string;
  initialize(props: Props): readonly unknown[];
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

interface ConditionalBlockOwner {
  setRoot(id: number, root: Element | null): void;
  subscribe(id: number, refresh: (afterCommit?: () => void) => void): () => void;
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

/**
 * Runtime target emitted by the AOT transform.
 *
 * React owns component placement, SSR, hydration, props, and event semantics.
 * Compiler cells own local state updates and patch only precomputed DOM paths.
 */
export function createCompiledComponent<Props>(
  definition: CompiledComponentDefinition<Props>,
): React.ComponentType<Props> {
  const stateSignature = definition.stateSignature || String(definition.initialize.length);
  if (definition.hmrId) {
    const registry = getCompilerHmrRegistry();
    const existing = registry.get(definition.hmrId);
    if (existing?.stateSignature === stateSignature) {
      existing.definition.current = definition as CompiledComponentDefinition<unknown>;
      existing.component.displayName = `FarmCompiled(${definition.displayName})`;
      for (const refresh of existing.refreshListeners) refresh();
      return existing.component as React.ComponentType<Props>;
    }
  }

  const definitionReference: CompiledDefinitionReference<Props> = { current: definition };
  const refreshListeners = new Set<() => void>();

  class FarmCompiledComponent extends React.Component<Props> {
    private root: Element | null = null;
    private mounted = false;
    private flushQueued = false;
    private bindingError: unknown;
    private hasBindingError = false;
    private inputSelection: InputSelectionSnapshot | null = null;
    private readonly dirtyState = new Set<number>();
    private readonly cells: RuntimeCell[];
    private readonly blockRefreshListeners = new Map<number, (afterCommit?: () => void) => void>();
    private readonly blockRoots = new Map<number, Element>();
    private readonly blockRootElements = new Set<Element>();
    private readonly blockRuntime: CompilerBlockRuntime;

    constructor(props: Props) {
      super(props);
      this.cells = definitionReference.current.initialize(props).map((initialValue, index) => {
        let value = initialValue;
        const pending: CompilerStateUpdater[] = [];
        return {
          get: () => value,
          set: (next) => {
            pending.push(next);
            this.scheduleBindingFlush(index);
          },
          flush: () => {
            if (pending.length === 0) return false;
            const previous = value;
            for (const next of pending.splice(0)) {
              value = typeof next === "function" ? next(value) : next;
            }
            return !Object.is(previous, value);
          },
        };
      });
      this.blockRuntime = {
        Conditional: createConditionalBlockComponent({
          setRoot: (id, root) => this.setBlockRoot(id, root),
          subscribe: (id, refresh) => this.subscribeToBlock(id, refresh),
        }),
      };
    }

    private captureRoot = (root: Element | null) => {
      this.root = root;
    };

    private refreshDefinition = () => {
      if (this.mounted) this.forceUpdate();
    };

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

    private subscribeToBlock(id: number, refresh: (afterCommit?: () => void) => void): () => void {
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
          let blockRefreshScheduled = false;
          for (const binding of definitionReference.current.bindings) {
            if (binding.dependencies.some((dependency) => dirty.has(dependency))) {
              if (binding.kind === "block") {
                const refresh = this.blockRefreshListeners.get(binding.id);
                if (refresh) {
                  blockRefreshScheduled = true;
                  refresh(() => this.restoreInputSelection(inputSelection));
                }
              } else {
                this.applyBinding(binding);
              }
            }
          }
          if (!blockRefreshScheduled) this.restoreInputSelection(inputSelection);
        } catch (error) {
          this.bindingError = error;
          this.hasBindingError = true;
          this.forceUpdate();
        }
      });
    }

    private applyBinding(binding: CompilerBinding<Props>): void {
      if (!this.root || binding.kind === "block") return;
      const target = findBindingTarget(this.root, binding.path, this.blockRootElements);
      if (!target) return;
      const value = binding.read(this.props, this.cells);
      if (binding.kind === "text") {
        target.textContent = renderTextValue(value);
      } else if (binding.kind === "style") {
        updateStyle(target, binding.name, value);
      } else {
        updateAttribute(target, binding.name, value);
      }
    }

    componentDidMount(): void {
      this.mounted = true;
      refreshListeners.add(this.refreshDefinition);
    }

    componentDidUpdate(): void {
      // React has reconciled a parent-driven prop update. Reapply compiled
      // bindings from the current cells so React and the imperative state stay
      // coherent even when both change in the same turn.
      for (const binding of definitionReference.current.bindings) {
        if (binding.kind !== "block") this.applyBinding(binding);
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
      refreshListeners.delete(this.refreshDefinition);
    }

    render(): React.ReactNode {
      if (this.hasBindingError) throw this.bindingError;
      const currentDefinition = definitionReference.current;
      const element = currentDefinition.render(this.props, this.cells, this.blockRuntime);
      if (!React.isValidElement(element) || typeof element.type !== "string") {
        throw new TypeError(
          `Compiled component ${currentDefinition.displayName} must return one host element.`,
        );
      }
      return React.cloneElement(element, {
        ref: this.captureRoot,
      } as React.Attributes);
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
    });
  }

  return component;
}
