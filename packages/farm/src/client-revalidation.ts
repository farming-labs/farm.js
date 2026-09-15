export type FarmRevalidationListenerOptions = {
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
};

/**
 * Attach the shared window focus/reconnect revalidation listeners used by every
 * query consumer (React `useServerQuery` and the renderer-neutral
 * `createRendererQuery`). Connectivity-driven refresh behavior must live here
 * so all renderers observe the same triggers.
 *
 * Returns a disposer; a no-op outside the browser.
 */
export function attachRevalidationListeners(
  refresh: () => void,
  options: FarmRevalidationListenerOptions = {},
): () => void {
  if (typeof window === "undefined") return () => {};

  const onFocus = options.refetchOnWindowFocus === false ? undefined : refresh;
  const onOnline = options.refetchOnReconnect === false ? undefined : refresh;

  if (onFocus) window.addEventListener("focus", onFocus);
  if (onOnline) window.addEventListener("online", onOnline);
  return () => {
    if (onFocus) window.removeEventListener("focus", onFocus);
    if (onOnline) window.removeEventListener("online", onOnline);
  };
}
