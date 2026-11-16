import { createSSRApp, defineComponent } from "vue";
import {
  renderToNodeStream as renderVueToNodeStream,
  renderToString as renderVueToString,
  renderToWebStream as renderVueToWebStream,
} from "@vue/server-renderer";
import VueCompat, {
  Fragment,
  Suspense,
  createElement,
  isValidElement,
  markFunctionComponent,
  materializeVueElement,
} from "./runtime";
import { validateFarmVueAppSetup, type FarmVueAppSetup } from "./app-setup";

export const name = "vue";
export const capabilities = {
  streaming: { node: true, web: true },
} as const;
export { Fragment, Suspense, createElement, isValidElement, markFunctionComponent };

/**
 * Vue's server renderer never renders a boundary again after `onErrorCaptured`, so a throw
 * inside it was dropped: the response was a 200 page, and a redirect() or notFound() never
 * reached Farm. On the server the boundary passes its children through and the throw fails the
 * render, as React's and Preact's do, so Farm answers with the route's error page and status,
 * as in production. The client keeps the real boundary, and both take the same props.
 */
export const ErrorBoundary = defineComponent({
  name: "FarmVueErrorBoundary",
  props: {
    Fallback: { type: [Object, Function], required: true },
    fallbackProps: { type: Object, default: () => ({}) },
  },
  setup:
    (_props, { slots }) =>
    () =>
      slots.default?.(),
});

/** Vue hydration does not require an inline bootstrap before the client entry. */
export function generateHydrationScript(): string {
  return "";
}

let appSetup: FarmVueAppSetup | undefined;

/** Install the app's `app` setup module; Farm calls this before rendering. */
export function configureApp(setup: unknown): void {
  appSetup = validateFarmVueAppSetup(setup);
}

function createFarmVueServerApp(element: unknown) {
  const app = createSSRApp(
    defineComponent({
      name: "FarmVueServerRoot",
      setup: () => () => materializeVueElement(element),
    }),
  );
  // Vue's production build logs an error a component throws and renders on without it, where
  // its development build rethrows. Farm answers a thrown redirect(), notFound() or error with
  // its status, so the server app rethrows in production too.
  app.config.throwUnhandledErrorInProduction = true;
  appSetup?.(app, { ssr: true });
  return app;
}

export async function renderToString(element: unknown): Promise<string> {
  return renderVueToString(createFarmVueServerApp(element));
}

export function renderToReadableStream(
  element: unknown,
  options?: { onError?(error: unknown): void },
): ReadableStream<Uint8Array> {
  let source: ReadableStream<Uint8Array>;
  try {
    source = renderVueToWebStream(createFarmVueServerApp(element)) as ReadableStream<Uint8Array>;
  } catch (error) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(error);
      },
    });
  }
  // A failure before any output errors the stream, so Farm answers with the error's status. One
  // after output has gone out is reported through onError and the stream ends, as React reports
  // a late error: erroring a response that has started would reset the connection.
  const reader = source.getReader();
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        started = true;
        controller.enqueue(value);
      } catch (error) {
        if (!started) {
          controller.error(error);
          return;
        }
        options?.onError?.(error);
        controller.close();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
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
  let source: ReturnType<typeof renderVueToNodeStream>;
  try {
    source = renderVueToNodeStream(createFarmVueServerApp(element));
  } catch (error) {
    // Vue throws a component's synchronous setup error from the call itself: report it as the
    // shell error it is, after the caller has its callbacks in place.
    queueMicrotask(() => callbacks.onShellError(error));
    return { pipe() {} };
  }
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
