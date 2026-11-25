import type { Children } from "./index.js";

export declare function escapeHtml(value: unknown): string;
/** Throws on an async component: only the stream can wait for one. */
export declare function renderToString(element: Children): string;
/** Everything before a Suspense boundary goes out before the async components inside it resolve. */
export declare function renderToReadableStream(
  element: Children,
  options?: { progressive?: boolean; nonce?: string; onError?(error: unknown): void },
): ReadableStream<Uint8Array>;
