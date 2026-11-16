/**
 * `Link` writes its prefetch mode here when it is not the default (intent and viewport):
 * `"intent"`, `"viewport"`, `"render"` or `"none"`.
 */
export const FARM_LINK_PREFETCH_ATTRIBUTE = "data-farm-prefetch";
/** `Link` writes its `prefetchDelay` here when it is not the default. */
export const FARM_LINK_PREFETCH_DELAY_ATTRIBUTE = "data-farm-prefetch-delay";
/** The default `prefetchDelay` of `Link`, in milliseconds. */
export const FARM_LINK_PREFETCH_DELAY = 50;

const LINK = "a[data-farm-link][href]";
const INTENT_EVENTS = ["mouseover", "focusin", "touchstart"] as const;
const LEAVE_EVENTS = ["mouseout", "focusout"] as const;

interface LinkPrefetchRouter {
  prefetch(href: string): unknown;
  observeForPrefetch?(element: HTMLAnchorElement): void;
  unobserveForPrefetch?(element: HTMLAnchorElement): void;
}

function readRouter(): LinkPrefetchRouter | null {
  const router = (window as { __FARM_SPA_ROUTER__?: LinkPrefetchRouter }).__FARM_SPA_ROUTER__;
  return router && typeof router.prefetch === "function" ? router : null;
}

/** `Link`'s default, intent and viewport, writes no attribute, so `null` is that mode. */
function readMode(anchor: Element): string | null {
  return anchor.getAttribute(FARM_LINK_PREFETCH_ATTRIBUTE);
}

/** As `Link`, which never prefetches an absolute URL (`https:`, `mailto:`, `//host`). */
function isRouted(anchor: Element): anchor is HTMLAnchorElement {
  const href = anchor.getAttribute("href");
  return !!href && !href.startsWith("//") && !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href);
}

function linksIn(node: Node): HTMLAnchorElement[] {
  if (!(node instanceof Element)) return [];
  const links = Array.from(node.querySelectorAll(LINK));
  if (node.matches(LINK)) links.unshift(node);
  return links.filter(isRouted);
}

function ignore(): void {}

/**
 * Prefetches `Link` anchors whose component never hydrated: on a page that ships no client
 * component, or in a server component in islands mode. `Link` writes its mode into the HTML, and
 * this follows it as `Link` would: intent after `prefetchDelay`, viewport through the router's
 * queue, render once the anchor is in the document. A hydrated `Link` schedules the same prefetch
 * itself, and the router drops the duplicate. Every prefetch goes through
 * `window.__FARM_SPA_ROUTER__` at call time, as `Link`'s does.
 *
 * @internal Installed once by each generated client entry. Returns the reverse, for tests.
 */
export function installFarmLinkPrefetch(): () => void {
  const timers = new Map<HTMLAnchorElement, ReturnType<typeof setTimeout>>();
  const observed = new Set<HTMLAnchorElement>();

  const prefetch = (anchor: HTMLAnchorElement) => {
    const href = anchor.getAttribute("href");
    const router = readRouter();
    if (!href || !router) return;
    try {
      // A failed prefetch is not an error: the click fetches the page, as with `Link`.
      void Promise.resolve(router.prefetch(href)).catch(ignore);
    } catch {}
  };

  const intentLink = (event: Event): HTMLAnchorElement | null => {
    const anchor = event.target instanceof Element ? event.target.closest(LINK) : null;
    if (!anchor || !isRouted(anchor)) return null;
    // Moving between an anchor's own children neither starts nor cancels anything.
    const related = (event as MouseEvent | FocusEvent).relatedTarget;
    return related instanceof Node && anchor.contains(related) ? null : anchor;
  };

  const schedule = (event: Event) => {
    const anchor = intentLink(event);
    if (!anchor || timers.has(anchor)) return;
    const mode = readMode(anchor);
    if (mode !== null && mode !== "intent") return;
    const delay = Number(
      anchor.getAttribute(FARM_LINK_PREFETCH_DELAY_ATTRIBUTE) ?? FARM_LINK_PREFETCH_DELAY,
    );
    const timer = setTimeout(() => {
      timers.delete(anchor);
      prefetch(anchor);
    }, delay);
    timers.set(anchor, timer);
  };

  const cancel = (event: Event) => {
    const anchor = intentLink(event);
    if (!anchor) return;
    const timer = timers.get(anchor);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(anchor);
  };

  const track = (node: Node) => {
    for (const anchor of linksIn(node)) {
      if (!anchor.isConnected) continue;
      const mode = readMode(anchor);
      if (mode === "render") {
        prefetch(anchor);
      } else if (mode === null || mode === "viewport") {
        const router = readRouter();
        if (!router?.observeForPrefetch) continue;
        router.observeForPrefetch(anchor);
        observed.add(anchor);
      }
    }
  };

  // A page that changes without hydrating (a client navigation, streamed content) adds and
  // removes anchors; the router holds the ones it watches until they are handed back.
  const release = (node: Node) => {
    for (const anchor of linksIn(node)) {
      if (anchor.isConnected || !observed.delete(anchor)) continue;
      readRouter()?.unobserveForPrefetch?.(anchor);
    }
  };

  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      record.removedNodes.forEach(release);
      record.addedNodes.forEach(track);
    }
  });

  for (const type of INTENT_EVENTS) {
    document.addEventListener(type, schedule, { capture: true, passive: true });
  }
  for (const type of LEAVE_EVENTS) document.addEventListener(type, cancel, true);
  mutations.observe(document.documentElement, { childList: true, subtree: true });
  track(document.documentElement);

  return () => {
    mutations.disconnect();
    for (const type of INTENT_EVENTS) document.removeEventListener(type, schedule, true);
    for (const type of LEAVE_EVENTS) document.removeEventListener(type, cancel, true);
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    const router = readRouter();
    for (const anchor of observed) router?.unobserveForPrefetch?.(anchor);
    observed.clear();
  };
}
