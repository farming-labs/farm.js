"use client";

import {
  FARM_ISLAND_ACTIVATION_EVENTS,
  FARM_ISLAND_REPLAYABLE_SELECTOR,
  type FarmIslandReplayKind,
  type FarmIslandStrategy,
} from "../island";
import { observeIslandVisibility } from "./island-triggers";

export interface ScheduleFarmIslandHydrationOptions<T> {
  container: Element;
  strategy?: FarmIslandStrategy | null;
  signal?: AbortSignal;
  hydrate: () => T | Promise<T>;
}

interface FarmQueuedClick {
  target?: EventTarget | null;
  /** Absent on entries written before kinds existed, which were all clicks. */
  kind?: FarmIslandReplayKind | null;
}

interface FarmQueuedInteraction {
  target: Element;
  kind: FarmIslandReplayKind;
}

function toReplayKind(value: unknown): FarmIslandReplayKind {
  return value === "submit" ? "submit" : "click";
}

function getPreHydrationClickQueue(): FarmQueuedClick[] | null {
  const windowWithQueue = window as typeof window & {
    __FARM_PREHYDRATION_CLICK_QUEUE__?: FarmQueuedClick[];
  };
  return Array.isArray(windowWithQueue.__FARM_PREHYDRATION_CLICK_QUEUE__)
    ? windowWithQueue.__FARM_PREHYDRATION_CLICK_QUEUE__
    : null;
}

function hasQueuedTarget(container: Element): boolean {
  const queue = getPreHydrationClickQueue();
  return !!queue?.some(
    (item) => item?.target instanceof Element && container.contains(item.target),
  );
}

/** Whether replaying `target` submits a form: a held submit, or a click on a submit button. */
function submitsForm({ target, kind }: FarmQueuedInteraction): boolean {
  if (kind === "submit") return true;
  const control = target as Element & { form?: HTMLFormElement | null; type?: string };
  return !!control.form && control.type === "submit";
}

function takeQueuedTargets(container: Element): FarmQueuedInteraction[] {
  const queue = getPreHydrationClickQueue();
  if (!queue) return [];

  const interactions: FarmQueuedInteraction[] = [];
  for (let index = queue.length - 1; index >= 0; index--) {
    const item = queue[index];
    const target = item?.target;
    if (!(target instanceof Element) || !container.contains(target)) continue;
    queue.splice(index, 1);
    interactions.unshift({ target, kind: toReplayKind(item?.kind) });
  }
  return interactions;
}

function runWhenIdle(callback: () => void): () => void {
  const windowWithIdleCallback = window as typeof window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof windowWithIdleCallback.requestIdleCallback === "function") {
    const handle = windowWithIdleCallback.requestIdleCallback(callback, { timeout: 2_000 });
    return () => windowWithIdleCallback.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 1);
  return () => window.clearTimeout(handle);
}

/**
 * The element a click before hydration is held on: a control, or a same-page link, whose handler
 * the island may need (a table of contents marking its heading). Any other link navigates.
 */
export function heldClickTarget(target: Element): Element | null {
  const link = target.closest("a[href]");
  if (link) return link.getAttribute("href")?.startsWith("#") ? link : null;
  return target.closest(FARM_ISLAND_REPLAYABLE_SELECTOR);
}

function replayClick(target: Element): void {
  const clickable = target as Element & { click?: () => void };
  if (typeof clickable.click === "function") {
    clickable.click();
    return;
  }
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/**
 * Reproduce a held submit. requestSubmit() dispatches a real submit event, so a
 * framework handler bound during hydration sees it and validation still runs.
 * form.submit() would bypass both, so it is deliberately not used as a
 * fallback; dispatching the event directly is closer to the original action.
 */
function replaySubmit(target: Element): void {
  const form = target as Element & { requestSubmit?: () => void };
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
    return;
  }
  target.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function replayInteraction(interaction: FarmQueuedInteraction): void {
  if (interaction.kind === "submit") {
    replaySubmit(interaction.target);
    return;
  }
  replayClick(interaction.target);
}

/**
 * Reproduce one entry of the pre-hydration queue as the kind of interaction it
 * was. Every path that drains the queue has to use this: a held submit
 * replayed as a click does nothing, because click() on a form is a no-op.
 */
export function replayFarmQueuedInteraction(target: Element, kind: unknown): void {
  replayInteraction({ target, kind: toReplayKind(kind) });
}

/**
 * Holds clicks and submits on islands that have not hydrated in the pre-hydration queue, as the
 * boot script does, until the returned function runs. Islands mode's entry holds them while islx
 * loads (RFC 0010): the boot stops holding once the entry runs, and each island's scheduler starts
 * it and replays them when it reaches it. `island` is the islands' element name.
 */
export function holdFarmIslandInteractions(island: string): () => void {
  const scope = window as typeof window & { __FARM_PREHYDRATION_CLICK_QUEUE__?: FarmQueuedClick[] };
  const queue = (scope.__FARM_PREHYDRATION_CLICK_QUEUE__ ??= []);
  const pending = (node: Element) =>
    !!node.closest(island) && !node.closest('[data-farm-island-hydrated="true"]');
  const hold = (event: Event, target: Element, kind: FarmIslandReplayKind) => {
    const interaction = { target, kind };
    // Every click is replayed; a form is submitted once (as the scheduler's own hold).
    if (!submitsForm(interaction) || !queue.some((item) => item?.target === target)) {
      queue.push(interaction);
      document.dispatchEvent(
        new CustomEvent("farm:island-interaction", { detail: { target, kind } }),
      );
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onClick = (event: Event) => {
    const click = event as MouseEvent;
    if (click.defaultPrevented || click.button !== 0) return;
    if (click.metaKey || click.altKey || click.ctrlKey || click.shiftKey) return;
    const target = click.target instanceof Element ? heldClickTarget(click.target) : null;
    if (target && pending(target)) hold(event, target, "click");
  };
  const onSubmit = (event: Event) => {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof Element) || form.nodeName !== "FORM") return;
    if (pending(form)) hold(event, form, "submit");
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("submit", onSubmit, true);
  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("submit", onSubmit, true);
  };
}

/**
 * Calls `due` once an island under `scope` reaches its trigger, by the rules the boot script and
 * the scheduler follow, without holding or replaying anything. Islands mode's entry loads islx then
 * (RFC 0010), and islx's schedulers take over: a held interaction is in the queue they read, and a
 * trigger that fired fires again for them. A form counts as the boot counts it, as islx is what
 * posts it without a page load. Returns null when an island is due already (it hydrates at load,
 * holds an interaction, or is not observable) or a Suspense boundary waits for the browser, else a
 * function that stops watching.
 */
export function watchFarmIslandTriggers(
  scope: Document | Element,
  island: string,
  due: () => void,
): (() => void) | null {
  const document = scope.nodeType === 9 ? (scope as Document) : (scope as Element).ownerDocument;
  // A document still parsing adds islands later, which islx's stream watcher finds.
  if (document.readyState === "loading") return null;
  const comments = document.createTreeWalker(scope, NodeFilter.SHOW_COMMENT);
  while (comments.nextNode()) {
    const data = (comments.currentNode as Comment).data;
    if (data === "$?" || data === "$!") return null;
  }
  const islands = Array.from(scope.querySelectorAll(island));
  if (scope.nodeType === 1 && (scope as Element).matches(island)) islands.unshift(scope as Element);
  // An island inside another hydrates with it, as islx decides.
  const outermost = islands.filter((element) => {
    const outer = element.parentElement?.closest(island);
    return !outer || !scope.contains(outer);
  });
  const isDue = (element: Element) => {
    const strategy = element.getAttribute("strategy");
    if (hasQueuedTarget(element)) return true;
    if (strategy === "interaction" || strategy === "idle") return false;
    if (strategy !== "visible" || typeof IntersectionObserver !== "function") return true;
    // Islands render with display:contents: the scheduler observes their children instead.
    return element.getClientRects().length === 0 && element.children.length === 0;
  };
  if (outermost.some(isDue)) return null;

  const cleanups: Array<() => void> = [];
  const stop = () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
  const fire = () => {
    stop();
    due();
  };
  if (outermost.some((element) => element.getAttribute("strategy") === "idle")) {
    cleanups.push(runWhenIdle(fire));
  }
  for (const element of outermost) {
    if (element.getAttribute("strategy") !== "visible") continue;
    const targets = element.getClientRects().length > 0 ? [element] : Array.from(element.children);
    cleanups.push(observeIslandVisibility(document, targets, fire));
  }

  const pending = (target: EventTarget | null | undefined) =>
    target instanceof Element &&
    scope.contains(target) &&
    !!target.closest(island) &&
    !target.closest('[data-farm-island-hydrated="true"]');
  // A press or focus starts an island, not on a link that navigates (the scheduler's
  // observeActivation); clicks and submits reach here as the hold's announcements.
  const activate = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || !scope.contains(target)) return;
    const link = target.closest("a[href]");
    if (link && !link.getAttribute("href")?.startsWith("#")) return;
    if (pending(target) || target.closest("form")) fire();
  };
  const announced = (event: Event) => {
    if (pending((event as CustomEvent<{ target?: EventTarget | null }>).detail?.target)) fire();
  };
  const listen = (type: string, handler: (event: Event) => void, capture: boolean) => {
    document.addEventListener(type, handler, capture);
    cleanups.push(() => document.removeEventListener(type, handler, capture));
  };
  listen("pointerdown", activate, true);
  listen("focusin", activate, true);
  listen("farm:island-interaction", announced, false);
  return stop;
}

function finishIslandHydration(
  container: Element,
  held: readonly FarmQueuedInteraction[] = [],
): void {
  // What the pre-hydration script or the boot script queued, then what this scheduler held, in
  // the order they happened. Each is its own event, so every click is replayed.
  const interactions = [...takeQueuedTargets(container), ...held].filter(
    (interaction) => interaction.target.isConnected,
  );

  if (!container.isConnected) return;
  container.setAttribute("data-farm-island-hydrated", "true");

  for (const interaction of interactions) {
    window.setTimeout(() => {
      if (
        container.getAttribute("data-farm-island-hydrated") === "true" &&
        container.isConnected &&
        interaction.target.isConnected &&
        container.contains(interaction.target)
      ) {
        replayInteraction(interaction);
      }
    }, 0);
  }
}

/**
 * Defer importing and hydrating a server-rendered client boundary until its
 * configured trigger. The returned promise resolves with the hydration result.
 */
export function scheduleFarmIslandHydration<T>({
  container,
  strategy,
  signal,
  hydrate,
}: ScheduleFarmIslandHydrationOptions<T>): Promise<T | undefined> {
  const resolvedStrategy = strategy ?? "load";
  if (signal?.aborted) return Promise.resolve(undefined);

  return new Promise<T | undefined>((resolve, reject) => {
    let started = false;
    let cancelled = false;
    // What this scheduler held itself. An interaction the pre-hydration or boot script held is in
    // their queue, which finishIslandHydration reads.
    const held: FarmQueuedInteraction[] = [];
    // One-shot triggers, dropped the moment hydration starts: an
    // IntersectionObserver or an idle callback has no reason to fire twice.
    const triggerCleanups = new Set<() => void>();
    // Interaction capture, from scheduling until hydration finishes, whatever the strategy: the
    // server HTML is on screen and clickable all that time. A pointerdown or a focusin starts
    // hydration, and in a real browser the click the user is actually making arrives a moment
    // later, still before the chunk has loaded. Tearing these down at start() would drop that
    // click on the floor with nothing left to hold or replay it.
    const captureCleanups = new Set<() => void>();
    let removeAbortListener: (() => void) | null = null;

    const cleanupTriggers = () => {
      for (const dispose of triggerCleanups) dispose();
      triggerCleanups.clear();
    };
    const cleanupCaptures = () => {
      for (const dispose of captureCleanups) dispose();
      captureCleanups.clear();
    };
    const cleanup = () => {
      cleanupTriggers();
      cleanupCaptures();
      removeAbortListener?.();
      removeAbortListener = null;
    };

    const start = () => {
      if (started || cancelled) return;
      started = true;
      cleanupTriggers();
      Promise.resolve()
        // Removed in the same task it was scheduled in, as a navigation does: never hydrated.
        .then(() => (cancelled || signal?.aborted ? undefined : hydrate()))
        .then(
          (value) => {
            cleanup();
            if (cancelled || signal?.aborted) return;
            finishIslandHydration(container, held.splice(0));
            resolve(value);
          },
          (error) => {
            cleanup();
            reject(error);
          },
        );
    };

    if (signal) {
      const abort = () => {
        cancelled = true;
        cleanup();
        takeQueuedTargets(container);
        resolve(undefined);
      };
      signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", abort);
    }

    const hold = (event: Event, target: Element, kind: FarmIslandReplayKind) => {
      const interaction = { target, kind };
      // Every click is replayed, so two on a counter count two. A form is submitted once: a
      // repeat is held so it never posts natively ahead of the replay, and not held again.
      if (!submitsForm(interaction) || !held.some((item) => item.target === target)) {
        held.push(interaction);
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      start();
    };

    const queueActivatingClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? heldClickTarget(event.target) : null;
      if (
        !target ||
        !container.contains(target) ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }
      hold(event, target, "click");
    };

    // A form whose only control is a text field has no button to click, so
    // pressing Enter used to leave the island unhydrated forever.
    const queueActivatingSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof Element) || form.nodeName !== "FORM") return;
      if (!container.contains(form) || event.defaultPrevented) return;
      hold(event, form, "submit");
    };

    // Observed, not held. These start hydration early so a controlled input has
    // its handlers attached before the value diverges, while letting the native
    // interaction through: swallowing a keystroke or a toggle would be worse
    // than hydrating late. A link that navigates is left alone, as its click
    // is (heldClickTarget): pressing or focusing it would only load the code of
    // the page it leaves, and race the navigation for the network.
    const observeActivation = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !container.contains(target)) return;
      const link = target.closest("a[href]");
      if (link && !link.getAttribute("href")?.startsWith("#")) return;
      start();
    };

    const activateFromInteraction = (event: Event) => {
      const detail = (
        event as CustomEvent<{ target?: EventTarget | null; kind?: FarmIslandReplayKind | null }>
      ).detail;
      const target = detail?.target;
      if (!(target instanceof Element) || !container.contains(target)) return;

      // A held interaction is in the queue the announcing script wrote; a null kind means it only
      // observed the interaction and let it through. Either way there is nothing to record here.
      start();
    };

    const listen = (type: string, handler: (event: Event) => void, capture: boolean) => {
      document.addEventListener(type, handler, capture);
      captureCleanups.add(() => document.removeEventListener(type, handler, capture));
    };

    // Keyed by the shared activation set, so adding an event there without
    // handling it here fails to compile rather than silently listening to
    // nothing on this side of the handoff.
    const activationHandlers: Record<
      (typeof FARM_ISLAND_ACTIVATION_EVENTS)[number],
      (event: Event) => void
    > = {
      click: queueActivatingClick as (event: Event) => void,
      submit: queueActivatingSubmit,
      pointerdown: observeActivation,
      focusin: observeActivation,
    };

    for (const type of FARM_ISLAND_ACTIVATION_EVENTS) {
      listen(type, activationHandlers[type], true);
    }
    listen("farm:island-interaction", activateFromInteraction, false);

    // Then what starts it: at once, or its idle callback or visibility, as its strategy says, or a
    // held interaction. An interaction island waits for its activation above.
    if (resolvedStrategy === "load" || hasQueuedTarget(container)) {
      start();
      return;
    }

    if (resolvedStrategy === "idle") {
      triggerCleanups.add(runWhenIdle(start));
      return;
    }

    if (resolvedStrategy === "visible") {
      if (typeof IntersectionObserver !== "function") {
        start();
        return;
      }

      // Isolated boundary markers render with display:contents, so the
      // container itself has no box and can never intersect. Observe its
      // element children instead; with nothing observable, start now.
      const targets =
        container.getClientRects().length > 0 ? [container] : Array.from(container.children);
      if (targets.length === 0) {
        start();
        return;
      }

      triggerCleanups.add(observeIslandVisibility(container.ownerDocument, targets, start));
      return;
    }
  });
}
