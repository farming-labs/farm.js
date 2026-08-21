import { getInstalledFarmSPARouter } from "./spa-router";

/** Fired after programmatic query-string updates when Farm SPA router is active. */
export const FARM_URL_SEARCH_CHANGE_EVENT = "farm:urlsearchchange";

/**
 * Notify URL observers after history.pushState/replaceState updates the query string.
 *
 * nuqs uses `shallow: true` for client-only URL updates and dispatches synthetic
 * `popstate` so other hooks resync. Farm's SPA router also listens to `popstate`
 * for full document navigation, so when `__FARM_SPA_ROUTER__` is installed we emit a
 * dedicated event instead and keep `popstate` for real back/forward navigation.
 */
export function notifyUrlSearchObservers(shallow: boolean): void {
  if (!shallow || typeof window === "undefined") return;

  setTimeout(() => {
    if (getInstalledFarmSPARouter()) {
      window.dispatchEvent(new CustomEvent(FARM_URL_SEARCH_CHANGE_EVENT));
      return;
    }

    window.dispatchEvent(new PopStateEvent("popstate"));
  }, 0);
}

export function subscribeUrlSearchObservers(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("popstate", listener);
  window.addEventListener(FARM_URL_SEARCH_CHANGE_EVENT, listener);

  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(FARM_URL_SEARCH_CHANGE_EVENT, listener);
  };
}
