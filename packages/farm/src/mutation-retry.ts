import type { RetryAttemptContext, RetryOptions } from "./api/client";

/** Statuses that represent a transient condition worth another attempt. */
const TRANSIENT_STATUSES = new Set([408, 425, 429]);

/**
 * The default filter for opted-in mutation retries. A mutation is a POST the
 * caller chose to retry despite the duplicate-write risk, so the method is
 * not the gate here - the failure class is: transport failures and transient
 * server statuses retry, while a 4xx is the server's final answer and
 * retrying it only repeats the rejection.
 */
function isTransientMutationFailure(context: RetryAttemptContext): boolean {
  if (context.status === undefined) return true;
  return context.status >= 500 || TRANSIENT_STATUSES.has(context.status);
}

function readErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Retry a server-function mutation with the API client's retry shape.
 *
 * Attempts run until success, until `count` retries are exhausted, until the
 * retry filter declines the failure, or until `shouldContinue` reports that
 * the owning lifecycle was reset. `shouldRetry` receives the same attempt
 * context the API client provides; the default retries transient failures
 * only. The delay callback receives the upcoming attempt number starting at
 * 1, matching the API client. Defaults to zero retries so existing behavior
 * is unchanged.
 */
export async function invokeMutationWithRetry<T>(
  invoke: () => Promise<T>,
  retry: RetryOptions | undefined,
  shouldContinue: () => boolean,
): Promise<T> {
  const maxRetries = Math.max(0, retry?.count ?? 0);
  const shouldRetryFailure = retry?.shouldRetry ?? isTransientMutationFailure;
  let attempt = 0;

  while (true) {
    try {
      return await invoke();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (
        attempt >= maxRetries ||
        !shouldContinue() ||
        !shouldRetryFailure({
          attempt,
          method: "POST",
          status: readErrorStatus(error),
          error: failure,
        })
      ) {
        throw error;
      }

      attempt += 1;
      const delay = typeof retry?.delay === "function" ? retry.delay(attempt) : (retry?.delay ?? 0);
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        // The lifecycle may have been reset while this attempt waited.
        if (!shouldContinue()) throw error;
      }
    }
  }
}
