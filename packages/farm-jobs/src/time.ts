import { JobsRuntimeError } from "./errors.js";

const DURATION_UNITS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

/** Which runtime a schedule error names, for example `{ kind: "inngest", label: "Inngest" }`. */
export interface JobsScheduleRuntime {
  kind: string;
  label: string;
}

export function scheduleError(message: string, value: string | number, runtime: string) {
  return new JobsRuntimeError(message, 400, {
    code: "JOBS_INVALID_SCHEDULE",
    runtime,
    value,
  });
}

/** Positive milliseconds, or a duration such as `"10s"` ending in ms, s, m, h, or d. */
export function parseDurationMs(value: string | number): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.ceil(value) : undefined;
  }

  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase() as keyof typeof DURATION_UNITS;
  const duration = Math.ceil(amount * DURATION_UNITS[unit]);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

/** An ISO timestamp with an explicit `Z` or UTC offset. */
export function parseAbsoluteTime(value: string | number): number | undefined {
  if (typeof value !== "string") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * The epoch milliseconds a delayed launch should start at, or `undefined` for
 * an immediate launch. An ISO timestamp is absolute and must be in the future;
 * a number or duration is relative to `now`.
 */
export function resolveScheduledTimestamp(
  options: { delay?: string | number; delayMode?: "at" | "after" },
  now: number,
  runtime: JobsScheduleRuntime,
): number | undefined {
  if (options.delay == null) return undefined;

  const absolute = options.delayMode === "after" ? undefined : parseAbsoluteTime(options.delay);
  if (absolute != null) {
    if (absolute <= now) {
      throw scheduleError(
        `${runtime.label} at/delay timestamps must be in the future.`,
        options.delay,
        runtime.kind,
      );
    }
    return absolute;
  }

  if (options.delayMode === "at") {
    throw scheduleError(
      `${runtime.label} at must be an ISO timestamp with an explicit Z or UTC offset.`,
      options.delay,
      runtime.kind,
    );
  }

  const duration = parseDurationMs(options.delay);
  if (duration == null) {
    throw scheduleError(
      `${runtime.label} after/delay must be positive milliseconds or a duration ending in ms, s, m, h, or d.`,
      options.delay,
      runtime.kind,
    );
  }

  const timestamp = now + duration;
  if (!Number.isSafeInteger(timestamp) || timestamp > MAX_TIMESTAMP) {
    throw scheduleError(
      `${runtime.label} after/delay exceeds the supported date range.`,
      options.delay,
      runtime.kind,
    );
  }
  return timestamp;
}
