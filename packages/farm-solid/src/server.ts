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
  materializeSolidDocument,
} from "./runtime";

export const name = "solid";
export const capabilities = {
  streaming: { node: true, web: true },
} as const;
export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement };
export { generateHydrationScript };

/** Farm passes the response's CSP nonce, which Solid puts on its hydration scripts. */
interface FarmSolidRenderOptions {
  nonce?: string;
}

export async function renderToString(
  element: unknown,
  options?: FarmSolidRenderOptions,
): Promise<string> {
  return renderToStringAsync(
    () => materializeSolidDocument(element),
    options?.nonce ? { nonce: options.nonce } : undefined,
  );
}

function createSolidStream(
  element: unknown,
  onError: (error: unknown) => void,
  nonce: string | undefined,
) {
  const options = { onError, ...(nonce ? { nonce } : {}) } as Parameters<
    typeof renderSolidToStream
  >[1] & {
    onError(error: unknown): void;
  };
  return renderSolidToStream(() => materializeSolidDocument(element), options);
}

export function renderToReadableStream(
  element: unknown,
  renderOptions?: FarmSolidRenderOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const stream = createSolidStream(
        element,
        (error) => {
          if (closed) return;
          closed = true;
          controller.error(error);
        },
        renderOptions?.nonce,
      );

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
    nonce?: string;
  },
) {
  let shellReady = false;
  let failed = false;
  const stream = createSolidStream(
    element,
    (error) => {
      failed = true;
      if (!shellReady) callbacks.onShellError(error);
      callbacks.onError(error);
    },
    callbacks.nonce,
  );

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
