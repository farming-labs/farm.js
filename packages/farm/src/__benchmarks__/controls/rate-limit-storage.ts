// Previous memory storage from 1307b964; only the type import path differs.
import type {
  MemoryRateLimitStorageOptions,
  RateLimitIncrementResult,
  RateLimitStorage,
} from "../../middleware/types";
const DEFAULT_MEMORY_RATE_LIMIT_ENTRIES = 100_000;
/** Create an atomic, process-local fixed-window rate-limit store. */
export function memoryRateLimitStorage(
  options: MemoryRateLimitStorageOptions = {},
): RateLimitStorage {
  const maxEntries = options.maxEntries ?? DEFAULT_MEMORY_RATE_LIMIT_ENTRIES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new TypeError("memoryRateLimitStorage maxEntries must be a positive safe integer.");
  }

  const records = new Map<string, RateLimitIncrementResult>();

  function read(key: string, now: number): RateLimitIncrementResult | null {
    const record = records.get(key);
    if (!record) return null;
    if (record.resetAt <= now) {
      records.delete(key);
      return null;
    }
    return record;
  }

  function pruneExpired(now: number): void {
    for (const [key, record] of records) {
      if (record.resetAt <= now) records.delete(key);
    }
  }

  return {
    increment(key, windowMs) {
      if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
        throw new TypeError("Rate-limit windowMs must be a positive safe integer.");
      }
      const now = Date.now();
      const current = read(key, now);
      if (current) {
        const next = { count: current.count + 1, resetAt: current.resetAt };
        records.set(key, next);
        return next;
      }

      if (records.size >= maxEntries) pruneExpired(now);
      if (records.size >= maxEntries) {
        throw new Error(
          `Process-local rate-limit storage reached its ${maxEntries} active-key capacity. Configure a shared production adapter or increase maxEntries.`,
        );
      }

      const next = { count: 1, resetAt: now + windowMs };
      records.set(key, next);
      return next;
    },
    get(key) {
      const record = read(key, Date.now());
      return record ? { ...record } : null;
    },
  };
}
