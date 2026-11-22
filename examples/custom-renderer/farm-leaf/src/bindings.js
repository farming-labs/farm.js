// Farm's router and theme as leaf hooks, plus a Link.
//
// Farm keeps that state in renderer-neutral stores (getSnapshot + subscribe). One hook,
// useFarmStore, turns any of them into leaf state; the rest are thin wrappers.

import { createElement, useEffect, useState } from "leaf";
import {
  FARM_LINK_OPTION_KEYS,
  createRendererRouter,
  createRendererTheme,
  resolveLinkAttributes,
} from "@farm.js/core/renderer-client";

export function useFarmStore(store) {
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot());
  useEffect(() => {
    // Catch a change between the first render and the subscription.
    setSnapshot(() => store.getSnapshot());
    const unsubscribe = store.subscribe(() => setSnapshot(() => store.getSnapshot()));
    return unsubscribe;
  }, [store]);
  return snapshot;
}

export function useRouter(options) {
  const [router] = useState(() => createRendererRouter(options));
  return {
    ...useFarmStore(router),
    push: router.push,
    replace: router.replace,
    refresh: router.refresh,
    prefetch: router.prefetch,
    back: router.back,
    forward: router.forward,
  };
}

export function useTheme() {
  const [theme] = useState(() => createRendererTheme());
  return { ...useFarmStore(theme), setTheme: theme.setTheme, toggleTheme: theme.toggleTheme };
}

/**
 * An anchor Farm's router navigates on the client. The router handles every
 * `a[data-farm-link]`, so a Link only has to render the attributes Farm resolves.
 */
export function Link(props) {
  const options = {};
  const anchor = {};
  for (const [name, value] of Object.entries(props)) {
    if (FARM_LINK_OPTION_KEYS.includes(name)) options[name] = value;
    else anchor[name] = value;
  }
  return createElement("a", { ...anchor, ...resolveLinkAttributes(options) });
}
