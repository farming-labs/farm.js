import React from "react";
import {
  renderToPipeableStream as reactRenderToPipeableStream,
  renderToString as reactRenderToString,
} from "react-dom/server";
import { wrapFarmIsolatedClientGraph } from "../../client/isolated-boundary";

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
export const wrapClientGraph = (element: React.ReactNode) =>
  wrapFarmIsolatedClientGraph(React, element);
export const renderToString = reactRenderToString;
export const renderToPipeableStream = reactRenderToPipeableStream;

export default React;

/**
 * React DOM's streaming runtime reveals a Suspense boundary with `$RC`/`$RS`/
 * `$RV`/`$RX` calls and labels the segments with Fizz ids such as `id="S:1"`.
 * The first of those in a chunk is where the static shell ends.
 */
export function findStaticShellBoundary(chunk: string): number {
  const markerIndexes = [
    chunk.indexOf('id="S:'),
    chunk.indexOf("id='S:"),
    chunk.indexOf("$RC("),
    chunk.indexOf("$RS("),
    chunk.indexOf("$RV("),
    chunk.indexOf("$RX("),
  ].filter((index) => index >= 0);

  if (markerIndexes.length === 0) return -1;

  const markerIndex = Math.min(...markerIndexes);
  const tagStart = chunk.lastIndexOf("<", markerIndex);
  return tagStart >= 0 ? tagStart : markerIndex;
}
