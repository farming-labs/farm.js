/**
 * Server module for apps configured with `renderer: false`. Such an app has no pages, so Farm
 * never renders a component; this module only satisfies the renderer contract without loading
 * React or another UI runtime. Any attempt to render explains how to add pages back.
 */

const FARM_NO_RENDERER_MESSAGE =
  "This app sets `renderer: false`, so it cannot render pages or components. " +
  "Remove `renderer: false` (or configure a renderer) to add pages.";

function throwNoRenderer(): never {
  throw new Error(FARM_NO_RENDERER_MESSAGE);
}

export const Fragment = Symbol.for("farm.no-renderer.fragment");

export function createElement(): never {
  return throwNoRenderer();
}

export function isValidElement(): boolean {
  return false;
}

export function renderToString(): never {
  return throwNoRenderer();
}

export default { Fragment, createElement, isValidElement };
