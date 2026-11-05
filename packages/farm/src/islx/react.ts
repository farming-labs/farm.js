/** @internal islx's island component, shared by the server and the browser. */
export * from "@farm.js/islx/react";

import * as React from "react";
import { createIsland } from "@farm.js/islx/react";

/** Whether `value` holds a React element where islx looks for slots: in arrays and plain objects. */
function holdsElement(value: unknown, seen: Set<object>): boolean {
  if (React.isValidElement(value)) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => holdsElement(entry, seen));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).some((entry) => holdsElement(entry, seen));
}

/**
 * An island whose hydration Farm inferred (RFC 0003, section 11): it waits for an interaction,
 * unless a render passes it server output (an element prop), whose own islands would then wait
 * with it, so that render hydrates at load.
 */
export function createInferredIsland<P extends object>(
  Component: React.ComponentType<P>,
  src: string,
  exportName: string,
): React.ComponentType<P> {
  const Waiting = createIsland(Component, src, exportName, "interaction");
  const Loading = createIsland(Component, src, exportName, "load");
  function InferredIsland(props: P) {
    return React.createElement(holdsElement(props, new Set()) ? Loading : Waiting, props);
  }
  InferredIsland.displayName = `InferredIsland(${Component.displayName || Component.name || exportName})`;
  return InferredIsland;
}
