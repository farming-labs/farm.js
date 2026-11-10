import type React from "react";

/**
 * The part of server-tree pages every isolated-hydration app loads: compiled client boundaries
 * name the module export they render, and hot updates reach mounted server trees. The resolver and
 * the browser rebuild live in ./server-tree, which only an app with a server-tree page imports.
 */

const CLIENT_REFERENCE = Symbol.for("farm.isolated-hydration.client-reference");

export interface FarmClientReference {
  reference: string;
  exportName: string;
  Component: React.ComponentType<any>;
}

/** @internal Marks a compiled client boundary with the module export it renders. */
export function markFarmClientReference(
  boundary: React.ComponentType<any>,
  reference: FarmClientReference,
): void {
  Object.defineProperty(boundary, CLIENT_REFERENCE, { value: reference });
}

/** @internal The module export a compiled client boundary renders. */
export function getFarmClientReference(type: unknown): FarmClientReference | undefined {
  if (!type || (typeof type !== "function" && typeof type !== "object")) return undefined;
  return (type as Record<symbol, FarmClientReference | undefined>)[CLIENT_REFERENCE];
}

export type FarmServerTreeUpdateListener = (
  reference: string,
  module: Record<string, unknown>,
) => boolean;

const SERVER_TREE_UPDATES = Symbol.for("farm.isolated-hydration.server-tree-updates");

function getListeners(): Set<FarmServerTreeUpdateListener> {
  // Shared through globalThis so a server tree and the island runtime see one registry even when
  // the bundler gives them separate copies of this module.
  const shared = globalThis as Record<symbol, Set<FarmServerTreeUpdateListener> | undefined>;
  return (shared[SERVER_TREE_UPDATES] ??= new Set());
}

/** @internal Subscribes a mounted server tree to hot module updates. */
export function subscribeFarmServerTreeUpdates(listener: FarmServerTreeUpdateListener): () => void {
  const listeners = getListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** @internal Re-renders mounted server trees that render a hot-updated client module. */
export function updateFarmServerTreeModule(
  reference: string,
  module: Record<string, unknown>,
): number {
  const listeners = (globalThis as Record<symbol, Set<FarmServerTreeUpdateListener> | undefined>)[
    SERVER_TREE_UPDATES
  ];
  let updated = 0;
  if (listeners) for (const listener of listeners) if (listener(reference, module)) updated++;
  return updated;
}
