"use client";

import {
  isDataSaving,
  isPathAllowed,
  PREFETCH_ATTRIBUTE,
  readNavigableHref,
  readPrefetchMode,
} from "./policy.js";
import type { PrefetchMode, PrefetchRuntime, ResolvedPrefetchOptions } from "./types.js";

/** The router surface this runtime uses. The framework router
 * (`FarmClientPluginRouter`) satisfies it. Without `prefetch` the runtime
 * stays off; without `observeForPrefetch`, `"viewport"` links are skipped. */
export interface PrefetchRouter {
  prefetch?(href: string): unknown;
  observeForPrefetch?(element: HTMLAnchorElement): void;
  unobserveForPrefetch?(element: HTMLAnchorElement): void;
}

type RouterWithPrefetch = PrefetchRouter & { prefetch(href: string): unknown };

const ANCHOR_SELECTOR = "a[href]";
const ignore = () => {};

/**
 * Put the plugin's rules in front of `router.prefetch`. Every prefetch in the
 * app calls that one method: `Link`'s intent and render prefetches, the
 * router's viewport queue (which serves `Link` and this plugin), the
 * `prefetch()` helper and this plugin's own links. So `allow`, `deny` and
 * data saving apply to all of them, not only to plain anchors.
 *
 * A blocked prefetch resolves without fetching. Anything the rules do not
 * name, such as a cross-origin href, goes to the router unchanged. Returns
 * the function that takes the rules out again.
 */
export function gateRouterPrefetch(
  router: RouterWithPrefetch,
  options: Pick<ResolvedPrefetchOptions, "allow" | "deny">,
  runtimeWindow: Window & typeof globalThis = window,
): () => void {
  const original = router.prefetch;
  const ownMethod = Object.prototype.hasOwnProperty.call(router, "prefetch");
  let active = true;

  function blocks(href: string): boolean {
    if (isDataSaving(runtimeWindow)) return true;
    let url: URL;
    try {
      url = new URL(href, runtimeWindow.location.href);
    } catch {
      return false;
    }
    if (url.origin !== runtimeWindow.location.origin) return false;
    try {
      return !isPathAllowed(url.pathname, options.allow, options.deny);
    } catch {
      // A path core's route matcher cannot read is not an app route to prefetch.
      return true;
    }
  }

  const gated = (href: string): unknown =>
    active && blocks(href) ? Promise.resolve() : original.call(router, href);
  router.prefetch = gated;

  return () => {
    active = false;
    // A wrapper installed after this one still calls `gated`, which now passes
    // every href through, so only an untouched method is restored.
    if (router.prefetch !== gated) return;
    if (ownMethod) router.prefetch = original;
    else delete (router as PrefetchRouter).prefetch;
  };
}

/**
 * Start the browser runtime for app-wide link prefetching.
 *
 * Plain same-origin anchors (rendered HTML, Markdown, CMS content) get the
 * same prefetch modes as core `Link`, and every prefetch goes through the
 * router: `router.prefetch` for intent and render, `router.observeForPrefetch`
 * for viewport. Fetching, caching, dedupe and the viewport queue stay in core.
 *
 * - `allow`, `deny` and data saving apply to every router prefetch, `Link`'s
 *   included (see `gateRouterPrefetch`).
 * - Intent uses one delegated listener per event on the document, so links
 *   added later need no setup.
 * - Viewport and render links are found on start and by a MutationObserver;
 *   a removed viewport link is handed back with `unobserveForPrefetch`.
 * - `Save-Data` or `prefers-reduced-data` at start leaves plain links alone.
 */
export function startPrefetchRuntime(
  options: ResolvedPrefetchOptions,
  runtimeWindow: Window & typeof globalThis = window,
  router?: PrefetchRouter | null,
): PrefetchRuntime {
  if (typeof router?.prefetch !== "function") return { close: ignore };
  // Plain links call the router's own method; their rules are checked below.
  const prefetch = router.prefetch.bind(router);
  const removeGate = gateRouterPrefetch(router as RouterWithPrefetch, options, runtimeWindow);
  if (isDataSaving(runtimeWindow)) return { close: removeGate };
  const observe = router.observeForPrefetch?.bind(router);
  const unobserve = router.unobserveForPrefetch?.bind(router);
  const document = runtimeWindow.document;
  const observed = new Set<HTMLAnchorElement>();
  const rendered = new WeakSet<HTMLAnchorElement>();
  let pending: { anchor: HTMLAnchorElement; timer: number } | null = null;
  let closed = false;

  function modeOf(anchor: HTMLAnchorElement): PrefetchMode {
    return readPrefetchMode(anchor.getAttribute(PREFETCH_ATTRIBUTE), options.mode);
  }

  /** The href to prefetch, or `null` when the click would not be a client
   * navigation to another allowed page. */
  function prefetchHref(anchor: HTMLAnchorElement): string | null {
    // The built-in docs engine navigates with its own runtime.
    if (document.documentElement.dataset.farmDocsRuntime === "true") return null;
    const href = readNavigableHref(anchor);
    if (href === null) return null;
    let url: URL;
    try {
      url = new URL(href, runtimeWindow.location.href);
    } catch {
      return null;
    }
    const here = runtimeWindow.location;
    if (url.pathname === here.pathname && url.search === here.search) return null;
    return isPathAllowed(url.pathname, options.allow, options.deny) ? href : null;
  }

  function prefetchNow(anchor: HTMLAnchorElement): void {
    const href = prefetchHref(anchor);
    if (href === null) return;
    // Like Link: a prefetch that fails leaves the click to fetch the page.
    Promise.resolve()
      .then(() => prefetch(href))
      .then(ignore, ignore);
  }

  function anchorFrom(target: EventTarget | null): HTMLAnchorElement | null {
    if (!(target instanceof runtimeWindow.Element)) return null;
    return target.closest<HTMLAnchorElement>(ANCHOR_SELECTOR);
  }

  function cancelIntent(): void {
    if (pending === null) return;
    runtimeWindow.clearTimeout(pending.timer);
    pending = null;
  }

  function startIntent(event: Event): void {
    const anchor = anchorFrom(event.target);
    if (anchor === null || anchor === pending?.anchor || modeOf(anchor) !== "intent") return;
    cancelIntent();
    const timer = runtimeWindow.setTimeout(() => {
      pending = null;
      prefetchNow(anchor);
    }, options.intentDelayMs);
    pending = { anchor, timer };
  }

  function endIntent(event: Event): void {
    if (pending === null || anchorFrom(event.target) !== pending.anchor) return;
    const next = (event as PointerEvent | FocusEvent).relatedTarget;
    if (next instanceof runtimeWindow.Node && pending.anchor.contains(next)) return;
    cancelIntent();
  }

  function track(anchor: HTMLAnchorElement): void {
    const mode = modeOf(anchor);
    if (mode === "viewport" && observe && !observed.has(anchor) && prefetchHref(anchor)) {
      observed.add(anchor);
      observe(anchor);
    } else if (mode === "render" && !rendered.has(anchor)) {
      rendered.add(anchor);
      prefetchNow(anchor);
    }
  }

  function untrack(anchor: HTMLAnchorElement): void {
    if (observed.delete(anchor)) unobserve?.(anchor);
  }

  function eachAnchor(node: Node, visit: (anchor: HTMLAnchorElement) => void): void {
    if (!(node instanceof runtimeWindow.Element)) return;
    if (node.matches(ANCHOR_SELECTOR)) visit(node as HTMLAnchorElement);
    for (const anchor of node.querySelectorAll<HTMLAnchorElement>(ANCHOR_SELECTOR)) visit(anchor);
  }

  const listeners: Array<[string, (event: Event) => void]> = [
    ["pointerover", startIntent],
    ["focusin", startIntent],
    ["touchstart", startIntent],
    ["pointerout", endIntent],
    ["focusout", endIntent],
  ];
  for (const [type, listener] of listeners) {
    document.addEventListener(type, listener, { passive: true });
  }

  eachAnchor(document.documentElement, track);
  const mutations = new runtimeWindow.MutationObserver((records) => {
    if (closed) return;
    for (const record of records) {
      for (const node of record.removedNodes) eachAnchor(node, untrack);
      for (const node of record.addedNodes) eachAnchor(node, track);
    }
  });
  mutations.observe(document.documentElement, { childList: true, subtree: true });

  return {
    close() {
      if (closed) return;
      closed = true;
      for (const [type, listener] of listeners) document.removeEventListener(type, listener);
      mutations.disconnect();
      for (const anchor of observed) unobserve?.(anchor);
      observed.clear();
      cancelIntent();
      removeGate();
    },
  };
}
