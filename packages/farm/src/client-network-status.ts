/**
 * Connectivity observation for the client data layer. Environments without a
 * navigator (server rendering, tests) report online so nothing ever pauses
 * there.
 */
export function isNavigatorOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

/** Subscribe to the browser `online` event. Returns a disposer; no-op outside the browser. */
export function subscribeOnline(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", listener);
  return () => window.removeEventListener("online", listener);
}
