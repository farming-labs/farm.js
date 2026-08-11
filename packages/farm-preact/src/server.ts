import type { VNode } from "preact";
import renderPreactToString from "preact-render-to-string";
import { renderToPipeableStream as preactRenderToPipeableStream } from "preact-render-to-string/stream-node";
import { renderToReadableStream as preactRenderToReadableStream } from "preact-render-to-string/stream";
import PreactCompat, {
  ErrorBoundary,
  Fragment,
  Suspense,
  createElement,
  isValidElement,
} from "./runtime";

export const name = "preact";
export { ErrorBoundary, Fragment, Suspense, createElement, isValidElement };

/** Preact hydration does not require an inline bootstrap before the client entry. */
export function generateHydrationScript(): string {
  return "";
}

export function renderToString(element: unknown): string {
  return renderPreactToString(element as VNode);
}

export function renderToReadableStream(element: unknown): ReadableStream<Uint8Array> {
  return preactRenderToReadableStream(element as VNode);
}

export function renderToPipeableStream(
  element: unknown,
  callbacks: {
    onShellReady(): void;
    onShellError(error: unknown): void;
    onError(error: unknown): void;
  },
) {
  let shellReady = false;
  return preactRenderToPipeableStream(element as VNode, {
    onShellReady() {
      shellReady = true;
      callbacks.onShellReady();
    },
    onError(error) {
      if (!shellReady) callbacks.onShellError(error);
      callbacks.onError(error);
    },
  });
}

export default PreactCompat;
