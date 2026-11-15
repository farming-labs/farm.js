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

  if (resolvedStrategy === "load") {
    return Promise.resolve()
      .then(() => (signal?.aborted ? undefined : hydrate()))
      .then((value) => {
        if (signal?.aborted) return undefined;
        finishIslandHydration(container);
        return value;
      });
  }

  return new Promise<T | undefined>((resolve, reject) => {
    let started = false;
    let cancelled = false;
    // What this scheduler held itself. An interaction the pre-hydration or boot script held is in
    // their queue, which finishIslandHydration reads.
    const held: FarmQueuedInteraction[] = [];
    // One-shot triggers, dropped the moment hydration starts: an
    // IntersectionObserver or an idle callback has no reason to fire twice.
    const triggerCleanups = new Set<() => void>();
    // Interaction capture, kept until hydration finishes. A pointerdown or a
    // focusin starts hydration, and in a real browser the click the user is
    // actually making arrives a moment later, still before the chunk has
    // loaded. Tearing these down at start() would drop that click on the floor
    // with nothing left to hold or replay it.
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
        .then(hydrate)
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
    // than hydrating late.
    const observeActivation = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !container.contains(target)) return;
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

    if (hasQueuedTarget(container)) start();
  });
}
