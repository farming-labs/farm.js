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
  let failed = false;

  source.once("error", (error) => {
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
      source.pipe(destination as NodeJS.WritableStream & { end(): void });
    },
  };
}

export default VueCompat;
