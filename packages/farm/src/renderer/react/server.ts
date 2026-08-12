import React from "react";
import {
  renderToPipeableStream as reactRenderToPipeableStream,
  renderToString as reactRenderToString,
} from "react-dom/server";

export class ErrorBoundary extends React.Component<
  {
    Fallback: React.ComponentType<any>;
    fallbackProps: Record<string, any>;
    children: React.ReactNode;
  },
  { hasError: boolean; error: unknown }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const Fallback = this.props.Fallback;
      return React.createElement(Fallback, {
        ...this.props.fallbackProps,
        error: this.state.error,
        reset: () => this.setState({ hasError: false, error: null }),
      });
    }
    return this.props.children as React.ReactElement;
  }
}

export const name = "react";
export const capabilities = {
  streaming: { node: true, web: false },
} as const;
export const Fragment = React.Fragment;
export const Suspense = React.Suspense;
export const createElement = React.createElement;
export const isValidElement = React.isValidElement;
export const renderToString = reactRenderToString;
export const renderToPipeableStream = reactRenderToPipeableStream;

export default React;
