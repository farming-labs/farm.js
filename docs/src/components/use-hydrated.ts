import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True once the page has hydrated. The server and the hydration pass render false, so markup a
 * visitor only needs once the page is interactive (hover cards, a marquee's second copy) can stay
 * out of the server HTML without a hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
