import { Transform } from "node:stream";
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
export const capabilities = {
  streaming: { node: true, web: true },
} as const;
export { ErrorBoundary, Fragment, Suspense, createElement, isValidElement };

/** Preact hydration does not require an inline bootstrap before the client entry. */
export function generateHydrationScript(): string {
  return "";
}

export function renderToString(element: unknown): string {
  return renderPreactToString(element as VNode);
}

/**
 * preact-render-to-string has no nonce option. Its streaming renderer writes
 * the deferred-content wrapper and then its fixed init script (which defines
 * `<preact-island>`) as two separate chunks; Farm gives that script the
 * response's CSP nonce. Rendered markup never arrives as a chunk of its own
 * right after the wrapper, so nothing else can be stamped.
 */
const PREACT_DEFERRED_WRAPPER = "<div hidden>";
const PREACT_INIT_SCRIPT =
  /^<script>\(function\(\)\{class e extends HTMLElement\{[\s\S]*customElements\.define\("preact-island",e\);\}\(\)\)<\/script>$/;

function createInitScriptNonce(nonce: string) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let afterWrapper = false;
  return (chunk: Uint8Array): Uint8Array => {
    const text = decoder.decode(chunk);
    const isInitScript = afterWrapper && PREACT_INIT_SCRIPT.test(text);
    afterWrapper = text === PREACT_DEFERRED_WRAPPER;
    return isInitScript
      ? encoder.encode(`<script nonce="${nonce}">${text.slice("<script>".length)}`)
      : chunk;
  };
}

export function renderToReadableStream(
  element: unknown,
  options?: { nonce?: string },
): ReadableStream<Uint8Array> {
  const stream = preactRenderToReadableStream(element as VNode);
  if (!options?.nonce) return stream;
  const stamp = createInitScriptNonce(options.nonce);
  const secured = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(stamp(chunk));
      },
    }),
  );
  return Object.assign(secured, { allReady: stream.allReady });
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
  const stream = preactRenderToPipeableStream(element as VNode, {
    onShellReady() {
      shellReady = true;
      callbacks.onShellReady();
    },
    onError(error) {
      if (!shellReady) callbacks.onShellError(error);
      callbacks.onError(error);
    },
  });
  const nonce = callbacks.nonce;
  if (!nonce) return stream;
  return {
    abort: stream.abort,
    pipe(destination: NodeJS.WritableStream) {
      const stamp = createInitScriptNonce(nonce);
      const secured = new Transform({
        transform(chunk: Uint8Array, _encoding, callback) {
          callback(null, stamp(chunk));
        },
      });
      stream.pipe(secured);
      secured.pipe(destination);
    },
  };
}

export default PreactCompat;
