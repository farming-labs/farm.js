interface RateLimitBucket {
  count: number;
  startedAt: number;
}

export interface RateLimiterOptions {
  /** Length of the fixed window, in milliseconds. */
  windowMs?: number;
  /**
   * Upper bound on tracked keys. Keys are attacker-influenced on any public
   * endpoint, so the map is swept of expired buckets once it grows past this.
   */
  maxEntries?: number;
}

export type RateLimiter = (key: string, limit: number, now?: number) => boolean;

/**
 * A fixed-window limiter over an in-process map.
 *
 * Each endpoint owns an instance, so budgets stay independent. Public
 * endpoints layer two keys: a coarse global bucket that can be taken before
 * the body is parsed, and a per-caller bucket once the payload identifies
 * one, so a single noisy caller cannot consume everyone else's budget.
 *
 * In-process means per instance: a horizontally scaled deployment enforces
 * this per replica, which is a ceiling rather than a quota.
 */
export function createRateLimiter({
  windowMs = 60_000,
  maxEntries = 4_096,
}: RateLimiterOptions = {}): RateLimiter {
  const buckets = new Map<string, RateLimitBucket>();

  return function take(key: string, limit: number, now = Date.now()): boolean {
    const current = buckets.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      buckets.set(key, { count: 1, startedAt: now });
      if (buckets.size > maxEntries) {
        for (const [bucketKey, bucket] of buckets) {
          if (now - bucket.startedAt >= windowMs) buckets.delete(bucketKey);
        }
      }
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  };
}
