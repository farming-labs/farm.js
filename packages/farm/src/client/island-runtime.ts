"use client";

import {
  FARM_ISLAND_ACTIVATION_EVENTS,
  FARM_ISLAND_REPLAYABLE_SELECTOR,
  type FarmIslandReplayKind,
  type FarmIslandStrategy,
} from "../island";

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

function findQueuedTarget(container: Element): FarmQueuedInteraction | null {
  const queue = getPreHydrationClickQueue();
  if (!queue) return null;
  for (const item of queue) {
    if (item?.target instanceof Element && container.contains(item.target)) {
      return { target: item.target, kind: toReplayKind(item.kind) };
    }
  }
  return null;
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

function finishIslandHydration(
  container: Element,
  activating?: FarmQueuedInteraction | null,
): void {
  const interactions = new Map<Element, FarmQueuedInteraction>();
  if (activating?.target.isConnected) interactions.set(activating.target, activating);
  for (const interaction of takeQueuedTargets(container)) {
    if (interaction.target.isConnected) interactions.set(interaction.target, interaction);
  }

  if (!container.isConnected) return;
  container.setAttribute("data-farm-island-hydrated", "true");

  for (const interaction of interactions.values()) {
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
    let queuedInteraction: FarmQueuedInteraction | null = null;
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
            const activating = queuedInteraction;
            queuedInteraction = null;
            finishIslandHydration(container, activating);
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

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) start();
        },
        { rootMargin: "200px" },
      );
      for (const target of targets) observer.observe(target);
      triggerCleanups.add(() => observer.disconnect());
      return;
    }

    const hold = (event: Event, target: Element, kind: FarmIslandReplayKind) => {
      queuedInteraction ??= { target, kind };
      event.preventDefault();
      event.stopImmediatePropagation();
      start();
    };

    const queueActivatingClick = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest(FARM_ISLAND_REPLAYABLE_SELECTOR)
          : null;
      if (
        !target ||
        !container.contains(target) ||
        target.closest("a[href]") ||
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

      // A null kind means the inline script only observed the interaction and
      // let it through, so there is nothing to reproduce afterwards.
      if (detail?.kind) queuedInteraction ??= { target, kind: toReplayKind(detail.kind) };
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

    const queued = findQueuedTarget(container);
    if (queued) {
      queuedInteraction = queued;
      start();
    }
  });
}
