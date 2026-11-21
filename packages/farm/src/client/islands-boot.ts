/**
 * @internal Islands mode's entry for a document in which nothing hydrates at load (RFC 0003,
 * section 10). It loads the client runtime (React, islx, the router) when the page first needs it:
 * an island's own trigger, or intent to follow a link. Until then it holds the clicks and submits
 * that would be lost (in an island that has not hydrated, or on a link), and the runtime replays
 * them: islands through the pre-hydration queue its scheduler reads, links on the same element.
 *
 * It imports nothing at runtime, and runs the client entry from the URL the server wrote on its
 * script: a module it shared with the entry, or an import of the entry itself, would change how
 * the entry splits into chunks, and every page that loads the runtime at once would pay for it.
 */
import type { FarmIslandReplayKind } from "../island";

/** Kept equal to FARM_ISLAND_REPLAYABLE_SELECTOR (island.ts); a test compares them. */
export const FARM_ISLANDS_BOOT_REPLAYABLE_SELECTOR =
  'button,[role="button"],input[type="button"],input[type="submit"],input[type="reset"]';
/** Kept equal to the island scheduler's visibility margin (island-triggers.ts). */
export const FARM_ISLANDS_BOOT_VISIBLE_MARGIN = "200px";

interface FarmQueuedInteraction {
  target: Element;
  kind: FarmIslandReplayKind;
  createdAt: number;
}

/**
 * @internal The request for a link clicked before the runtime ran, which the boot sends with the
 * click (`window.__FARM_EARLY_NAVIGATION__`). The router's next navigation request takes the
 * response when it would send the same request, and drops it otherwise.
 */
export interface FarmEarlyNavigation {
  /** The absolute URL requested. */
  url: string;
  /** The request's headers, names in lower case. */
  headers: Record<string, string>;
  response: Promise<Response>;
  /** When the request was sent (`Date.now()`). */
  at: number;
  /** Aborts the request. */
  controller: AbortController;
}

/** Kept equal to the routers' deployment header (FARM_DEPLOYMENT_ID_HEADER); a test compares them. */
export const FARM_ISLANDS_BOOT_DEPLOYMENT_HEADER = "x-farm-deployment-id";

const ISLAND = "f-island";
const HYDRATED_ISLAND = '[data-farm-island-hydrated="true"]';

/** Whether replaying `target` submits a form: a held submit, or a click on a submit button. */
function submitsForm(target: Element, kind: FarmIslandReplayKind): boolean {
  if (kind === "submit") return true;
  const control = target as Element & { form?: HTMLFormElement | null; type?: string };
  return !!control.form && control.type === "submit";
}

function isModified(event: MouseEvent): boolean {
  return event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;
}

/** The element a click is held on: as the island scheduler's heldClickTarget (island-runtime.ts). */
function heldClickTarget(target: Element): Element | null {
  const link = target.closest("a[href]");
  if (link) return link.getAttribute("href")?.startsWith("#") ? link : null;
  return target.closest(FARM_ISLANDS_BOOT_REPLAYABLE_SELECTOR);
}

/**
 * The island `node` is in, or the page's root when the route hydrates as one root that waits,
 * while that island or root has not hydrated yet.
 */
function pendingIsland(node: Element, root: Element | null): Element | null {
  if (node.closest(HYDRATED_ISLAND)) return null;
  return node.closest(ISLAND) ?? (root?.contains(node) ? root : null);
}

/** A link the router navigates to: the same checks as its click handler. */
function routedLink(target: EventTarget | null): HTMLAnchorElement | null {
  const anchor = target instanceof Element ? target.closest("a") : null;
  const href = anchor?.getAttribute("href");
  if (!anchor || !href) return null;
  if (anchor.hasAttribute("download") || href.startsWith("#") || href.startsWith("//")) return null;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  return anchor;
}

/**
 * Runs the client entry the server named on the boot script (`data-farm-runtime`) as a module
 * script, as a document that loads it at once does: the same URL, so the same module. A script
 * element rather than import(), which the bundler would wrap in a helper the entry shares.
 */
function loadFarmClientEntry(): Promise<void> {
  const boot = document.querySelector<HTMLScriptElement>("script[data-farm-runtime]");
  const src = boot?.dataset.farmRuntime;
  if (!boot || !src) {
    return Promise.reject(new Error("The boot script has no data-farm-runtime attribute."));
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = src;
    if (boot.nonce) script.nonce = boot.nonce;
    // A module script's load event fires once it has run.
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`The client runtime at ${src} failed to load.`)),
      { once: true },
    );
    document.head.append(script);
  });
}

/** Starts the runtime when the page first needs it. `load` runs it; it starts as it runs. */
export function startFarmIslandsBoot(load: () => Promise<unknown> = loadFarmClientEntry): void {
  const queue = ((
    window as Window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown[] }
  ).__FARM_PREHYDRATION_CLICK_QUEUE__ ??= []) as FarmQueuedInteraction[];
  const cleanups: Array<() => void> = [];
  let loading: Promise<unknown> | undefined;
  // A route that hydrates as one root that waits (RFC 0003, section 11): the server names the root
  // element and its strategy on this script, and the root is held and triggered like an island.
  const script = document.querySelector<HTMLScriptElement>("script[data-farm-runtime]");
  const rootId = script?.dataset.farmRoot;
  const root = rootId ? document.getElementById(rootId) : null;
  // What the runtime imports as it starts, which the server lists relative to it, fetched with it
  // rather than each a round trip after the file that imports it: the entry's imports
  // (data-farm-preload), the router a link's intent loads (-router), and the modules a root that
  // waits for a click hydrates with (-root). A file listed twice is fetched once.
  const preloaded = new Set<string>();
  const preload = (group: "farmPreload" | "farmPreloadRouter" | "farmPreloadRoot") => {
    const files = script?.dataset[group];
    if (!script || !files || preloaded.has(group)) return;
    preloaded.add(group);
    const base = new URL(script.dataset.farmRuntime ?? "", document.baseURI);
    for (const file of files.split(" ")) {
      const link = document.createElement("link");
      link.rel = "modulepreload";
      link.href = new URL(file, base).href;
      if (script.nonce) link.nonce = script.nonce;
      document.head.append(link);
    }
  };

  // The runtime holds and replays from here on: its scheduler for islands, its router for links.
  // A capture left in place would hold clicks it never replays, and one left after a failed load
  // would hold them forever, so either way the page goes back to native behavior.
  const release = () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
  const start = (): Promise<unknown> => {
    preload("farmPreload");
    if (!loading) {
      loading = load().then(release, (error: unknown) => {
        release();
        throw error;
      });
      loading.catch((error: unknown) => {
        console.error("[Farm.js] The client runtime failed to load.", error);
      });
    }
    return loading;
  };
  // What an interaction on `target` needs besides the entry: the router for a link, and the
  // modules of a root that waits around it, which hydrates on it (a link's hover included).
  const forTarget = (target: Element) => {
    if (routedLink(target)) preload("farmPreloadRouter");
    if (root && pendingIsland(target, root) === root) preload("farmPreloadRoot");
  };
  const listen = (type: string, handler: (event: Event) => void, capture: boolean) => {
    document.addEventListener(type, handler, capture);
    cleanups.push(() => document.removeEventListener(type, handler, capture));
  };

  const hold = (event: Event, target: Element, kind: FarmIslandReplayKind) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    // Every click is replayed, so two on a counter count two. A form is submitted once: a repeat
    // is held so it never posts natively ahead of the replay, and not queued again.
    if (!submitsForm(target, kind) || !queue.some((item) => item.target === target)) {
      queue.push({ target, kind, createdAt: Date.now() });
      // An interaction island's scheduler, when it already runs, starts on this.
      document.dispatchEvent(
        new CustomEvent("farm:island-interaction", { detail: { target, kind } }),
      );
    }
    void start();
    forTarget(target);
  };

  listen(
    "click",
    (event) => {
      const click = event as MouseEvent;
      if (click.defaultPrevented || click.button !== 0 || isModified(click)) return;
      const target = click.target instanceof Element ? heldClickTarget(click.target) : null;
      if (!target || !pendingIsland(target, root)) return;
      hold(event, target, "click");
    },
    true,
  );
  listen(
    "submit",
    (event) => {
      const form = event.target;
      if (event.defaultPrevented || !(form instanceof Element) || form.nodeName !== "FORM") return;
      // A form outside islands posts natively, as it does before any JavaScript runs.
      if (pendingIsland(form, root)) hold(event, form, "submit");
    },
    true,
  );

  // Observed, not held: these start loading and the interaction goes through. An island activates
  // on a press or focus, as its scheduler does, and so does a form, which then posts without a
  // page load once the runtime runs; a link also on hover, the earliest sign of intent.
  const observe = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      routedLink(target) ||
      (event.type !== "mouseover" && (pendingIsland(target, root) || target.closest("form")))
    ) {
      void start();
      forTarget(target);
    }
  };
  for (const type of ["pointerdown", "focusin", "mouseover"]) listen(type, observe, true);

  // The page a held click goes to is requested with the click, alongside the runtime, rather than
  // a round trip after it runs. The headers are the ones the router sends for that navigation from
  // this document: the layouts it shows, and the tree a root that hydrates renders the next page
  // into, or else flush markers for a page that streams. The island values the router holds
  // (F-Values) are left out, so the server sends every value the page needs.
  const requestPage = (href: string) => {
    const headers: Record<string, string> = { accept: "text/html" };
    const layouts = Array.from(
      (document.getElementById("root") ?? document.body).querySelectorAll(
        '[data-farm-layout-boundary="true"]',
      ),
      (boundary) =>
        boundary.getAttribute("data-farm-layout-key") ||
        boundary.getAttribute("data-farm-layout-pattern"),
    ).filter(Boolean);
    if (layouts.length) headers["f-layouts"] = JSON.stringify(layouts);
    if (rootId === "root") headers["f-render"] = "tree";
    else headers["f-stream"] = "flush";
    const scope = window as Window & {
      __FARM_DEPLOYMENT_ID__?: string;
      __FARM_EARLY_NAVIGATION__?: FarmEarlyNavigation;
    };
    if (scope.__FARM_DEPLOYMENT_ID__) {
      headers[FARM_ISLANDS_BOOT_DEPLOYMENT_HEADER] = scope.__FARM_DEPLOYMENT_ID__;
    }
    const controller = new AbortController();
    const response = fetch(href, { headers, redirect: "manual", signal: controller.signal });
    // A request the router does not take is aborted, which is not an error.
    response.catch(() => {});
    scope.__FARM_EARLY_NAVIGATION__ = { url: href, headers, response, at: Date.now(), controller };
  };

  // A link clicked before the runtime runs: held, then clicked again once the router listens, so
  // it decides as for any click. Bubble phase, like the router, so a handler that prevents the
  // default first still wins.
  listen(
    "click",
    (event) => {
      const click = event as MouseEvent;
      if (click.defaultPrevented || click.button !== 0 || isModified(click)) return;
      const anchor = routedLink(click.target);
      if (!anchor) return;
      click.preventDefault();
      requestPage(anchor.href);
      start().then(
        () => {
          if (anchor.isConnected) {
            anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          } else location.assign(anchor.href);
        },
        () => location.assign(anchor.href),
      );
      forTarget(anchor);
    },
    false,
  );

  // Each island's own trigger. An island that hydrates at load, or a Suspense boundary the browser
  // must finish (still streaming, or one the server gave up on), starts the runtime at once.
  const visibility =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) void start();
          },
          { rootMargin: FARM_ISLANDS_BOOT_VISIBLE_MARGIN },
        )
      : null;
  if (visibility) cleanups.push(() => visibility.disconnect());
  let idle = false;
  const startWhenIdle = () => {
    if (idle) return;
    idle = true;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    // The same timing as the island scheduler's idle trigger.
    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(() => void start(), { timeout: 2_000 });
      cleanups.push(() => idleWindow.cancelIdleCallback?.(handle));
    } else {
      const handle = window.setTimeout(() => void start(), 1);
      cleanups.push(() => window.clearTimeout(handle));
    }
  };
  // Islands render with display:contents, so observe their children, as the scheduler does. They
  // are judged once parsed: a streamed island's children may not have arrived when it does.
  const parsedVisible: Element[] = [];
  const observeVisible = (island: Element) => {
    const targets = island.getClientRects().length > 0 ? [island] : Array.from(island.children);
    if (!visibility || targets.length === 0) void start();
    else for (const target of targets) visibility.observe(target);
  };
  const considerIsland = (island: Element) => {
    if (island.parentElement?.closest(ISLAND)) return;
    const strategy = island.getAttribute("strategy");
    if (strategy === "interaction") return;
    if (strategy === "idle") startWhenIdle();
    else if (strategy !== "visible") void start();
    else if (document.readyState === "loading") parsedVisible.push(island);
    else observeVisible(island);
  };
  const consider = (node: Node) => {
    if (loading) return;
    if (node.nodeType === Node.COMMENT_NODE) {
      const data = (node as Comment).data;
      if (data === "$?" || data === "$!") void start();
    } else if (node instanceof Element) {
      if (node.matches(ISLAND)) considerIsland(node);
      for (const island of Array.from(node.querySelectorAll(ISLAND))) considerIsland(island);
    }
  };
  const comments = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  while (!loading && comments.nextNode()) consider(comments.currentNode);
  consider(document.documentElement);
  if (rootId && !root) void start();
  else if (root && !loading) {
    const strategy = script?.dataset.farmRootStrategy;
    if (strategy === "idle") startWhenIdle();
    else if (strategy === "visible") observeVisible(root);
    else if (strategy !== "interaction") void start();
  }

  // A document still streaming (farm dev streams every page): islands and boundaries the parser
  // adds later are judged as they arrive, and visible ones once the document is parsed.
  if (!loading && document.readyState === "loading") {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) consider(node);
      }
    });
    observer.observe(document, { childList: true, subtree: true });
    const parsed = () => {
      observer.disconnect();
      for (const island of parsedVisible.splice(0)) if (!loading) observeVisible(island);
    };
    document.addEventListener("DOMContentLoaded", parsed, { once: true });
    cleanups.push(() => {
      observer.disconnect();
      document.removeEventListener("DOMContentLoaded", parsed);
    });
  }
}
