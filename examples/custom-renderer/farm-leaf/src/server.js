// What Farm imports to render a route on the server.

export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { renderToReadableStream, renderToString } from "leaf/server";

export const name = "leaf";
export const capabilities = { streaming: { node: false, web: true } };
