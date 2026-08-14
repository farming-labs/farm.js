import React from "react";

export type CompilerStateUpdater = unknown | ((previous: unknown) => unknown);

export interface CompilerCell {
  get(): unknown;
  set(next: CompilerStateUpdater): void;
}

interface RuntimeCell extends CompilerCell {
  flush(): boolean;
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

export type CompilerBinding<Props> = CompilerTextBinding<Props> | CompilerAttributeBinding<Props>;

export interface CompiledComponentDefinition<Props> {
  displayName: string;
  /** Stable development-only identity used to preserve state across compatible refreshes. */
  hmrId?: string;
  /** Changes when the compiler-owned state layout is no longer refresh-compatible. */
  stateSignature?: string;
  initialize(props: Props): readonly unknown[];
  render(props: Props, state: readonly CompilerCell[]): React.ReactElement;
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

function findBindingTarget(root: Element, path: readonly number[]): Element | null {
  let current: Element | null = root;
  for (const index of path) {
    current = current?.children.item(index) || null;
  }
  return current;
}

function updateAttribute(element: Element, name: string, value: unknown): void {
  const attributeName = name === "className" ? "class" : name === "htmlFor" ? "for" : name;
  const stringifiesBoolean = attributeName.startsWith("data-") || attributeName.startsWith("aria-");

  if (name === "value" && element instanceof HTMLInputElement) {
    element.value = value === null || value === undefined ? "" : String(value);
    return;
  }

  if (name === "checked" && element instanceof HTMLInputElement) {
    element.checked = Boolean(value);
    return;
  }

  if (name === "selected" && element instanceof HTMLOptionElement) {
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
    private readonly dirtyState = new Set<number>();
    private readonly cells: RuntimeCell[];

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
    }

    private captureRoot = (root: Element | null) => {
      this.root = root;
    };

    private refreshDefinition = () => {
      if (this.mounted) this.forceUpdate();
    };

    private scheduleBindingFlush(index: number): void {
      this.dirtyState.add(index);
      if (!this.mounted || this.flushQueued) return;
      this.flushQueued = true;
      queueMicrotask(() => {
        this.flushQueued = false;
        if (!this.mounted) return;
        const dirty = new Set<number>();
        for (const index of this.dirtyState) {
          if (this.cells[index]?.flush()) dirty.add(index);
        }
        this.dirtyState.clear();
        if (dirty.size === 0) return;
        try {
          for (const binding of definitionReference.current.bindings) {
            if (binding.dependencies.some((dependency) => dirty.has(dependency))) {
              this.applyBinding(binding);
            }
          }
        } catch (error) {
          this.bindingError = error;
          this.hasBindingError = true;
          this.forceUpdate();
        }
      });
    }

    private applyBinding(binding: CompilerBinding<Props>): void {
      if (!this.root) return;
      const target = findBindingTarget(this.root, binding.path);
      if (!target) return;
      const value = binding.read(this.props, this.cells);
      if (binding.kind === "text") {
        target.textContent = renderTextValue(value);
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
      for (const binding of definitionReference.current.bindings) this.applyBinding(binding);
    }

    componentWillUnmount(): void {
      this.mounted = false;
      this.root = null;
      this.dirtyState.clear();
      refreshListeners.delete(this.refreshDefinition);
    }

    render(): React.ReactNode {
      if (this.hasBindingError) throw this.bindingError;
      const currentDefinition = definitionReference.current;
      const element = currentDefinition.render(this.props, this.cells);
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
