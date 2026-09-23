import { createSSRApp, defineComponent } from "vue";
import {
  renderToNodeStream as renderVueToNodeStream,
  renderToString as renderVueToString,
  renderToWebStream as renderVueToWebStream,
} from "@vue/server-renderer";
import VueCompat, {
  Fragment,
  Suspense,
  ErrorBoundary,
  createElement,
  isValidElement,
  materializeVueElement,
} from "./runtime";

export const name = "vue";
export const capabilities = {
  streaming: { node: true, web: true },
} as const;
export { Fragment, Suspense, ErrorBoundary, createElement, isValidElement };

/** Vue hydration does not require an inline bootstrap before the client entry. */
export function generateHydrationScript(): string {
  return "";
}

function createFarmVueServerApp(element: unknown) {
  return createSSRApp(
    defineComponent({
      name: "FarmVueServerRoot",
      setup: () => () => materializeVueElement(element),
    }),
  );
}

export async function renderToString(element: unknown): Promise<string> {
  return renderVueToString(createFarmVueServerApp(element));
}

export function renderToReadableStream(element: unknown): ReadableStream<Uint8Array> {
  return renderVueToWebStream(createFarmVueServerApp(element)) as ReadableStream<Uint8Array>;
}

export function renderToPipeableStream(
  element: unknown,
  callbacks: {
    onShellReady(): void;
    onShellError(error: unknown): void;
    onError(error: unknown): void;
  },
) {
  const source = renderVueToNodeStream(createFarmVueServerApp(element));
  let shellReady = false;
  let shellErrored = false;
  let destination: (NodeJS.WritableStream & { destroy?(error?: unknown): void }) | undefined;

  const abortDestination = () => {
    if (!destination) return;
    // `pipe()` forwards source `end` but not errors, so the awaiting consumer
    // needs an explicit nudge to settle. End the destination (rather than
    // destroying it with the error) so the consumer's `_final` -> `res.end()` /
    // `resolve()` runs. The consumer's piped `Writable` attaches no `'error'`
    // listener; `destination.destroy(error)` would re-emit the error through
    // `pipe()`'s prepended destination onerror -> `uncaughtException` (worker
    // crash) and, even if contained, skips `_final` so the request hangs.
    if (typeof destination.end === "function") destination.end();
    else if (typeof destination.destroy === "function") destination.destroy();
  };

  source.on("error", (error) => {
    // An error before any output is a shell failure (the request can still send
    // a clean error response); after output it is a mid-stream error. Reporting
    // shell-ready from a blind microtask misclassified every error as the latter
    // and left the piped destination open, hanging the request.
    if (shellReady) callbacks.onError(error);
    else {
      shellErrored = true;
      callbacks.onShellError(error);
    }
    // `pipe()` does not forward source errors, so end the destination explicitly
    // or the awaiting consumer never settles.
    abortDestination();
  });

  // The shell is ready once the render produces its first output (or completes)
  // with no prior error. `readable` peeks without consuming, so piping afterward
  // still delivers every byte.
  source.once("readable", () => {
    if (shellReady || shellErrored) return;
    shellReady = true;
    callbacks.onShellReady();
  });

  return {
    pipe(target: NodeJS.WritableStream) {
      destination = target as NodeJS.WritableStream & { destroy?(error?: unknown): void };
      source.pipe(destination as NodeJS.WritableStream & { end(): void });
    },
  };
}

export default VueCompat;
