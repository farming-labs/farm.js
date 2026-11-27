import type { FarmViewTransitionMode } from "./spa-router";

/** An absent or empty anchor target inherits the document's first base target. */
export function targetsCurrentContext(anchor: HTMLAnchorElement): boolean {
  const target =
    anchor.target || anchor.ownerDocument.querySelector<HTMLBaseElement>("base[target]")?.target;
  return !target || target === "_self";
}

/** The navigation options `Link` writes into its anchor. */
export interface FarmLinkNavigateOptions {
  replace: boolean;
  scroll: boolean;
  viewTransition: FarmViewTransitionMode;
}

/**
 * Reads the options `Link` wrote into an anchor (`data-replace`, `data-no-scroll`,
 * `data-view-transition`), so the router's document click handler navigates a `Link` that never
 * hydrated the way `Link`'s own click handler would.
 */
export function readFarmLinkNavigateOptions(anchor: Element): FarmLinkNavigateOptions {
  const viewTransition = anchor.getAttribute("data-view-transition");
  return {
    replace: anchor.hasAttribute("data-replace"),
    scroll: !anchor.hasAttribute("data-no-scroll"),
    viewTransition: viewTransition === "auto" ? "auto" : viewTransition === "true",
  };
}
