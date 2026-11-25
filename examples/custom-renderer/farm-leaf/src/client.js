// What Farm's browser entry imports to hydrate a route and render the next one.

import { createRoot as createLeafRoot } from "leaf/dom";

export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { hydrateRoot } from "leaf/dom";

// Farm expects a new root to replace what's in its container, as React's does: it creates one over
// the server's markup when hydrateRoot() throws, and over the last page when a navigation replaces
// the root. A leaf root renders next to what's already there, so empty the container first.
export function createRoot(container) {
  container.replaceChildren();
  return createLeafRoot(container);
}
