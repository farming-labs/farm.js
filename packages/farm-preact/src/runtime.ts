import {
  Component,
  Fragment,
  Suspense,
  createElement as createPreactElement,
  isValidElement,
  type ComponentType,
} from "preact/compat";
import type { ComponentChildren, VNode } from "preact";

export { Fragment, Suspense, isValidElement };

function isAsyncFunction(value: unknown): value is (...args: unknown[]) => Promise<unknown> {
  return typeof value === "function" && value.constructor?.name === "AsyncFunction";
}

/**
 * Preact's server renderer silently turns an async component into an empty
 * string. Reject it while the element is created so development, SSR, and the
 * browser all get the same actionable failure instead.
 */
export const createElement = ((
  type: unknown,
  props?: unknown,
  ...children: ComponentChildren[]
): VNode => {
  if (isAsyncFunction(type)) {
    throw new TypeError(
      "FARMJS Preact renderer does not support async function components. Resolve async data before rendering the component.",
    );
  }
  const create = createPreactElement as unknown as (
    elementType: unknown,
    elementProps: unknown,
    ...elementChildren: ComponentChildren[]
  ) => VNode;
  return create(type, props ?? null, ...children);
}) as typeof createPreactElement;

interface ErrorBoundaryProps {
  Fallback: ComponentType<Record<string, unknown>>;
  fallbackProps?: Record<string, unknown>;
  children?: ComponentChildren;
}

interface ErrorBoundaryState {
  error?: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  render(props: ErrorBoundaryProps, state: ErrorBoundaryState) {
    if (state.error !== undefined) {
      return createElement(props.Fallback, {
        ...props.fallbackProps,
        error: state.error,
        reset: () => this.setState({ error: undefined }),
      });
    }
    return props.children;
  }
}

const PreactCompat = {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
};

export default PreactCompat;
