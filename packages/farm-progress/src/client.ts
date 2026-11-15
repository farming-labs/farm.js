"use client";

import type { ProgressRuntime, ResolvedProgressOptions } from "./types.js";

const PROGRESS_ATTRIBUTE = "data-farm-progress";
const TRICKLE_INTERVAL_MS = 200;
const TRICKLE_STEP = 8;
const TRICKLE_MAX = 90;
const START_WIDTH = 8;
const COMPLETE_DELAY_MS = 200;
const ERROR_FLASH_MS = 300;
const ERROR_COLOR = "#dc2626";

/** Start the browser runtime for the navigation progress bar. */
export function startProgressRuntime(
  options: ResolvedProgressOptions,
  runtimeWindow: Window & typeof globalThis = window,
): ProgressRuntime {
  let element: HTMLDivElement | null = null;
  let delayHandle: number | undefined;
  let trickleHandle: number | undefined;
  let finishHandle: number | undefined;
  let width = 0;
  let generation = 0;
  let closed = false;

  function removeStaleElements(): void {
    for (const stale of runtimeWindow.document.querySelectorAll(`[${PROGRESS_ATTRIBUTE}]`)) {
      stale.remove();
    }
  }

  function removeElement(): void {
    element?.remove();
    element = null;
    width = 0;
  }

  function ensureElement(): HTMLDivElement {
    if (element?.isConnected) return element;
    removeStaleElements();
    const bar = runtimeWindow.document.createElement("div");
    bar.setAttribute(PROGRESS_ATTRIBUTE, "");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Page loading");
    bar.style.position = "fixed";
    bar.style.top = "0";
    bar.style.left = "0";
    bar.style.height = `${options.height}px`;
    bar.style.width = "0%";
    bar.style.background = options.color;
    bar.style.zIndex = "9999";
    bar.style.pointerEvents = "none";
    bar.style.transition = "width 200ms ease, opacity 200ms ease";
    bar.style.opacity = "0";
    const parent = runtimeWindow.document.body ?? runtimeWindow.document.documentElement;
    parent.append(bar);
    element = bar;
    return bar;
  }

  function clearFinish(): void {
    if (finishHandle !== undefined) {
      runtimeWindow.clearTimeout(finishHandle);
      finishHandle = undefined;
    }
  }

  function show(): void {
    if (closed) return;
    generation += 1;
    clearFinish();
    if (delayHandle !== undefined) return;
    runtimeWindow.clearInterval(trickleHandle);
    trickleHandle = undefined;
    width = 0;
    delayHandle = runtimeWindow.setTimeout(() => {
      delayHandle = undefined;
      const bar = ensureElement();
      bar.style.background = options.color;
      bar.style.opacity = "1";
      width = START_WIDTH;
      bar.style.width = `${width}%`;
      trickleHandle = runtimeWindow.setInterval(() => {
        width = Math.min(TRICKLE_MAX, width + TRICKLE_STEP);
        bar.style.width = `${width}%`;
      }, TRICKLE_INTERVAL_MS);
    }, options.delayMs);
  }

  function hide(): void {
    if (closed) return;
    if (delayHandle !== undefined) {
      runtimeWindow.clearTimeout(delayHandle);
      delayHandle = undefined;
    }
    runtimeWindow.clearInterval(trickleHandle);
    trickleHandle = undefined;
    if (!element?.isConnected) return;
    clearFinish();
    width = 100;
    element.style.width = "100%";
    finishHandle = runtimeWindow.setTimeout(() => {
      finishHandle = undefined;
      removeElement();
    }, COMPLETE_DELAY_MS);
  }

  function fail(): void {
    if (closed) return;
    if (delayHandle !== undefined) {
      runtimeWindow.clearTimeout(delayHandle);
      delayHandle = undefined;
    }
    runtimeWindow.clearInterval(trickleHandle);
    trickleHandle = undefined;
    clearFinish();
    const bar = ensureElement();
    bar.style.background = ERROR_COLOR;
    bar.style.opacity = "1";
    width = 100;
    bar.style.width = "100%";
    finishHandle = runtimeWindow.setTimeout(() => {
      finishHandle = undefined;
      removeElement();
    }, ERROR_FLASH_MS);
  }

  function cancel(): void {
    if (closed) return;
    // A superseding navigation aborts this one right before its own show(), so
    // only finish the bar when no show() arrived by the next task.
    const canceled = generation;
    runtimeWindow.setTimeout(() => {
      if (generation === canceled) hide();
    }, 0);
  }

  function close(): void {
    if (closed) return;
    closed = true;
    if (delayHandle !== undefined) runtimeWindow.clearTimeout(delayHandle);
    runtimeWindow.clearInterval(trickleHandle);
    clearFinish();
    removeElement();
  }

  return { show, hide, fail, cancel, close };
}
