import { getInstalledFarmSPARouter } from "./spa-router";

/** Fired after programmatic history writes that must not start a navigation. */
export const FARM_HISTORY_CHANGE_EVENT = "farm:historychange";

export type FarmHistoryChangeKind = "url-search" | "page-state";

export interface FarmHistoryChangeDetail {
  kind: FarmHistoryChangeKind;
}

function dispatchHistoryChange(kind: FarmHistoryChangeKind): void {
  window.dispatchEvent(
    new CustomEvent<FarmHistoryChangeDetail>(FARM_HISTORY_CHANGE_EVENT, {
      detail: { kind },
    }),
  );
}

/**
 * Notify history observers after pushState/replaceState.
 *
 * Farm's SPA router treats `popstate` as real back/forward navigation, so a
 * dedicated event is used instead. `url-search` keeps the nuqs-style synthetic
 * `popstate` when no Farm router is installed, so standalone `useQueryState`
 * consumers still resync; `page-state` is Farm-internal and never falls back.
 */
export function notifyHistoryChange(kind: FarmHistoryChangeKind): void {
  if (typeof window === "undefined") return;

  setTimeout(() => {
    if (kind === "url-search" && !getInstalledFarmSPARouter()) {
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }

    dispatchHistoryChange(kind);
  }, 0);
}

/** Notify observers after a Farm router commit without simulating traversal. */
export function notifyRouterHistoryChange(): void {
  if (typeof window === "undefined") return;
  setTimeout(() => dispatchHistoryChange("url-search"), 0);
}

export function subscribeHistoryChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("popstate", listener);
  window.addEventListener(FARM_HISTORY_CHANGE_EVENT, listener);

  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(FARM_HISTORY_CHANGE_EVENT, listener);
  };
}
