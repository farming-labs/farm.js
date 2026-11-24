/** @internal islx's browser runtime, as islands mode uses it. Apps reach islx through Farm. */
import { createServerReference as createIslxServerReference } from "@farm.js/islx/client";
import { preloadFarmIslandsActionClient } from "../islands-action-call";

export * from "@farm.js/islx/client";
export * from "@farm.js/islx/react/client";

/**
 * A client module's import of a server function. The module can call it, so the code that handles
 * a call's result starts loading now rather than on the first call (RFC 0013).
 */
export function createServerReference(
  ...args: Parameters<typeof createIslxServerReference>
): ReturnType<typeof createIslxServerReference> {
  preloadFarmIslandsActionClient();
  return createIslxServerReference(...args);
}
