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
  initialize(props: Props): readonly unknown[];
  render(props: Props, state: readonly CompilerCell[]): React.ReactElement;
  bindings: readonly CompilerBinding<Props>[];
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

  if (value === null || value === undefined || value === false) {
    element.removeAttribute(attributeName);
  } else if (value === true) {
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
  class FarmCompiledComponent extends React.Component<Props> {
    private root: Element | null = null;
    private mounted = false;
    private flushQueued = false;
    private readonly dirtyState = new Set<number>();
    private readonly cells: RuntimeCell[];

    constructor(props: Props) {
      super(props);
      this.cells = definition.initialize(props).map((initialValue, index) => {
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
        for (const binding of definition.bindings) {
          if (binding.dependencies.some((dependency) => dirty.has(dependency))) {
            this.applyBinding(binding);
          }
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
    }

    componentDidUpdate(): void {
      // React has reconciled a parent-driven prop update. Reapply compiled
      // bindings from the current cells so React and the imperative state stay
      // coherent even when both change in the same turn.
      for (const binding of definition.bindings) this.applyBinding(binding);
    }

    componentWillUnmount(): void {
      this.mounted = false;
      this.root = null;
      this.dirtyState.clear();
    }

    render(): React.ReactNode {
      const element = definition.render(this.props, this.cells);
      if (!React.isValidElement(element) || typeof element.type !== "string") {
        throw new TypeError(
          `Compiled component ${definition.displayName} must return one host element.`,
        );
      }
      return React.cloneElement(element, {
        ref: this.captureRoot,
      } as React.Attributes);
    }
  }

  (FarmCompiledComponent as React.ComponentType<Props>).displayName =
    `FarmCompiled(${definition.displayName})`;
  return FarmCompiledComponent;
}
