/**
 * The browser's store of island values (RFC 0003): islx's, since islands mode hydrates through
 * islx. It keeps every value it has read, parses each once, and names what it holds in
 * navigations (`F-Values`), so the server leaves those values out.
 */
import { getValueStore } from "@farmjs/islx/client";
import type { FarmIslandValueStore } from "./island-value-protocol";

/** The page's value store, shared by every copy of the runtime. */
export function getFarmIslandValueStore(): FarmIslandValueStore {
  return getValueStore();
}
