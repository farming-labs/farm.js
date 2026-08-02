"use client";

import type { FarmIslandStrategy } from "../island";

export interface ScheduleFarmIslandHydrationOptions<T> {
  container: Element;
  strategy?: FarmIslandStrategy | null;
  signal?: AbortSignal;
  hydrate: () => T | Promise<T>;
}

interface FarmQueuedClick {
  target?: EventTarget | null;
}

function getPreHydrationClickQueue(): FarmQueuedClick[] | null {
  const windowWithQueue = window as typeof window & {
    __FARM_PREHYDRATION_CLICK_QUEUE__?: FarmQueuedClick[];
  };
  return Array.isArray(windowWithQueue.__FARM_PREHYDRATION_CLICK_QUEUE__)
    ? windowWithQueue.__FARM_PREHYDRATION_CLICK_QUEUE__
    : null;
}

function findQueuedTarget(container: Element): Element | null {
  const queue = getPreHydrationClickQueue();
  if (!queue) return null;
  for (const item of queue) {
    if (item?.target instanceof Element && container.contains(item.target)) return item.target;
  }
  return null;
}

function takeQueuedTargets(container: Element): Element[] {
  const queue = getPreHydrationClickQueue();
  if (!queue) return [];

  const targets: Element[] = [];
  for (let index = queue.length - 1; index >= 0; index--) {
    const target = queue[index]?.target;
    if (!(target instanceof Element) || !container.contains(target)) continue;
    queue.splice(index, 1);
    targets.unshift(target);
  }
  return targets;
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

function finishIslandHydration(container: Element, activatingTarget?: Element | null): void {
  container.setAttribute("data-farm-island-hydrated", "true");

  const targets = new Set<Element>();
  if (activatingTarget?.isConnected) targets.add(activatingTarget);
  for (const target of takeQueuedTargets(container)) if (target.isConnected) targets.add(target);

  for (const target of targets) window.setTimeout(() => replayClick(target), 0);
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
        if (!signal?.aborted) finishIslandHydration(container);
        return value;
      });
  }

  return new Promise<T | undefined>((resolve, reject) => {
    let started = false;
    let cancelled = false;
    let queuedClickTarget: Element | null = null;
    const triggerCleanups = new Set<() => void>();
    let removeAbortListener: (() => void) | null = null;

    const cleanupTriggers = () => {
      for (const dispose of triggerCleanups) dispose();
      triggerCleanups.clear();
    };
    const cleanup = () => {
      cleanupTriggers();
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
            const target = queuedClickTarget;
            queuedClickTarget = null;
            finishIslandHydration(container, target);
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

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) start();
        },
        { rootMargin: "200px" },
      );
      observer.observe(container);
      triggerCleanups.add(() => observer.disconnect());
      return;
    }

    const queueActivatingClick = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest(
              'button,[role="button"],input[type="button"],input[type="submit"],input[type="reset"]',
            )
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
      queuedClickTarget ??= target;
      event.preventDefault();
      event.stopImmediatePropagation();
      start();
    };
    const activateFromQueuedClick = (event: Event) => {
      const target = (event as CustomEvent<{ target?: EventTarget | null }>).detail?.target;
      if (!(target instanceof Element) || !container.contains(target)) return;

      queuedClickTarget ??= target;
      start();
    };

    document.addEventListener("click", queueActivatingClick, true);
    triggerCleanups.add(() => document.removeEventListener("click", queueActivatingClick, true));
    document.addEventListener("farm:island-interaction", activateFromQueuedClick);
    triggerCleanups.add(() =>
      document.removeEventListener("farm:island-interaction", activateFromQueuedClick),
    );

    const queuedTarget = findQueuedTarget(container);
    if (queuedTarget) {
      queuedClickTarget = queuedTarget;
      start();
    }
  });
}
