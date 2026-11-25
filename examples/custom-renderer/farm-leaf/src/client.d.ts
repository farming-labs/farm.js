import type { Root } from "leaf/dom";

export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { hydrateRoot } from "leaf/dom";

/** A leaf root over `container`, emptied first, as Farm expects of a new root. */
export declare function createRoot(container: Element): Root;
