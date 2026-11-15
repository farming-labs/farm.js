import { component, readExtensionService } from "./component.js";
import { findComponentPackages, readConvexConfigSource } from "./homes.js";
import { KNOWN_COMPONENTS } from "./known.js";

import type { ConvexExtension, ConvexHomes } from "./types.js";

/** The well-known components installed in convex.config.ts, minus services whose home is Farm. */
export function detectExtensions(
  root: string,
  functionsDirectory: string,
  homes: ConvexHomes,
): ConvexExtension[] {
  const source = readConvexConfigSource(root, functionsDirectory) ?? "";
  return findComponentPackages(source)
    .flatMap((name) => (KNOWN_COMPONENTS[name] ? [component(name)] : []))
    .filter((extension) => {
      const service = readExtensionService(extension);
      return !service || homes[service] !== "farm";
    });
}

/** An extension listed in `use` replaces the detected one for the same component. */
export function mergeExtensions(
  detected: readonly ConvexExtension[],
  explicit: readonly ConvexExtension[],
): ConvexExtension[] {
  const listed = new Set(explicit.map(({ component }) => component).filter(Boolean));
  return [...detected.filter(({ component }) => !listed.has(component)), ...explicit];
}
