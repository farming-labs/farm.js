const MAX_TIMER_DELAY = 2_147_483_647;

export function resolveClientRetryCount(value: number | undefined): number {
  const count = value ?? 0;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("retry.count must be a non-negative safe integer");
  }
  return count;
}

export function resolveClientRetryDelay(value: number | undefined): number {
  const delay = value ?? 0;
  if (!Number.isFinite(delay) || delay < 0 || delay > MAX_TIMER_DELAY) {
    throw new RangeError(`retry.delay must be between 0 and ${MAX_TIMER_DELAY} milliseconds`);
  }
  return delay;
}
