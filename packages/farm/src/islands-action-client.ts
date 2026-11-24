/**
 * @internal The browser end of islands mode's server actions (RFC 0003): what the RSC engine's call
 * transport does around a call, on islx's calls. A server query's result fills the cache under
 * its key, the keys an action invalidated are dropped, and a declared failure is thrown as the
 * `ServerFnFailure` it was on the server. Islands mode imports it on the first call, or when the
 * page holds a reference (RFC 0013); see `islands-action-call.ts`.
 */
import type { ActionInterceptor } from "@farm.js/islx/client";
import { applyFarmCacheInvalidations } from "./cache-invalidation";
import { isFarmIslandsActionResult } from "./islands-action-protocol";
import {
  beginFarmServerQueryAction,
  type FarmServerQueryActionInvocation,
} from "./server-query-call";
import {
  completeFarmServerQueryAction,
  shouldApplyFarmServerQueryActionResult,
} from "./server-query-runtime";

/** The error a failed server function call throws in the browser, as the RSC engine builds it. */
export function createFarmServerFnTransportError(value: unknown): Error {
  const failure = value as
    | { name?: unknown; message?: unknown; code?: unknown; status?: unknown; data?: unknown }
    | undefined;
  const error = new Error(
    failure && typeof failure.message === "string" ? failure.message : "Server function failed",
  ) as Error & { code?: string; status?: number; data?: unknown };
  if (
    failure &&
    failure.name === "ServerFnFailure" &&
    typeof failure.code === "string" &&
    Number.isInteger(failure.status) &&
    (failure.status as number) >= 400 &&
    (failure.status as number) <= 599 &&
    Object.prototype.hasOwnProperty.call(failure, "data")
  ) {
    error.name = "ServerFnFailure";
    error.code = failure.code;
    error.status = failure.status as number;
    error.data = failure.data;
    Object.defineProperty(error, Symbol.for("farm.server-fn.failure"), {
      value: true,
      enumerable: false,
    });
    return error;
  }
  error.name = "ServerActionError";
  return error;
}

/** The value a call made by `invocation` returns, from the islx `response` it got. */
export async function completeFarmIslandsAction(
  invocation: FarmServerQueryActionInvocation,
  response: Promise<unknown>,
): Promise<unknown> {
  let result: unknown;
  try {
    result = await response;
  } catch (error) {
    // islx answers an undeclared failure with a status; the caller sees what RSC throws.
    if (error instanceof Error && error.message.startsWith("Server action failed")) {
      throw createFarmServerFnTransportError(undefined);
    }
    throw error;
  }
  if (!isFarmIslandsActionResult(result)) return result;
  const { invalidations, error } = result.__farmAction;
  if (shouldApplyFarmServerQueryActionResult(invocation))
    applyFarmCacheInvalidations(invalidations);
  if (error) throw createFarmServerFnTransportError(error);
  return completeFarmServerQueryAction(invocation, result.value);
}

export const farmIslandsActionInterceptor: ActionInterceptor = (call, next) =>
  // Taken when the call is made: a server query reads the call it is making at that moment.
  completeFarmIslandsAction(beginFarmServerQueryAction(call.id, call.args), next());
