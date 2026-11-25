import type { FarmIslandReference } from "@farm.js/core/renderer";

export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { renderToString } from "leaf/server";

/** Farm hands over the route tree its createElement built, typed as `unknown`. */
export declare function renderToReadableStream(
  element: unknown,
  options?: { onError?(error: unknown): void },
): ReadableStream<Uint8Array>;

export declare const name: "leaf";

/** Marks a route's tree that hydrates as one root: client components in it render plain. */
export declare function wrapClientGraph(element: unknown): unknown;
/** Marks a page that root keeps as server HTML: client components in it are islands again. */
export declare function isolateServerPageGraph(element: unknown): unknown;
/** Wraps a client component so that, rendered from server output, it starts an island. */
export declare function withIsland(component: unknown, reference: FarmIslandReference): unknown;
export declare const capabilities: {
  readonly streaming: { readonly node: false; readonly web: true };
};
