// Farm's router, theme, server functions, and server queries as leaf hooks, plus a Link and an Image.
//
// Farm keeps that state in renderer-neutral stores (getSnapshot + subscribe). One hook,
// useFarmStore, turns any of them into leaf state; the rest are thin wrappers.

import { createElement, useEffect, useMemo, useState } from "leaf";
import {
  FARM_LINK_OPTION_KEYS,
  createRendererAction,
  createRendererQuery,
  createRendererRouter,
  createRendererTheme,
  resolveImageAttributes,
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

/** A server function's call state: `submit()` calls it, and the snapshot has `pending`, `data`, and `error`. */
export function useAction(target, options) {
  const [action] = useState(() => createRendererAction(target, options));
  return { ...useFarmStore(action), submit: action.submit, reset: action.reset };
}

/**
 * A server query's result from Farm's browser cache. It reads after hydration, and reads again
 * when a server function invalidates its key.
 */
export function useServerQuery(query, input, options) {
  // Inputs are serializable, since the browser posts them, so their JSON identifies a new read.
  const observer = useMemo(
    () => createRendererQuery(query, input, options),
    [query, JSON.stringify(input ?? null)],
  );
  useEffect(() => () => observer.dispose(), [observer]);
  return { ...useFarmStore(observer), refetch: observer.refetch };
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

/**
 * An image Farm's image endpoint resizes: the same options as React's `Image` from
 * `@farm.js/core/image`, rendered as leaf's own `<img>`.
 */
export function Image(props) {
  return createElement("img", resolveImageAttributes(props));
}
