import {
  generateHydrationScript,
  renderToStream as renderSolidToStream,
  renderToStringAsync,
} from "solid-js/web";
import SolidCompat, {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
  materializeSolidElement,
} from "./runtime";

export const name = "solid";
export const capabilities = {
  streaming: { node: true, web: true },
} as const;
export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement };
export { generateHydrationScript };

export async function renderToString(element: unknown): Promise<string> {
  return renderToStringAsync(() => materializeSolidElement(element));
}

function createSolidStream(element: unknown, onError: (error: unknown) => void) {
  const options = { onError } as Parameters<typeof renderSolidToStream>[1] & {
    onError(error: unknown): void;
  };
  return renderSolidToStream(() => materializeSolidElement(element), options);
}

export function renderToReadableStream(element: unknown): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const stream = createSolidStream(element, (error) => {
        if (closed) return;
        closed = true;
        controller.error(error);
      });

      const writable = {
        write(chunk: string) {
          if (!closed) controller.enqueue(encoder.encode(chunk));
        },
        end() {
          if (closed) return;
          closed = true;
          controller.close();
        },
      };
      stream.pipe(writable);
    },
  });
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
  let failed = false;
  const stream = createSolidStream(element, (error) => {
    failed = true;
    if (!shellReady) callbacks.onShellError(error);
    callbacks.onError(error);
  });

  queueMicrotask(() => {
    if (failed) return;
    shellReady = true;
    callbacks.onShellReady();
  });

  return {
    pipe(destination: NodeJS.WritableStream) {
      stream.pipe(destination as { write(chunk: string): void; end(): void });
    },
  };
}

export default SolidCompat;
