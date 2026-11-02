/**
 * What islands mode adds to a server action's result for a call from JavaScript (RFC 0003): the
 * cache keys the action invalidated, or the declared failure it threw. islx carries it as the
 * result; Farm's interceptor in the browser unwraps it. The RSC engine carries the same in its
 * Flight return value.
 */
import type { SanitizedServerActionError } from "./server-action-security";

export const FARM_ACTION_RESULT_KEY = "__farmAction";

export interface FarmIslandsActionResult {
  [FARM_ACTION_RESULT_KEY]: {
    invalidations: string[];
    error?: SanitizedServerActionError;
  };
  value?: unknown;
}

export function isFarmIslandsActionResult(value: unknown): value is FarmIslandsActionResult {
  if (!value || typeof value !== "object") return false;
  const meta = (value as Partial<FarmIslandsActionResult>)[FARM_ACTION_RESULT_KEY];
  return !!meta && typeof meta === "object" && Array.isArray(meta.invalidations);
}
