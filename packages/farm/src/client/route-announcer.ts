/** The visually hidden live region that announces client navigations to screen readers. */
export const FARM_ROUTE_ANNOUNCER_ID = "farm-route-announcer";

/**
 * How long the region holds empty text before the announcement. A live region announces changes,
 * so one created (or cleared) in the same task as its text may be read late or not at all, and a
 * page whose title matches the last one would not be announced again.
 */
export const FARM_ROUTE_ANNOUNCEMENT_DELAY_MS = 60;

const VISUALLY_HIDDEN =
  "position:absolute;top:0;left:0;width:1px;height:1px;margin:-1px;padding:0;border:0;" +
  "overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap";

/** What a screen reader hears for the page on screen: its title, its first h1, or its path. */
function readFarmRouteAnnouncement(target: Window): string {
  const document = target.document;
  const heading = document.querySelector("h1");
  return (
    document.title.trim() ||
    (heading?.innerText || heading?.textContent || "").trim() ||
    target.location.pathname
  );
}

function getAnnouncerRegion(document: Document): HTMLElement {
  let region = document.getElementById(FARM_ROUTE_ANNOUNCER_ID);
  if (!region) {
    region = document.createElement("div");
    region.id = FARM_ROUTE_ANNOUNCER_ID;
    region.setAttribute("aria-live", "assertive");
    region.setAttribute("aria-atomic", "true");
    // CSSOM, not a style attribute, so a strict style-src policy allows it.
    region.style.cssText = VISUALLY_HIDDEN;
    document.body.appendChild(region);
  }
  return region;
}

/**
 * Announce client navigations, as Next.js and SvelteKit do. The page on screen when this is
 * created is the baseline. Each call after a navigation renders announces the new page when its
 * path or title changed: not for the initial load, a hash change, or a refresh that kept both.
 * The live region is created on the first announcement, never in server HTML.
 */
export function createFarmRouteAnnouncer(
  target: Window | undefined = typeof window === "undefined" ? undefined : window,
): () => void {
  if (!target?.document) return () => {};
  let pathname = target.location.pathname;
  let title = target.document.title;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return () => {
    const document = target.document;
    if (!document.body) return;
    const nextPathname = target.location.pathname;
    const nextTitle = document.title;
    if (nextPathname === pathname && nextTitle === title) return;
    pathname = nextPathname;
    title = nextTitle;

    const message = readFarmRouteAnnouncement(target);
    const region = getAnnouncerRegion(document);
    region.textContent = "";
    clearTimeout(timer);
    timer = setTimeout(() => {
      region.textContent = message;
    }, FARM_ROUTE_ANNOUNCEMENT_DELAY_MS);
  };
}
