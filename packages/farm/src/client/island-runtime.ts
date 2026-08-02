"use client";

import type { FarmIslandStrategy } from "../island";

export interface ScheduleFarmIslandHydrationOptions<T> {
  container: Element;
  strategy?: FarmIslandStrategy | null;
  hydrate: () => T | Promise<T>;
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

function finishIslandHydration(container: Element, activatingTarget?: HTMLElement | null): void {
  container.setAttribute("data-farm-island-hydrated", "true");

  const windowWithQueue = window as typeof window & {
    __FARM_PREHYDRATION_CLICK_QUEUE__?: Array<{ target?: EventTarget | null }>;
  };
  const queue = windowWithQueue.__FARM_PREHYDRATION_CLICK_QUEUE__;
  const targets = new Set<HTMLElement>();
  if (activatingTarget?.isConnected) targets.add(activatingTarget);

  if (Array.isArray(queue)) {
    for (let index = queue.length - 1; index >= 0; index--) {
      const target = queue[index]?.target;
      if (!(target instanceof HTMLElement) || !container.contains(target)) continue;
      queue.splice(index, 1);
      if (target.isConnected) targets.add(target);
    }
  }

  for (const target of targets) window.setTimeout(() => target.click(), 0);
}

/**
 * Defer importing and hydrating a server-rendered client boundary until its
 * configured trigger. The returned promise resolves with the hydration result.
 */
export function scheduleFarmIslandHydration<T>({
  container,
  strategy,
  hydrate,
}: ScheduleFarmIslandHydrationOptions<T>): Promise<T> {
  const resolvedStrategy = strategy ?? "load";

  if (resolvedStrategy === "load") {
    return Promise.resolve()
      .then(hydrate)
      .then((value) => {
        finishIslandHydration(container);
        return value;
      });
  }

  return new Promise<T>((resolve, reject) => {
    let started = false;
    let queuedClickTarget: HTMLElement | null = null;
    const cleanups = new Set<() => void>();

    const cleanup = () => {
      for (const dispose of cleanups) dispose();
      cleanups.clear();
    };

    const start = () => {
      if (started) return;
      started = true;
      cleanup();
      Promise.resolve()
        .then(hydrate)
        .then(
          (value) => {
            cleanup();
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

    if (resolvedStrategy === "idle") {
      cleanups.add(runWhenIdle(start));
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
      cleanups.add(() => observer.disconnect());
      return;
    }

    const queueActivatingClick = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
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
      if (!(target instanceof HTMLElement) || !container.contains(target)) return;

      queuedClickTarget ??= target;
      start();
    };

    document.addEventListener("click", queueActivatingClick, true);
    cleanups.add(() => document.removeEventListener("click", queueActivatingClick, true));
    document.addEventListener("farm:island-interaction", activateFromQueuedClick);
    cleanups.add(() =>
      document.removeEventListener("farm:island-interaction", activateFromQueuedClick),
    );
  });
}
