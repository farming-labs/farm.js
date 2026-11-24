export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { renderToString } from "leaf/server";

/** Farm hands over the route tree its createElement built, typed as `unknown`. */
export declare function renderToReadableStream(
  element: unknown,
  options?: { onError?(error: unknown): void },
): ReadableStream<Uint8Array>;

export declare const name: "leaf";
export declare const capabilities: {
  readonly streaming: { readonly node: false; readonly web: true };
};
