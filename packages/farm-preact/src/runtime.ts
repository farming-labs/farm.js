import {
  Component,
  Fragment,
  Suspense,
  createElement,
  isValidElement,
  type ComponentType,
} from "preact/compat";
import type { ComponentChildren } from "preact";

export { Fragment, Suspense, createElement, isValidElement };

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
