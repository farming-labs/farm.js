import type { ProgressOptions, ResolvedProgressOptions } from "./types.js";

export const DEFAULT_PROGRESS_DELAY_MS = 150;
export const DEFAULT_PROGRESS_COLOR = "#2563eb";
export const DEFAULT_PROGRESS_HEIGHT = 3;

export function resolveProgressOptions(options: ProgressOptions): ResolvedProgressOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("progress options must be an object");
  }
  if ("enabled" in options) {
    throw new TypeError(
      "progress does not accept enabled; remove progress() from plugins to disable it",
    );
  }

  const delayMs = options.delayMs ?? DEFAULT_PROGRESS_DELAY_MS;
  if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError("progress delayMs must be a finite number of milliseconds >= 0");
  }

  const color = options.color ?? DEFAULT_PROGRESS_COLOR;
  if (typeof color !== "string" || !color.trim()) {
    throw new TypeError("progress color must be a non-empty CSS color");
  }

  const height = options.height ?? DEFAULT_PROGRESS_HEIGHT;
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("progress height must be a finite number of pixels > 0");
  }

  return Object.freeze({ delayMs, color: color.trim(), height });
}
