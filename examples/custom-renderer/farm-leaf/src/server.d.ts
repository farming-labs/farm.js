export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { renderToString } from "leaf/server";

export declare const name: "leaf";
export declare const capabilities: {
  readonly streaming: { readonly node: false; readonly web: false };
};
